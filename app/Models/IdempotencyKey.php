<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;

/**
 * Tiene tenant_id: toda consulta pasa por TenantScope. Para saltárselo hace
 * falta pedirlo a la cara con withoutTenantScope().
 */
final class IdempotencyKey extends BaseModel
{
    use BelongsToTenant;

    protected $table = 'idempotency_keys';

    /** @var list<string> */
    protected $fillable = [
        'tenant_id',
        'scope',
        'key',
        'request_digest',
        'response_snapshot',
        'status',
        'expires_at',
    ];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'response_snapshot' => 'array',
            'expires_at' => 'immutable_datetime',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
        ];
    }
}
