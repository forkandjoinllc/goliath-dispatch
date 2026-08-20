<?php

declare(strict_types=1);

namespace App\Models;

use App\Enums\CommissionBasis;
use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * Tiene tenant_id: toda consulta pasa por TenantScope. Para saltárselo hace
 * falta pedirlo a la cara con withoutTenantScope().
 */
final class DispatcherCommission extends BaseModel
{
    use BelongsToTenant, SoftDeletes;

    protected $table = 'dispatcher_commissions';

    /** @var list<string> */
    protected $fillable = [
        'tenant_id',
        'load_id',
        'dispatcher_user_id',
        'financial_snapshot_id',
        'basis',
        'basis_amount_cents',
        'percentage_bps',
        'amount_cents',
        'status',
        'paid_at',
        'deleted_by',
        'deletion_reason',
        'archived_at',
        'purge_eligible_at',
        'legal_hold',
    ];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'basis' => CommissionBasis::class,
            'basis_amount_cents' => 'integer',
            'percentage_bps' => 'integer',
            'amount_cents' => 'integer',
            'paid_at' => 'immutable_datetime',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
            'deleted_at' => 'immutable_datetime',
            'archived_at' => 'immutable_datetime',
            'purge_eligible_at' => 'immutable_datetime',
            'legal_hold' => 'boolean',
        ];
    }

    /** @return BelongsTo<User, $this> */
    public function dispatcherUser(): BelongsTo
    {
        return $this->belongsTo(User::class, 'dispatcher_user_id');
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
}
