<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Support\Notifications\Notifier;
use App\Support\Tenancy\TenantPolicy;
use App\Support\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * El barrido diario: lo único de esta aplicación que ocurre sin que nadie mire.
 *
 * Hasta este lote `routes/console.php` no tenía un solo comando. Eso significaba
 * que un certificado de seguros caducaba y nadie se enteraba; que
 * `fmcsa_reverification_days` se guardaba en los ajustes y no revalidaba a
 * nadie; y que una factura cruzaba su vencimiento sin que su estado cambiara —
 * porque `invoices.status` solo pasa a `overdue` cuando alguien anota un cobro.
 * Una aplicación de cumplimiento donde no pasa nada si nadie entra es una
 * agenda, no un sistema.
 *
 *     php artisan notifications:sweep
 *     php artisan notifications:sweep --dry-run       (cuenta y no escribe)
 *     php artisan notifications:sweep --tenant=<id>   (solo una empresa)
 *
 * Es IDEMPOTENTE por diseño y no por suerte: se puede ejecutar cien veces
 * seguidas y solo escribe la primera. Quien deduplica es el índice único de
 * `notifications` sobre `(dedupe_key, user_id, channel)`, no una comprobación
 * previa — dos barridos solapados que consultaran antes de insertar verían los
 * dos que no hay nada.
 *
 * Recorre TODAS las empresas, cada una dentro de su propio contexto, porque los
 * plazos (aviso de caducidad, revalidación) los fija cada empresa en sus
 * ajustes y no son los mismos para todas.
 */
final class SweepNotifications extends Command
{
    protected $signature = 'notifications:sweep
        {--dry-run : Cuenta lo que avisaría sin escribir nada}
        {--tenant= : Barre solo esta empresa}';

    protected $description = 'Avisa de documentos que caducan, transportistas por revalidar y facturas vencidas';

    public function handle(TenantContext $context): int
    {
        $dry = (bool) $this->option('dry-run');
        $soloEmpresa = trim((string) $this->option('tenant'));

        $empresas = $context->withoutTenant(function () use ($soloEmpresa): array {
            $query = DB::table('tenants')->whereNull('deleted_at')->where('status', '!=', 'suspended');

            if ($soloEmpresa !== '') {
                $query->where('id', $soloEmpresa);
            }

            return $query->pluck('id')->map(static fn ($id): string => (string) $id)->all();
        });

        $totales = ['documents' => 0, 'carriers' => 0, 'invoices' => 0];

        foreach ($empresas as $tenantId) {
            $context->runAs($tenantId, function () use ($tenantId, $dry, &$totales): void {
                $totales['documents'] += $this->documentosQueCaducan($tenantId, $dry);
                $totales['carriers'] += $this->transportistasPorRevalidar($tenantId, $dry);
                $totales['invoices'] += $this->facturasVencidas($tenantId, $dry);
            });
        }

        // La unidad se dice, porque NO es la misma en los dos modos y callarlo
        // hace que los números parezcan contradecirse: en simulacro se cuentan
        // los ASUNTOS encontrados (dos documentos), y de verdad los AVISOS
        // escritos (esos dos documentos por cada destinatario y por cada canal,
        // que pueden ser ocho).
        $this->line(sprintf(
            '%d empresas · %s: documentos %d · transportistas %d · facturas %d%s',
            count($empresas),
            $dry ? 'asuntos encontrados' : 'avisos escritos',
            $totales['documents'],
            $totales['carriers'],
            $totales['invoices'],
            $dry ? '  (simulacro: no se escribió nada)' : '',
        ));

        return self::SUCCESS;
    }

    /**
     * Documentos dentro del plazo de aviso de la empresa.
     *
     * La clave de deduplicación lleva la FECHA DE CADUCIDAD, no la de hoy: así
     * el aviso se manda una vez por vencimiento, y cuando alguien renueva el
     * documento —lo que le da una fecha nueva— vuelve a poder avisarse llegado
     * el momento. Con la fecha de hoy dentro, avisaría cada mañana.
     */
    private function documentosQueCaducan(string $tenantId, bool $dry): int
    {
        $dias = TenantPolicy::for($tenantId)->documentWarningDays;
        $limite = CarbonImmutable::now()->addDays($dias);

        $filas = DB::table('documents')
            ->where('tenant_id', $tenantId)
            ->whereNull('deleted_at')
            ->whereNotNull('expiration_date')
            ->where('expiration_date', '<=', $limite)
            ->orderBy('expiration_date')
            ->limit(500)
            ->get(['id', 'title', 'expiration_date']);

        $escritos = 0;

        foreach ($filas as $documento) {
            $vence = substr((string) $documento->expiration_date, 0, 10);

            if ($dry) {
                $escritos++;

                continue;
            }

            $escritos += Notifier::toPermissionHolders(
                tenantId: $tenantId,
                permission: 'document:read',
                eventKey: 'document.expiring',
                dedupeKey: "document.expiring:{$documento->id}:{$vence}",
                params: ['title' => (string) $documento->title, 'date' => $vence],
                actionUrl: '/documents?expiring=1',
                subjectType: 'document',
                subjectId: (string) $documento->id,
            );
        }

        return $escritos;
    }

    /**
     * Transportistas sin comprobación en FMCSA dentro del plazo.
     *
     * Incluye a los que no se han comprobado NUNCA: no tener verificación es
     * peor que tenerla vieja, y dejarlos fuera los dejaría fuera de la vista.
     *
     * La clave lleva el mes. Es el único de los tres avisos que se repite a
     * propósito: revalidar es una tarea recurrente, y un recordatorio mensual es
     * lo que la mantiene viva sin convertirse en ruido diario.
     */
    private function transportistasPorRevalidar(string $tenantId, bool $dry): int
    {
        $limite = CarbonImmutable::now()->subDays(TenantPolicy::for($tenantId)->fmcsaReverificationDays);
        $mes = CarbonImmutable::now()->format('Y-m');

        $filas = DB::table('carriers as c')
            ->where('c.tenant_id', $tenantId)
            ->whereNull('c.deleted_at')
            ->whereNotExists(fn ($q) => $q->select(DB::raw(1))
                ->from('fmcsa_verifications as v')
                ->whereColumn('v.carrier_id', 'c.id')
                ->where('v.tenant_id', $tenantId)
                ->where('v.checked_at', '>=', $limite))
            ->orderBy('c.legal_name')
            ->limit(500)
            ->get(['c.id', 'c.legal_name']);

        $escritos = 0;

        foreach ($filas as $transportista) {
            if ($dry) {
                $escritos++;

                continue;
            }

            $escritos += Notifier::toPermissionHolders(
                tenantId: $tenantId,
                permission: 'carrier:read',
                eventKey: 'carrier.reverification_due',
                dedupeKey: "carrier.reverification_due:{$transportista->id}:{$mes}",
                params: ['name' => (string) $transportista->legal_name],
                actionUrl: '/carriers/'.$transportista->id,
                subjectType: 'carrier',
                subjectId: (string) $transportista->id,
            );
        }

        return $escritos;
    }

    /**
     * Facturas pasadas de fecha con saldo.
     *
     * Este barrido, además de avisar, PONE AL DÍA `invoices.status`. Es el único
     * de los tres que corrige datos, y hace falta: ese estado solo lo escribía
     * `PaymentLedger::resync()`, que corre al anotar o reembolsar un cobro, así
     * que una factura que simplemente cruzaba su vencimiento se quedaba en
     * `sent` para siempre. El panel lo calculaba por fecha justamente para no
     * heredar esa mentira; ahora, además, el dato queda arreglado.
     *
     * Se avisa UNA vez por factura, sin fecha en la clave: el número de facturas
     * vencidas ya está permanentemente a la vista en el panel, y repetir el
     * aviso cada mes solo lo convertiría en ruido.
     */
    private function facturasVencidas(string $tenantId, bool $dry): int
    {
        $hoy = CarbonImmutable::now()->toDateString();

        $filas = DB::table('invoices')
            ->where('tenant_id', $tenantId)
            ->whereNull('deleted_at')
            ->where('balance_cents', '>', 0)
            ->whereNotNull('due_date')
            ->whereDate('due_date', '<', $hoy)
            ->whereNotIn('status', ['draft', 'voided', 'paid', 'uncollectable'])
            ->orderBy('due_date')
            ->limit(500)
            ->get(['id', 'invoice_number', 'due_date', 'status']);

        $escritos = 0;

        foreach ($filas as $factura) {
            if ($dry) {
                $escritos++;

                continue;
            }

            if ($factura->status !== 'overdue') {
                DB::table('invoices')->where('id', $factura->id)->update([
                    'status' => 'overdue',
                    'updated_at' => CarbonImmutable::now(),
                ]);
            }

            $escritos += Notifier::toPermissionHolders(
                tenantId: $tenantId,
                permission: 'invoice:read',
                eventKey: 'invoice.overdue',
                dedupeKey: "invoice.overdue:{$factura->id}",
                params: [
                    'number' => (string) $factura->invoice_number,
                    'date' => substr((string) $factura->due_date, 0, 10),
                ],
                actionUrl: '/invoices/'.$factura->id,
                subjectType: 'invoice',
                subjectId: (string) $factura->id,
            );
        }

        return $escritos;
    }
}
