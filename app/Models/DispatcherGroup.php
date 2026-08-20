<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * Tiene tenant_id: toda consulta pasa por TenantScope. Para saltárselo hace
 * falta pedirlo a la cara con withoutTenantScope().
 */
final class DispatcherGroup extends BaseModel
{
    use BelongsToTenant, SoftDeletes;

    protected $table = 'dispatcher_groups';

    /** @var list<string> */
    protected $fillable = [
        'tenant_id',
        'name',
        'description',
        'owner_dispatcher_user_id',
        'active',
        'deleted_by',
        'deletion_reason',
    ];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'active' => 'boolean',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
            'deleted_at' => 'immutable_datetime',
        ];
    }

    /** @return BelongsTo<User, $this> */
    public function ownerDispatcherUser(): BelongsTo
    {
        return $this->belongsTo(User::class, 'owner_dispatcher_user_id');
    }

    /** @return HasMany<GroupMember, $this> */
    public function groupMembers(): HasMany
    {
        return $this->hasMany(GroupMember::class, 'group_id');
    }
}
