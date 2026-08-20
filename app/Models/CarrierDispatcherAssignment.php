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
final class CarrierDispatcherAssignment extends BaseModel
{
    use BelongsToTenant, SoftDeletes;

    protected $table = 'carrier_dispatcher_assignments';

    /** @var list<string> */
    protected $fillable = [
        'tenant_id',
        'carrier_id',
        'dispatcher_user_id',
        'is_primary',
        'start_date',
        'end_date',
        'assigned_by_user_id',
        'reason',
        'deleted_by',
        'deletion_reason',
    ];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'is_primary' => 'boolean',
            'start_date' => 'immutable_datetime',
            'end_date' => 'immutable_datetime',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
            'deleted_at' => 'immutable_datetime',
        ];
    }

    /** @return BelongsTo<User, $this> */
    public function assignedByUser(): BelongsTo
    {
        return $this->belongsTo(User::class, 'assigned_by_user_id');
    }

    /** @return BelongsTo<Carrier, $this> */
    public function carrier(): BelongsTo
    {
        return $this->belongsTo(Carrier::class, 'carrier_id');
    }

    /** @return BelongsTo<User, $this> */
    public function dispatcherUser(): BelongsTo
    {
        return $this->belongsTo(User::class, 'dispatcher_user_id');
    }
}
