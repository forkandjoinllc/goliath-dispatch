<?php

declare(strict_types=1);

namespace App\Support\Finance;

use App\Enums\CommissionBasis;
use App\Models\Load;
use App\Support\Tenancy\TenantPolicy;
use Illuminate\Support\Facades\DB;

/**
 * Calcula el dinero de una carga concreta, yendo a buscar sus gastos y el
 * ajuste de la empresa.
 *
 * Se separa de Calculator a propósito: Calculator es aritmética pura y se puede
 * probar sin base de datos ni empresa activa. Esta clase es la que sabe DÓNDE
 * están los números. Mezclarlas obligaría a montar una empresa entera para
 * comprobar que un 10 % de $2.250 son $225.
 */
final class LoadCalculator
{
    public function for(Load $load): LoadFinancials
    {
        $expenses = $this->approvedExpensesByTreatment($load->id);

        return Calculator::compute(
            customerCharge: (int) $load->customer_charge_cents,
            carrierGrossRate: (int) $load->carrier_gross_rate_cents,
            // Los puntos básicos salen de la CARGA, no del transportista ni de
            // los ajustes. Están congelados ahí desde que se acordó la carga
            // precisamente para que subirle la tarifa a un transportista hoy no
            // reescriba lo que se pactó el mes pasado.
            dispatchFeeBps: (int) $load->carrier_dispatch_fee_bps,
            commissionBps: (int) $load->dispatcher_commission_bps,
            // El modelo ya lo castea al enum; envolverlo en (string) lo rompía
            // con «could not be converted to string». Se acepta cualquiera de
            // las dos formas porque este método también se llama con filas
            // crudas en los comandos de mantenimiento.
            commissionBasis: $load->dispatcher_commission_basis instanceof CommissionBasis
                ? $load->dispatcher_commission_basis
                : CommissionBasis::from((string) $load->dispatcher_commission_basis),
            feeBase: $this->feeBase($load->tenant_id),
            excludedExpenses: $expenses['excluded_from_commission'] ?? 0,
            reimbursableExpenses: $expenses['reimbursable_to_carrier'] ?? 0,
            tenantAbsorbedExpenses: $expenses['tenant_absorbed'] ?? 0,
            carrierDeductions: $expenses['carrier_deduction'] ?? 0,
        );
    }

    /**
     * La base de la tarifa es lo ÚNICO que se lee de los ajustes vivos y no de
     * la carga, y merece justificarse: no es un precio pactado sino la
     * interpretación del contrato marco de la empresa. Si cambiara, cambia para
     * todo lo que se calcule a partir de entonces — las liquidaciones ya
     * cerradas conservan su cifra en `financial_snapshots`, que es de solo
     * añadir.
     */
    private function feeBase(string $tenantId): FeeBase
    {
        return TenantPolicy::for($tenantId)->dispatchFeeBase;
    }

    /**
     * Solo los gastos APROBADOS entran en la cuenta.
     *
     * Un gasto enviado y todavía sin revisar no puede mover el dinero de nadie:
     * si lo hiciera, la liquidación de un transportista cambiaría sola cada vez
     * que alguien sube una foto de un recibo.
     *
     * @return array<string, int>
     */
    private function approvedExpensesByTreatment(string $loadId): array
    {
        return DB::table('expenses')
            ->where('load_id', $loadId)
            ->whereNull('deleted_at')
            // `reimbursed` es un aprobado que además ya se pagó: sigue contando.
            ->whereIn('status', ['approved', 'reimbursed'])
            ->select('treatment_snapshot', DB::raw('sum(amount_cents) as total'))
            ->groupBy('treatment_snapshot')
            ->pluck('total', 'treatment_snapshot')
            ->map(fn ($v): int => (int) $v)
            ->all();
    }
}
