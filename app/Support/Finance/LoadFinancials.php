<?php

declare(strict_types=1);

namespace App\Support\Finance;

use App\Enums\CommissionBasis;

/**
 * El resultado del cálculo de una carga, con todos los pasos a la vista.
 *
 * Es inmutable y expone los intermedios (`commissionableBase`,
 * `dispatchFee`) además de los totales. No es por comodidad: quien discute una
 * liquidación pregunta «¿de dónde sale este número?», y un objeto que solo
 * devuelve el total obliga a rehacer la cuenta a mano para responder.
 */
final readonly class LoadFinancials
{
    public function __construct(
        // Entradas, copiadas para que el resultado se explique solo
        public int $customerCharge,
        public int $carrierGrossRate,
        public int $dispatchFeeBps,
        public int $commissionBps,
        public CommissionBasis $commissionBasis,
        public FeeBase $feeBase,
        public int $excludedExpenses,
        public int $reimbursableExpenses,
        public int $tenantAbsorbedExpenses,
        public int $carrierDeductions,

        // Salidas
        public int $commissionableBase,
        public int $dispatchFee,
        public int $netCarrierSettlement,
        public int $grossMargin,
        public int $commissionBasisAmount,
        public int $dispatcherCommission,
    ) {}

    /**
     * Lo que le queda a la empresa después de pagar la comisión del despachador.
     *
     * No está en `financial_snapshots` porque allí la comisión es una salida
     * aparte, pero es la cifra que alguien mira para saber si la carga valió la
     * pena.
     */
    public function netMargin(): int
    {
        return $this->grossMargin - $this->dispatcherCommission;
    }

    /**
     * Las columnas de `financial_snapshots`, listas para insertar.
     *
     * @return array<string, mixed>
     */
    public function toSnapshotColumns(): array
    {
        return [
            'customer_charge_cents' => $this->customerCharge,
            'carrier_gross_rate_cents' => $this->carrierGrossRate,
            'carrier_dispatch_fee_bps' => $this->dispatchFeeBps,
            'dispatcher_commission_bps' => $this->commissionBps,
            'dispatcher_commission_basis' => $this->commissionBasis->value,
            'approved_excluded_expenses_cents' => $this->excludedExpenses,
            'approved_reimbursable_expenses_cents' => $this->reimbursableExpenses,
            'tenant_absorbed_expenses_cents' => $this->tenantAbsorbedExpenses,
            'carrier_deductions_cents' => $this->carrierDeductions,
            'commissionable_base_cents' => $this->commissionableBase,
            'dispatch_fee_amount_cents' => $this->dispatchFee,
            'net_carrier_settlement_cents' => $this->netCarrierSettlement,
            'gross_margin_cents' => $this->grossMargin,
            'dispatcher_commission_amount_cents' => $this->dispatcherCommission,
        ];
    }
}
