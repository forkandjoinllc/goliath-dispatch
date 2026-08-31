<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Support\Platform\ScheduledRuns;
use App\Support\Retention\Policy;
use App\Support\Retention\Sweeper;
use App\Support\Storage\DocumentStore;
use App\Support\Storage\OrphanSweep;
use App\Support\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * El barrido de retención: archivar lo viejo y, si está encendido, purgar.
 *
 *     php artisan retention:sweep
 *     php artisan retention:sweep --dry-run       (cuenta y no escribe)
 *     php artisan retention:sweep --tenant=<id>   (solo una empresa)
 *
 * Recorre todas las empresas, cada una con SU política: los plazos están en
 * `tenant_settings` y no son los mismos para todas — una casa que mueve
 * mercancía general y otra que mueve material peligroso no conservan lo mismo
 * ni el mismo tiempo.
 *
 * La purga permanente está apagada de fábrica (`RETENTION_PURGE_ENABLED`). Con
 * ella apagada este comando archiva y nada más, que es reversible.
 */
final class SweepRetention extends Command
{
    protected $signature = 'retention:sweep
        {--dry-run : Cuenta lo que haría sin escribir nada}
        {--tenant= : Barre solo esta empresa}';

    protected $description = 'Archiva los registros que han dejado de estar activos y purga los vencidos, respetando los bloqueos legales';

    /** @var array<string, mixed> */
    private array $resumen = [];

    private static function peso(int $bytes): string
    {
        if ($bytes < 1024) {
            return $bytes.' B';
        }

        if ($bytes < 1024 * 1024) {
            return round($bytes / 1024).' KB';
        }

        return round($bytes / (1024 * 1024), 1).' MB';
    }

    public function handle(TenantContext $context, DocumentStore $store): int
    {
        if ((bool) $this->option('dry-run')) {
            // Un simulacro NO deja rastro de ejecución, igual que en
            // notifications:sweep: si lo dejara, la pantalla de salud diría que
            // el barrido corrió anoche cuando lo que corrió fue alguien
            // probando desde una terminal.
            return $this->barrer($context, $store, true);
        }

        return ScheduledRuns::wrap('retention:sweep', function () use ($context, $store): array {
            $codigo = $this->barrer($context, $store, false);

            return [$codigo, $this->resumen];
        });
    }

    private function barrer(TenantContext $context, DocumentStore $store, bool $dry): int
    {
        $soloEmpresa = trim((string) $this->option('tenant'));

        $empresas = $context->withoutTenant(function () use ($soloEmpresa): array {
            $query = DB::table('tenants')->whereNull('deleted_at')->where('status', '!=', 'suspended');

            if ($soloEmpresa !== '') {
                $query->where('id', $soloEmpresa);
            }

            return $query->pluck('id')->map(static fn ($id): string => (string) $id)->all();
        });

        $ahora = CarbonImmutable::now();
        $totales = ['archived' => 0, 'purged' => 0, 'files' => 0, 'skippedByHold' => 0, 'tenants' => count($empresas)];

        foreach ($empresas as $tenantId) {
            $context->runAs($tenantId, function () use ($tenantId, $ahora, $dry, $store, &$totales): void {
                if ($dry) {
                    // En seco se enseñan las dos caras: lo que se archivaría y
                    // lo que se purgaría. Nadie debería encender la purga sin
                    // haber leído antes la segunda lista.
                    $politica = Policy::forTenant($tenantId);

                    $this->line("Empresa {$tenantId} — activo {$politica->operationalActiveMonths} meses, financiero {$politica->financialRetentionYears} años");

                    foreach (Sweeper::purgeDryRun($tenantId, $ahora) as $tabla => $r) {
                        $this->line("  purgaría {$tabla}: {$r['candidates']} (bloqueadas: {$r['skipped']})");
                        $totales['purged'] += $r['candidates'];
                        $totales['skippedByHold'] += $r['skipped'];
                    }

                    return;
                }

                // `run()` es quien archiva y purga, y deja el rastro en
                // `retention_jobs`. Llamar además a archive() y purge() aquí
                // haría el trabajo dos veces y duplicaría las filas del rastro.
                $r = Sweeper::run($store, $tenantId, $ahora);

                $totales['archived'] += $r['archived'];
                $totales['purged'] += $r['purged'];
                $totales['files'] += $r['files'];
                $totales['skippedByHold'] += $r['skipped'];
            });
        }

        // Los huérfanos son del ALMACÉN, no de una empresa: un fichero sin fila
        // no se puede atribuir a nadie —esa era la fila que no existe— así que
        // se barren una vez por ejecución y no una vez por empresa.
        $huerfanos = OrphanSweep::find($store, $ahora);
        $totales['orphans'] = count($huerfanos['files']);
        $totales['orphanBytes'] = $huerfanos['bytes'];
        $totales['orphansPurged'] = $dry ? 0 : OrphanSweep::purge($store, $ahora);
        $totales['dangling'] = count(OrphanSweep::dangling($store));

        $this->resumen = $totales;

        $this->info(sprintf(
            '%d empresas · archivadas %d · purgadas %d (ficheros %d) · saltadas por bloqueo legal %d%s',
            $totales['tenants'],
            $totales['archived'],
            $totales['purged'],
            $totales['files'],
            $totales['skippedByHold'],
            config('retention.purge_enabled') ? '' : ' · purga APAGADA',
        ));

        $this->info(sprintf(
            'almacén: %d huérfanos (%s) · %d borrados · %d filas sin fichero',
            $totales['orphans'],
            self::peso($totales['orphanBytes']),
            $totales['orphansPurged'],
            $totales['dangling'],
        ));

        return self::SUCCESS;
    }
}
