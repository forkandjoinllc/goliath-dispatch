<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;

/**
 * El esquema impide borrar filas de esta tabla y restringe qué columnas
 * pueden actualizarse (trigger de guarda). Ver database/schema/9*.sql.
 *
 * Tiene tenant_id: toda consulta pasa por TenantScope. Para saltárselo hace
 * falta pedirlo a la cara con withoutTenantScope().
 */
final class StripeEvent extends BaseModel
{
    use BelongsToTenant;

    protected $table = 'stripe_events';

    /** @var list<string> */
    protected $fillable = [
        'tenant_id',
        'stripe_event_id',
        'event_type',
        'api_version',
        'processing_status',
        'payload_digest',
        'payload',
        'processed_at',
        'error_message',
        'attempts',
    ];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'payload' => 'array',
            'processed_at' => 'immutable_datetime',
            'attempts' => 'integer',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
        ];
    }
}
