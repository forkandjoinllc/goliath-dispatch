<?php

declare(strict_types=1);

namespace App\Support\Finance;

use App\Enums\CommissionBasis;

/**
 * El reparto del dinero de una carga.
 *
 * Cuatro tipos de gasto entran, cinco cifras salen. Los nombres de los tipos
 * vienen del esquema y cada uno dice exactamente qué hace:
 *
 *  - `excluded_from_commission` — no cuenta para la base sobre la que se
 *    calcula el porcentaje. Un permiso de sobredimensión es dinero que solo
 *    pasa por las manos del transportista.
 *  - `reimbursable_to_carrier` — se le devuelve. Sube su liquidación.
 *  - `tenant_absorbed`         — lo paga la empresa de despacho. Baja su margen.
 *  - `carrier_deduction`       — se le retiene. Baja su liquidación.
 *
 * El orden de las operaciones está fijado aquí y en ningún otro sitio. Es
 * deliberado: en cuanto la misma cuenta se escriba en dos lugares —la pantalla
 * de la carga y el generador de liquidaciones, por ejemplo— empezarán a
 * discrepar en un céntimo, y ese céntimo aparecerá en una llamada de teléfono.
 *
 * Nada de esto usa coma flotante. Ver Money.
 */
final class Calculator
{
    /**
     * @param  FeeBase  $feeBase  Sobre qué se cobra la tarifa. Ver FeeBase: lo
     *                            fija el ajuste de la empresa, no el esquema.
     */
    public static function compute(
        int $customerCharge,
        int $carrierGrossRate,
        int $dispatchFeeBps,
        int $commissionBps,
        CommissionBasis $commissionBasis,
        FeeBase $feeBase = FeeBase::Commissionable,
        int $excludedExpenses = 0,
        int $reimbursableExpenses = 0,
        int $tenantAbsorbedExpenses = 0,
        int $carrierDeductions = 0,
    ): LoadFinancials {
        // 1. La base comisionable: el bruto menos lo que no es flete.
        //
        // Con suelo en cero. Sin él, un permiso más caro que el flete daría una
        // base negativa y por tanto una tarifa de despacho negativa, es decir
        // la empresa PAGANDO al transportista por despacharle una carga. Eso no
        // es un caso de negocio, es un error de captura, y devolver cero deja
        // el disparate a la vista en vez de repartirlo por el resto de la cuenta.
        $commissionableBase = max(0, $carrierGrossRate - $excludedExpenses);

        // 2. La tarifa de despacho: lo que cobra la empresa.
        $feeBaseAmount = match ($feeBase) {
            FeeBase::Commissionable => $commissionableBase,
            FeeBase::CarrierGross => $carrierGrossRate,
        };

        $dispatchFee = Money::applyBps($feeBaseAmount, $dispatchFeeBps);

        // 3. Lo que se le liquida al transportista.
        //
        // Sobre el BRUTO, no sobre la base: los gastos excluidos se quitaron
        // solo para calcular el porcentaje, no son dinero que el transportista
        // deje de recibir. Restarlos aquí también sería cobrárselos dos veces.
        $netCarrierSettlement = $carrierGrossRate
            - $dispatchFee
            + $reimbursableExpenses
            - $carrierDeductions;

        // 4. El margen bruto de la empresa: lo que cobra menos lo que absorbe.
        //
        // Puede salir negativo y el esquema lo permite a propósito: una carga
        // vendida por debajo de coste es un hecho de negocio legítimo, no un
        // fallo de integridad. Ver docs/port-notes-finance-messaging-tracking.md.
        $grossMargin = $dispatchFee - $tenantAbsorbedExpenses;

        // 5. La comisión del despachador, sobre la base que diga la carga.
        $commissionBasisAmount = match ($commissionBasis) {
            CommissionBasis::DispatchFeeAmount => $dispatchFee,
            CommissionBasis::CarrierGrossRate => $carrierGrossRate,
            CommissionBasis::CommissionableBase => $commissionableBase,
        };

        $dispatcherCommission = Money::applyBps($commissionBasisAmount, $commissionBps);

        return new LoadFinancials(
            customerCharge: $customerCharge,
            carrierGrossRate: $carrierGrossRate,
            dispatchFeeBps: $dispatchFeeBps,
            commissionBps: $commissionBps,
            commissionBasis: $commissionBasis,
            feeBase: $feeBase,
            excludedExpenses: $excludedExpenses,
            reimbursableExpenses: $reimbursableExpenses,
            tenantAbsorbedExpenses: $tenantAbsorbedExpenses,
            carrierDeductions: $carrierDeductions,
            commissionableBase: $commissionableBase,
            dispatchFee: $dispatchFee,
            netCarrierSettlement: $netCarrierSettlement,
            grossMargin: $grossMargin,
            commissionBasisAmount: $commissionBasisAmount,
            dispatcherCommission: $dispatcherCommission,
        );
    }
}
