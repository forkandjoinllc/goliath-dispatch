<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * Tiene tenant_id: toda consulta pasa por TenantScope. Para saltárselo hace
 * falta pedirlo a la cara con withoutTenantScope().
 */
final class IntegrationConnection extends BaseModel
{
    use BelongsToTenant, SoftDeletes;

    protected $table = 'integration_connections';

    /** @var list<string> */
    protected $fillable = [
        'tenant_id',
        'category',
        'provider',
        'display_name',
        'enabled',
        'credentials_encrypted',
        'config',
        'health_status',
        'last_checked_at',
        'last_error_message',
        'deleted_by',
        'deletion_reason',
    ];

    /**
     * Nunca se serializan hacia el cliente. Son hashes, tokens y secretos:
     * el valor en claro no existe en la base de datos, y el hash tampoco tiene
     * por qué salir de ella.
     *
     * @var list<string>
     */
    protected $hidden = [
        'credentials_encrypted',
    ];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'enabled' => 'boolean',
            'credentials_encrypted' => 'encrypted',
            'config' => 'array',
            'last_checked_at' => 'immutable_datetime',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
            'deleted_at' => 'immutable_datetime',
        ];
    }
}
