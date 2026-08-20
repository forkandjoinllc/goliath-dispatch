<?php

declare(strict_types=1);

namespace App\Models;

use App\Enums\CommissionBasis;
use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * Tabla APPEND-ONLY. El esquema lleva triggers que rechazan UPDATE y DELETE
 * con SIGNAL SQLSTATE '45000'. Un `save()` sobre una fila existente o un
 * `delete()` NO fallan silenciosamente: lanzan una QueryException. Es
 * intencionado — la pista de auditoría no se corrige, se anexa.
 *
 * Tiene tenant_id: toda consulta pasa por TenantScope. Para saltárselo hace
 * falta pedirlo a la cara con withoutTenantScope().
 */
final class FinancialSnapshot extends BaseModel
{
    use BelongsToTenant;

    protected $table = 'financial_snapshots';

    /** @var list<string> */
    protected $fillable = [
        'tenant_id',
        'load_id',
        'version',
        'customer_charge_cents',
        'carrier_gross_rate_cents',
        'carrier_dispatch_fee_bps',
        'dispatcher_commission_bps',
        'dispatcher_commission_basis',
        'approved_excluded_expenses_cents',
        'approved_reimbursable_expenses_cents',
        'tenant_absorbed_expenses_cents',
        'carrier_deductions_cents',
        'commissionable_base_cents',
        'dispatch_fee_amount_cents',
        'net_carrier_settlement_cents',
        'gross_margin_cents',
        'dispatcher_commission_amount_cents',
        'expense_breakdown',
        'formula_version',
        'reason',
        'computed_by_user_id',
        'computed_at',
        'archived_at',
        'purge_eligible_at',
        'legal_hold',
    ];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'version' => 'integer',
            'customer_charge_cents' => 'integer',
            'carrier_gross_rate_cents' => 'integer',
            'carrier_dispatch_fee_bps' => 'integer',
            'dispatcher_commission_bps' => 'integer',
            'dispatcher_commission_basis' => CommissionBasis::class,
            'approved_excluded_expenses_cents' => 'integer',
            'approved_reimbursable_expenses_cents' => 'integer',
            'tenant_absorbed_expenses_cents' => 'integer',
            'carrier_deductions_cents' => 'integer',
            'commissionable_base_cents' => 'integer',
            'dispatch_fee_amount_cents' => 'integer',
            'net_carrier_settlement_cents' => 'integer',
            'gross_margin_cents' => 'integer',
            'dispatcher_commission_amount_cents' => 'integer',
            'expense_breakdown' => 'array',
            'computed_at' => 'immutable_datetime',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
            'archived_at' => 'immutable_datetime',
            'purge_eligible_at' => 'immutable_datetime',
            'legal_hold' => 'boolean',
        ];
    }

    /** @return BelongsTo<User, $this> */
    public function computedByUser(): BelongsTo
    {
        return $this->belongsTo(User::class, 'computed_by_user_id');
    }

    /** @return BelongsTo<Load, $this> */
    public function freightLoad(): BelongsTo
    {
        return $this->belongsTo(Load::class, 'load_id');
    }

    /** @return HasMany<CarrierSettlementLine, $this> */
    public function carrierSettlementLines(): HasMany
    {
        return $this->hasMany(CarrierSettlementLine::class, 'financial_snapshot_id');
    }

    /** @return HasMany<DispatcherCommission, $this> */
    public function dispatcherCommissions(): HasMany
    {
        return $this->hasMany(DispatcherCommission::class, 'financial_snapshot_id');
    }
}
