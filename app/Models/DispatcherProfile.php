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
final class DispatcherProfile extends BaseModel
{
    use BelongsToTenant, SoftDeletes;

    protected $table = 'dispatcher_profiles';

    /** @var list<string> */
    protected $fillable = [
        'tenant_id',
        'user_id',
        'commission_bps',
        'employee_code',
        'hired_on',
        'active',
        'notes',
        'deleted_by',
        'deletion_reason',
    ];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'commission_bps' => 'integer',
            'hired_on' => 'immutable_datetime',
            'active' => 'boolean',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
            'deleted_at' => 'immutable_datetime',
        ];
    }

    /** @return BelongsTo<User, $this> */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class, 'user_id');
    }
}
