<?php

declare(strict_types=1);

namespace App\Models;

use App\Enums\AuditAction;
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
final class AuditEvent extends BaseModel
{
    use BelongsToTenant;

    protected $table = 'audit_events';

    /** @var list<string> */
    protected $fillable = [
        'tenant_id',
        'actor_user_id',
        'actor_email',
        'actor_role',
        'effective_user_id',
        'impersonation_session_id',
        'action',
        'entity_type',
        'entity_id',
        'entity_label',
        'before_summary',
        'after_summary',
        'reason',
        'ip_address',
        'user_agent',
        'request_id',
        'occurred_at',
    ];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'action' => AuditAction::class,
            'before_summary' => 'array',
            'after_summary' => 'array',
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

    /** @return BelongsTo<User, $this> */
    public function effectiveUser(): BelongsTo
    {
        return $this->belongsTo(User::class, 'effective_user_id');
    }
}
