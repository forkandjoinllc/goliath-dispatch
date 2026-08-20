<?php

declare(strict_types=1);

namespace App\Models;

use App\Enums\OnboardingStatus;
use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * Tiene tenant_id: toda consulta pasa por TenantScope. Para saltárselo hace
 * falta pedirlo a la cara con withoutTenantScope().
 */
final class CarrierOnboarding extends BaseModel
{
    use BelongsToTenant, SoftDeletes;

    protected $table = 'carrier_onboardings';

    /** @var list<string> */
    protected $fillable = [
        'tenant_id',
        'carrier_id',
        'status',
        'submitted_at',
        'review_started_at',
        'decided_at',
        'decided_by_user_id',
        'corrections_requested_at',
        'correction_notes',
        'rejection_reason',
        'required_document_types',
        'checklist',
        'deleted_by',
        'deletion_reason',
        'archived_at',
        'purge_eligible_at',
        'legal_hold',
    ];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'status' => OnboardingStatus::class,
            'submitted_at' => 'immutable_datetime',
            'review_started_at' => 'immutable_datetime',
            'decided_at' => 'immutable_datetime',
            'corrections_requested_at' => 'immutable_datetime',
            'required_document_types' => 'array',
            'checklist' => 'array',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
            'deleted_at' => 'immutable_datetime',
            'archived_at' => 'immutable_datetime',
            'purge_eligible_at' => 'immutable_datetime',
            'legal_hold' => 'boolean',
        ];
    }

    /** @return BelongsTo<Carrier, $this> */
    public function carrier(): BelongsTo
    {
        return $this->belongsTo(Carrier::class, 'carrier_id');
    }

    /** @return BelongsTo<User, $this> */
    public function decidedByUser(): BelongsTo
    {
        return $this->belongsTo(User::class, 'decided_by_user_id');
    }

    /** @return HasMany<CarrierOnboardingEvent, $this> */
    public function carrierOnboardingEvents(): HasMany
    {
        return $this->hasMany(CarrierOnboardingEvent::class, 'onboarding_id');
    }
}
