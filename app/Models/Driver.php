<?php

declare(strict_types=1);

namespace App\Models;

use App\Enums\DriverStatus;
use App\Enums\Locale;
use App\Enums\VerificationStatus;
use App\Enums\WorkAuthorization;
use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * Tiene tenant_id: toda consulta pasa por TenantScope. Para saltárselo hace
 * falta pedirlo a la cara con withoutTenantScope().
 */
final class Driver extends BaseModel
{
    use BelongsToTenant, SoftDeletes;

    protected $table = 'drivers';

    /** @var list<string> */
    protected $fillable = [
        'tenant_id',
        'user_id',
        'first_name',
        'last_name',
        'date_of_birth',
        'email',
        'phone',
        'preferred_locale',
        'license_state',
        'license_country',
        'license_number_encrypted',
        'license_number_last4',
        'license_number_hash',
        'cdl_class',
        'endorsements',
        'twic_card',
        'twic_number_last4',
        'twic_expires_at',
        'twic_verified_at',
        'twic_verified_by_user_id',
        'work_authorization',
        'work_authorization_verified_at',
        'work_authorization_verified_by_user_id',
        'record_clean_years',
        'record_checked_at',
        'record_verified_by_user_id',
        'record_notes',
        'restrictions',
        'license_expires_at',
        'medical_card_expires_at',
        'status',
        'verification_status',
        'verified_by_user_id',
        'verified_at',
        'verification_notes',
        'tracking_consent_granted_at',
        'sms_consent_granted_at',
        'notes',
        'deleted_by',
        'deletion_reason',
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
        'license_number_encrypted',
        'license_number_hash',
    ];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'twic_card' => 'boolean',
            'twic_expires_at' => 'immutable_datetime',
            'twic_verified_at' => 'immutable_datetime',
            'work_authorization' => WorkAuthorization::class,
            'work_authorization_verified_at' => 'immutable_datetime',
            'record_clean_years' => 'integer',
            'record_checked_at' => 'immutable_datetime',
            'date_of_birth' => 'immutable_date',
            'preferred_locale' => Locale::class,
            'license_number_encrypted' => 'encrypted',
            'endorsements' => 'array',
            'restrictions' => 'array',
            'license_expires_at' => 'immutable_datetime',
            'medical_card_expires_at' => 'immutable_datetime',
            'status' => DriverStatus::class,
            'verification_status' => VerificationStatus::class,
            'verified_at' => 'immutable_datetime',
            'tracking_consent_granted_at' => 'immutable_datetime',
            'sms_consent_granted_at' => 'immutable_datetime',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
            'deleted_at' => 'immutable_datetime',
            'archived_at' => 'immutable_datetime',
            'purge_eligible_at' => 'immutable_datetime',
            'legal_hold' => 'boolean',
        ];
    }

    /** @return BelongsTo<User, $this> */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class, 'user_id');
    }

    /** @return BelongsTo<User, $this> */
    public function verifiedByUser(): BelongsTo
    {
        return $this->belongsTo(User::class, 'verified_by_user_id');
    }

    /** @return HasMany<DriverCarrierRelationship, $this> */
    public function driverCarrierRelationships(): HasMany
    {
        return $this->hasMany(DriverCarrierRelationship::class, 'driver_id');
    }

    /** @return HasMany<LoadAssignment, $this> */
    public function loadAssignments(): HasMany
    {
        return $this->hasMany(LoadAssignment::class, 'driver_id');
    }

    /** @return HasMany<TrackingSession, $this> */
    public function trackingSessions(): HasMany
    {
        return $this->hasMany(TrackingSession::class, 'driver_id');
    }
}
