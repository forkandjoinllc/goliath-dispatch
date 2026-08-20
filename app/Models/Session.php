<?php

declare(strict_types=1);

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * Una sesión, en la forma nativa de Laravel más las cuatro columnas que el
 * dominio necesita.
 *
 * La tabla la escribe el driver de sesión de Laravel en cada petición; este
 * modelo es solo de LECTURA para la aplicación, con dos excepciones legítimas:
 * cambiar `active_tenant_id` al conmutar de empresa, y marcar `revoked_at` al
 * cerrar sesiones a distancia. Nunca se crea una fila desde aquí.
 *
 * No hereda de BaseModel porque no encaja en ninguna de sus convenciones: la
 * clave primaria es una cadena de 40 caracteres que genera Laravel (no un UUID),
 * y no hay created_at/updated_at sino `last_activity` en segundos Unix.
 *
 * Ver la sección "Sesiones" de docs/mysql-port.md para el porqué de esta forma.
 */
class Session extends Model
{
    protected $table = 'sessions';

    protected $primaryKey = 'id';

    protected $keyType = 'string';

    public $incrementing = false;

    public $timestamps = false;

    /**
     * Columnas que escribe el driver de sesión de Laravel por el query builder,
     * no este modelo. Están declaradas aquí para que la prueba de concordancia
     * con el esquema sepa que su ausencia en $fillable es deliberada y no un
     * olvido — la exención vive junto al motivo, no escondida en el test.
     *
     * @var list<string>
     */
    public const WRITTEN_BY_FRAMEWORK = [
        'id',
        'user_id',
        'ip_address',
        'user_agent',
        'payload',
        'last_activity',
    ];

    /** @var list<string> */
    protected $fillable = [
        'active_tenant_id',
        'revoked_at',
        'revoked_reason',
        'mfa_satisfied_at',
    ];

    /**
     * `payload` es el blob serializado de Laravel. No tiene nada que hacer en una
     * respuesta HTTP ni en un log: puede contener datos flasheados, tokens CSRF y
     * cualquier cosa que la aplicación haya metido en la sesión.
     *
     * @var list<string>
     */
    protected $hidden = [
        'payload',
    ];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'last_activity' => 'integer',
            'mfa_satisfied_at' => 'immutable_datetime',
            'revoked_at' => 'immutable_datetime',
        ];
    }

    protected $dateFormat = 'Y-m-d H:i:s.v';

    /** @return BelongsTo<User, $this> */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class, 'user_id');
    }

    /** @return BelongsTo<Tenant, $this> */
    public function activeTenant(): BelongsTo
    {
        return $this->belongsTo(Tenant::class, 'active_tenant_id');
    }

    /** @return HasMany<ImpersonationSession, $this> */
    public function impersonationSessions(): HasMany
    {
        return $this->hasMany(ImpersonationSession::class, 'session_id');
    }

    public function isRevoked(): bool
    {
        return $this->revoked_at !== null;
    }

    /** El segundo factor está satisfecho para ESTA sesión, no para el usuario. */
    public function hasSatisfiedMfa(): bool
    {
        return $this->mfa_satisfied_at !== null;
    }
}
