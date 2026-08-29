<?php

declare(strict_types=1);

namespace App\Support\Tenancy;

use App\Enums\CommissionBasis;
use App\Support\Finance\FeeBase;
use Illuminate\Support\Facades\DB;

/**
 * La política de la empresa: los valores por defecto con los que nace una carga,
 * una factura o un aviso de caducidad.
 *
 * EXISTE PORQUE ESAS COLUMNAS NO LAS LEÍA NADIE. `tenant_settings` guardaba
 * `default_carrier_dispatch_fee_bps`, `default_dispatcher_commission_bps`,
 * `default_payment_terms_days` y `document_expiration_warning_days`, y el código
 * pasaba de largo con constantes propias — `?? 1000`, `?? 2500`, `?? 30`, un
 * `WARN_DAYS` de clase. Una empresa cuya política fuese 12 %, 20 % y pago a
 * quince días recibía 10 %, 25 % y treinta días en cada carga y cada factura, en
 * silencio.
 *
 * Se lee UNA vez por empresa y petición. No es una caché de rendimiento: es que
 * dos lecturas de la misma política dentro de la misma petición no puedan
 * contestar cosas distintas.
 *
 * Los valores de respaldo siguen aquí a propósito, para una empresa cuya fila de
 * ajustes no exista todavía. Son los mismos que tiene el esquema por defecto.
 */
final class TenantPolicy
{
    /**
     * `readonly` no admite propiedades estáticas con valor por defecto, así que
     * la caché vive fuera de la clase de valor.
     *
     * @var array<string, self>
     */
    private static array $cache = [];

    public function __construct(
        public readonly int $carrierDispatchFeeBps,
        public readonly int $dispatcherCommissionBps,
        public readonly CommissionBasis $dispatcherCommissionBasis,
        public readonly FeeBase $dispatchFeeBase,
        public readonly int $paymentTermsDays,
        public readonly int $documentWarningDays,
        public readonly int $fmcsaReverificationDays,
    ) {}

    public static function for(?string $tenantId): self
    {
        if ($tenantId === null) {
            return self::fallback();
        }

        if (isset(self::$cache[$tenantId])) {
            return self::$cache[$tenantId];
        }

        // Consulta en crudo: esto lo llaman sitios que corren antes de que haya
        // modelo con scope resuelto, y el scope global lanzaría.
        $fila = DB::table('tenant_settings')
            ->where('tenant_id', $tenantId)
            ->first([
                'default_carrier_dispatch_fee_bps',
                'default_dispatcher_commission_bps',
                'dispatcher_commission_basis',
                'dispatch_fee_base',
                'default_payment_terms_days',
                'document_expiration_warning_days',
                'fmcsa_reverification_days',
            ]);

        if ($fila === null) {
            return self::$cache[$tenantId] = self::fallback();
        }

        return self::$cache[$tenantId] = new self(
            carrierDispatchFeeBps: (int) $fila->default_carrier_dispatch_fee_bps,
            dispatcherCommissionBps: (int) $fila->default_dispatcher_commission_bps,
            dispatcherCommissionBasis: CommissionBasis::tryFrom((string) $fila->dispatcher_commission_basis)
                ?? CommissionBasis::DispatchFeeAmount,
            dispatchFeeBase: FeeBase::tryFrom((string) $fila->dispatch_fee_base)
                ?? FeeBase::Commissionable,
            paymentTermsDays: (int) $fila->default_payment_terms_days,
            documentWarningDays: (int) $fila->document_expiration_warning_days,
            fmcsaReverificationDays: (int) $fila->fmcsa_reverification_days,
        );
    }

    /**
     * Olvida lo leído. Solo lo necesitan las pruebas y el propio guardado de
     * ajustes: cambiar la política y seguir sirviendo la anterior en la misma
     * petición sería mentir en la pantalla que acaba de guardar.
     */
    public static function forget(?string $tenantId = null): void
    {
        if ($tenantId === null) {
            self::$cache = [];

            return;
        }

        unset(self::$cache[$tenantId]);
    }

    private static function fallback(): self
    {
        return new self(
            carrierDispatchFeeBps: 1000,
            dispatcherCommissionBps: 2500,
            dispatcherCommissionBasis: CommissionBasis::DispatchFeeAmount,
            dispatchFeeBase: FeeBase::Commissionable,
            paymentTermsDays: 30,
            documentWarningDays: 30,
            fmcsaReverificationDays: 7,
        );
    }
}
