<?php

declare(strict_types=1);

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

final class SaasPlan extends BaseModel
{
    use SoftDeletes;

    protected $table = 'saas_plans';

    /** @var list<string> */
    protected $fillable = [
        'code',
        'name_en',
        'name_es',
        'description_en',
        'description_es',
        'monthly_price_cents',
        'stripe_price_id',
        'stripe_product_id',
        'trial_days',
        'max_users',
        'max_carriers',
        'max_loads_per_month',
        'features',
        'is_public',
        'sort_order',
        'deleted_by',
        'deletion_reason',
    ];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'monthly_price_cents' => 'integer',
            'trial_days' => 'integer',
            'max_users' => 'integer',
            'max_carriers' => 'integer',
            'max_loads_per_month' => 'integer',
            'features' => 'array',
            'is_public' => 'boolean',
            'sort_order' => 'integer',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
            'deleted_at' => 'immutable_datetime',
        ];
    }

    /** @return HasMany<TenantSubscription, $this> */
    public function tenantSubscriptions(): HasMany
    {
        return $this->hasMany(TenantSubscription::class, 'plan_id');
    }
}
