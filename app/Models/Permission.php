<?php

declare(strict_types=1);

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\HasMany;

final class Permission extends BaseModel
{
    protected $table = 'permissions';

    /** @var list<string> */
    protected $fillable = [
        'key',
        'resource',
        'action',
        'description_en',
        'description_es',
    ];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
        ];
    }

    /** @return HasMany<RolePermission, $this> */
    public function rolePermissions(): HasMany
    {
        return $this->hasMany(RolePermission::class, 'permission_id');
    }

    /** @return HasMany<UserPermissionOverride, $this> */
    public function userPermissionOverrides(): HasMany
    {
        return $this->hasMany(UserPermissionOverride::class, 'permission_id');
    }
}
