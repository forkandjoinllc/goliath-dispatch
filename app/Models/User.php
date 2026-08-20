<?php

declare(strict_types=1);

namespace App\Models;

use App\Enums\Locale;
use App\Enums\UserStatus;
use App\Models\Concerns\HasUuidKey;
use Illuminate\Contracts\Auth\MustVerifyEmail;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;

/**
 * Un usuario de la plataforma.
 *
 * Ojo con una cosa: `users` NO tiene tenant_id. Un usuario puede pertenecer a
 * varias empresas, y eso vive en `user_tenant_memberships`. El rol tampoco está
 * aquí: es una propiedad de la pertenencia, no de la persona. La misma persona
 * puede ser Admin en una empresa y Dispatcher en otra.
 *
 * Por eso este modelo no lleva BelongsToTenant y por eso no existe
 * `$user->role`: preguntarlo sin decir en qué empresa no tiene respuesta.
 */
class User extends Authenticatable implements MustVerifyEmail
{
    use HasUuidKey, Notifiable, SoftDeletes;

    protected $table = 'users';

    protected $keyType = 'string';

    public $incrementing = false;

    /** Milisegundos, para no truncar al escribir en datetime(3). */
    protected $dateFormat = 'Y-m-d H:i:s.v';

    /** @var list<string> */
    protected $fillable = [
        'email',
        'email_normalized',
        'password',
        'first_name',
        'last_name',
        'phone',
        'locale',
        'timezone',
        'avatar_storage_key',
        'status',
        'email_verified_at',
        'is_platform_super_admin',
        'last_login_at',
        'last_login_ip',
        'failed_login_attempts',
        'locked_until',
        'password_changed_at',
        'must_change_password',
        'deleted_by',
        'deletion_reason',
    ];

    /** @var list<string> */
    protected $hidden = [
        'password',
        'remember_token',
    ];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'password' => 'hashed',
            'locale' => Locale::class,
            'status' => UserStatus::class,
            'email_verified_at' => 'immutable_datetime',
            'is_platform_super_admin' => 'boolean',
            'last_login_at' => 'immutable_datetime',
            'failed_login_attempts' => 'integer',
            'locked_until' => 'immutable_datetime',
            'password_changed_at' => 'immutable_datetime',
            'must_change_password' => 'boolean',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
            'deleted_at' => 'immutable_datetime',
        ];
    }

    /**
     * El correo se normaliza siempre al escribirlo, porque la unicidad se aplica
     * sobre `email_normalized` (vía la columna generada `live_email_key`). Si
     * esto se dejara al código que llama, el primer sitio que lo olvidara
     * permitiría dos cuentas que para cualquier persona son la misma.
     */
    public function setEmailAttribute(string $value): void
    {
        $this->attributes['email'] = trim($value);
        $this->attributes['email_normalized'] = mb_strtolower(trim($value));
    }

    public function fullName(): string
    {
        return trim("{$this->first_name} {$this->last_name}");
    }

    /**
     * Una cuenta bloqueada por intentos fallidos. Se comprueba en el login,
     * antes de verificar la contraseña, para que un ataque de fuerza bruta no
     * obtenga información del tiempo de respuesta del hash.
     */
    public function isLocked(): bool
    {
        return $this->locked_until !== null && $this->locked_until->isFuture();
    }

    /** @return HasMany<UserTenantMembership, $this> */
    public function memberships(): HasMany
    {
        return $this->hasMany(UserTenantMembership::class, 'user_id');
    }

    /** @return HasMany<MfaConfiguration, $this> */
    public function mfaConfigurations(): HasMany
    {
        return $this->hasMany(MfaConfiguration::class, 'user_id');
    }

    /** @return HasMany<UserPermissionOverride, $this> */
    public function permissionOverrides(): HasMany
    {
        return $this->hasMany(UserPermissionOverride::class, 'user_id');
    }

    /** @return HasMany<ConsentRecord, $this> */
    public function consentRecords(): HasMany
    {
        return $this->hasMany(ConsentRecord::class, 'user_id');
    }

    /** @return HasMany<CarrierUser, $this> */
    public function carrierUsers(): HasMany
    {
        return $this->hasMany(CarrierUser::class, 'user_id');
    }

    /** @return HasMany<DispatcherProfile, $this> */
    public function dispatcherProfiles(): HasMany
    {
        return $this->hasMany(DispatcherProfile::class, 'user_id');
    }
}
