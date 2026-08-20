<?php

declare(strict_types=1);

namespace App\Models;

use App\Enums\LoadStatus;
use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Tabla APPEND-ONLY. El esquema lleva triggers que rechazan UPDATE y DELETE
 * con SIGNAL SQLSTATE '45000'. Un `save()` sobre una fila existente o un
 * `delete()` NO fallan silenciosamente: lanzan una QueryException. Es
 * intencionado — la pista de auditoría no se corrige, se anexa.
 *
 * Tiene tenant_id: toda consulta pasa por TenantScope. Para saltárselo hace
 * falta pedirlo a la cara con withoutTenantScope().
 */
final class LoadStatusHistory extends BaseModel
{
    use BelongsToTenant;

    protected $table = 'load_status_history';

    /** @var list<string> */
    protected $fillable = [
        'tenant_id',
        'load_id',
        'from_status',
        'to_status',
        'actor_user_id',
        'source',
        'source_reference',
        'notes',
        'ip_address',
        'user_agent',
        'occurred_at',
    ];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'to_status' => LoadStatus::class,
            'occurred_at' => 'immutable_datetime',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
        ];
    }

    /** @return BelongsTo<User, $this> */
    public function actorUser(): BelongsTo
    {
        return $this->belongsTo(User::class, 'actor_user_id');
    }

    /** @return BelongsTo<Load, $this> */
    public function freightLoad(): BelongsTo
    {
        return $this->belongsTo(Load::class, 'load_id');
    }
}
