<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * Tiene tenant_id: toda consulta pasa por TenantScope. Para saltárselo hace
 * falta pedirlo a la cara con withoutTenantScope().
 */
final class CarrierSettlementLine extends BaseModel
{
    use BelongsToTenant, SoftDeletes;

    protected $table = 'carrier_settlement_lines';

    /** @var list<string> */
    protected $fillable = [
        'tenant_id',
        'settlement_id',
        'load_id',
        'financial_snapshot_id',
        'description_en',
        'description_es',
        'gross_rate_cents',
        'reimbursements_cents',
        'dispatch_fee_cents',
        'deductions_cents',
        'net_cents',
        'deleted_by',
        'deletion_reason',
    ];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'gross_rate_cents' => 'integer',
            'reimbursements_cents' => 'integer',
            'dispatch_fee_cents' => 'integer',
            'deductions_cents' => 'integer',
            'net_cents' => 'integer',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
            'deleted_at' => 'immutable_datetime',
        ];
    }

    /** @return BelongsTo<FinancialSnapshot, $this> */
    public function financialSnapshot(): BelongsTo
    {
        return $this->belongsTo(FinancialSnapshot::class, 'financial_snapshot_id');
    }

    /** @return BelongsTo<Load, $this> */
    public function freightLoad(): BelongsTo
    {
        return $this->belongsTo(Load::class, 'load_id');
    }

    /** @return BelongsTo<CarrierSettlement, $this> */
    public function settlement(): BelongsTo
    {
        return $this->belongsTo(CarrierSettlement::class, 'settlement_id');
    }
}
