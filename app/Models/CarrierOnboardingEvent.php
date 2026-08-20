<?php

declare(strict_types=1);

namespace App\Models;

use App\Enums\OnboardingStatus;
use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Tiene tenant_id: toda consulta pasa por TenantScope. Para saltárselo hace
 * falta pedirlo a la cara con withoutTenantScope().
 */
final class CarrierOnboardingEvent extends BaseModel
{
    use BelongsToTenant;

    protected $table = 'carrier_onboarding_events';

    /** @var list<string> */
    protected $fillable = [
        'tenant_id',
        'onboarding_id',
        'from_status',
        'to_status',
        'actor_user_id',
        'reason',
    ];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'to_status' => OnboardingStatus::class,
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
        ];
    }

    /** @return BelongsTo<User, $this> */
    public function actorUser(): BelongsTo
    {
        return $this->belongsTo(User::class, 'actor_user_id');
    }

    /** @return BelongsTo<CarrierOnboarding, $this> */
    public function onboarding(): BelongsTo
    {
        return $this->belongsTo(CarrierOnboarding::class, 'onboarding_id');
    }
}
