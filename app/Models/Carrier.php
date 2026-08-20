<?php

declare(strict_types=1);

namespace App\Models;

use App\Enums\Locale;
use App\Enums\OnboardingStatus;
use App\Enums\VerificationStatus;
use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * Tiene tenant_id: toda consulta pasa por TenantScope. Para saltárselo hace
 * falta pedirlo a la cara con withoutTenantScope().
 */
final class Carrier extends BaseModel
{
    use BelongsToTenant, SoftDeletes;

    protected $table = 'carriers';

    /** @var list<string> */
    protected $fillable = [
        'tenant_id',
        'legal_name',
        'dba',
        'dot_number',
        'mc_number',
        'ein_encrypted',
        'ein_last4',
        'contact_first_name',
        'contact_last_name',
        'email',
        'phone',
        'website',
        'preferred_locale',
        'physical_line1',
        'physical_line2',
        'physical_city',
        'physical_state',
        'physical_postal_code',
        'physical_country',
        'physical_place_id',
        'mailing_same_as_physical',
        'mailing_line1',
        'mailing_line2',
        'mailing_city',
        'mailing_state',
        'mailing_postal_code',
        'mailing_country',
        'dispatch_fee_bps',
        'onboarding_status',
        'fmcsa_status',
        'fmcsa_last_verified_at',
        'fmcsa_next_verification_at',
        'approved_at',
        'approved_by_user_id',
        'suspended_at',
        'suspension_reason',
        'uses_factoring',
        'notes',
        'last_activity_at',
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
        'ein_encrypted',
    ];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'ein_encrypted' => 'encrypted',
            'preferred_locale' => Locale::class,
            'mailing_same_as_physical' => 'boolean',
            'dispatch_fee_bps' => 'integer',
            'onboarding_status' => OnboardingStatus::class,
            'fmcsa_status' => VerificationStatus::class,
            'fmcsa_last_verified_at' => 'immutable_datetime',
            'fmcsa_next_verification_at' => 'immutable_datetime',
            'approved_at' => 'immutable_datetime',
            'suspended_at' => 'immutable_datetime',
            'uses_factoring' => 'boolean',
            'last_activity_at' => 'immutable_datetime',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
            'deleted_at' => 'immutable_datetime',
            'archived_at' => 'immutable_datetime',
            'purge_eligible_at' => 'immutable_datetime',
            'legal_hold' => 'boolean',
        ];
    }

    /** @return BelongsTo<User, $this> */
    public function approvedByUser(): BelongsTo
    {
        return $this->belongsTo(User::class, 'approved_by_user_id');
    }

    /** @return HasMany<CarrierDispatcherAssignment, $this> */
    public function carrierDispatcherAssignments(): HasMany
    {
        return $this->hasMany(CarrierDispatcherAssignment::class, 'carrier_id');
    }

    /** @return HasOne<CarrierOnboarding, $this> */
    public function carrierOnboarding(): HasOne
    {
        // hasOne y no hasMany: CarrierOnboarding.carrier_id tiene índice único.
        return $this->hasOne(CarrierOnboarding::class, 'carrier_id');
    }

    /** @return HasMany<CarrierSettlement, $this> */
    public function carrierSettlements(): HasMany
    {
        return $this->hasMany(CarrierSettlement::class, 'carrier_id');
    }

    /** @return HasMany<CarrierUser, $this> */
    public function carrierUsers(): HasMany
    {
        return $this->hasMany(CarrierUser::class, 'carrier_id');
    }

    /** @return HasMany<Conversation, $this> */
    public function conversations(): HasMany
    {
        return $this->hasMany(Conversation::class, 'carrier_id');
    }

    /** @return HasMany<DriverCarrierRelationship, $this> */
    public function driverCarrierRelationships(): HasMany
    {
        return $this->hasMany(DriverCarrierRelationship::class, 'carrier_id');
    }

    /** @return HasMany<EquipmentVerification, $this> */
    public function equipmentVerifications(): HasMany
    {
        return $this->hasMany(EquipmentVerification::class, 'carrier_id');
    }

    /** @return HasMany<Expense, $this> */
    public function expenses(): HasMany
    {
        return $this->hasMany(Expense::class, 'carrier_id');
    }

    /** @return HasMany<FactoringAssignment, $this> */
    public function factoringAssignments(): HasMany
    {
        return $this->hasMany(FactoringAssignment::class, 'carrier_id');
    }

    /** @return HasMany<FmcsaVerification, $this> */
    public function fmcsaVerifications(): HasMany
    {
        return $this->hasMany(FmcsaVerification::class, 'carrier_id');
    }

    /** @return HasMany<Invoice, $this> */
    public function invoices(): HasMany
    {
        return $this->hasMany(Invoice::class, 'carrier_id');
    }

    /** @return HasMany<Load, $this> */
    public function loads(): HasMany
    {
        return $this->hasMany(Load::class, 'carrier_id');
    }

    /** @return HasMany<RateConfirmationAcceptance, $this> */
    public function rateConfirmationAcceptances(): HasMany
    {
        return $this->hasMany(RateConfirmationAcceptance::class, 'carrier_id');
    }

    /** @return HasMany<SignatureRequest, $this> */
    public function signatureRequests(): HasMany
    {
        return $this->hasMany(SignatureRequest::class, 'carrier_id');
    }

    /** @return HasMany<Trailer, $this> */
    public function trailers(): HasMany
    {
        return $this->hasMany(Trailer::class, 'carrier_id');
    }

    /** @return HasMany<Truck, $this> */
    public function trucks(): HasMany
    {
        return $this->hasMany(Truck::class, 'carrier_id');
    }
}
