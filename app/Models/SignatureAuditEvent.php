<?php

declare(strict_types=1);

namespace App\Models;

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
final class SignatureAuditEvent extends BaseModel
{
    use BelongsToTenant;

    protected $table = 'signature_audit_events';

    /** @var list<string> */
    protected $fillable = [
        'tenant_id',
        'request_id',
        'record_id',
        'event_type',
        'actor_user_id',
        'actor_email',
        'ip_address',
        'user_agent',
        'detail',
        'previous_event_hash',
        'event_hash',
        'occurred_at',
        'archived_at',
        'purge_eligible_at',
        'legal_hold',
    ];

    /**
     * Nunca se serializan hacia el cliente. Son hashes, tokens y secretos:
     * el valor en claro no existe en la base de datos, y el hash tampoco tiene
     * por qué salir de ella.
     *
     * @var list<string>
     */
    protected $hidden = [
        'previous_event_hash',
        'event_hash',
    ];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'detail' => 'array',
            'occurred_at' => 'immutable_datetime',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
            'archived_at' => 'immutable_datetime',
            'purge_eligible_at' => 'immutable_datetime',
            'legal_hold' => 'boolean',
        ];
    }

    /** @return BelongsTo<User, $this> */
    public function actorUser(): BelongsTo
    {
        return $this->belongsTo(User::class, 'actor_user_id');
    }

    /** @return BelongsTo<SignatureRecord, $this> */
    public function record(): BelongsTo
    {
        return $this->belongsTo(SignatureRecord::class, 'record_id');
    }

    /** @return BelongsTo<SignatureRequest, $this> */
    public function request(): BelongsTo
    {
        return $this->belongsTo(SignatureRequest::class, 'request_id');
    }
}
