<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Support\Platform\ScheduledRuns;
use App\Support\Retention\Policy;
use App\Support\Retention\Sweeper;
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

    public function handle(TenantContext $context): int
    {
        if ((bool) $this->option('dry-run')) {
            // Un simulacro NO deja rastro de ejecución, igual que en
            // notifications:sweep: si lo dejara, la pantalla de salud diría que
            // el barrido corrió anoche cuando lo que corrió fue alguien
            // probando desde una terminal.
            return $this->barrer($context, true);
        }

        return ScheduledRuns::wrap('retention:sweep', function () use ($context): array {
            $codigo = $this->barrer($context, false);

            return [$codigo, $this->resumen];
        });
    }

    private function barrer(TenantContext $context, bool $dry): int
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
        $totales = ['archived' => 0, 'purged' => 0, 'skippedByHold' => 0, 'tenants' => count($empresas)];

        foreach ($empresas as $tenantId) {
            $context->runAs($tenantId, function () use ($tenantId, $ahora, $dry, &$totales): void {
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
                $r = Sweeper::run($tenantId, $ahora);

                $totales['archived'] += $r['archived'];
                $totales['purged'] += $r['purged'];
                $totales['skippedByHold'] += $r['skipped'];
            });
        }

        $this->resumen = $totales;

        $this->info(sprintf(
            '%d empresas · archivadas %d · purgadas %d · saltadas por bloqueo legal %d%s',
            $totales['tenants'],
            $totales['archived'],
            $totales['purged'],
            $totales['skippedByHold'],
            config('retention.purge_enabled') ? '' : ' · purga APAGADA',
        ));

        return self::SUCCESS;
    }
}
