<?php

declare(strict_types=1);

namespace App\Models;

use App\Enums\SubscriptionStatus;
use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Tiene tenant_id: toda consulta pasa por TenantScope. Para saltárselo hace
 * falta pedirlo a la cara con withoutTenantScope().
 */
final class TenantSubscription extends BaseModel
{
    use BelongsToTenant;

    protected $table = 'tenant_subscriptions';

    /** @var list<string> */
    protected $fillable = [
        'tenant_id',
        'plan_id',
        'status',
        'stripe_customer_id',
        'stripe_subscription_id',
        'current_period_start',
        'current_period_end',
        'trial_ends_at',
        'cancel_at_period_end',
        'cancelled_at',
        'past_due_since',
        'limits_enforced_at',
    ];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'status' => SubscriptionStatus::class,
            'current_period_start' => 'immutable_datetime',
            'current_period_end' => 'immutable_datetime',
            'trial_ends_at' => 'immutable_datetime',
            'cancel_at_period_end' => 'boolean',
            'cancelled_at' => 'immutable_datetime',
            'past_due_since' => 'immutable_datetime',
            'limits_enforced_at' => 'immutable_datetime',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
        ];
    }

    /** @return BelongsTo<SaasPlan, $this> */
    public function plan(): BelongsTo
    {
        return $this->belongsTo(SaasPlan::class, 'plan_id');
    }
}
