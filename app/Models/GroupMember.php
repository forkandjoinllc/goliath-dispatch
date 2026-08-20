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
final class GroupMember extends BaseModel
{
    use BelongsToTenant, SoftDeletes;

    protected $table = 'group_members';

    /** @var list<string> */
    protected $fillable = [
        'tenant_id',
        'group_id',
        'member_type',
        'member_id',
        'added_by_user_id',
        'deleted_by',
        'deletion_reason',
    ];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
            'deleted_at' => 'immutable_datetime',
        ];
    }

    /** @return BelongsTo<User, $this> */
    public function addedByUser(): BelongsTo
    {
        return $this->belongsTo(User::class, 'added_by_user_id');
    }

    /** @return BelongsTo<DispatcherGroup, $this> */
    public function group(): BelongsTo
    {
        return $this->belongsTo(DispatcherGroup::class, 'group_id');
    }
}
