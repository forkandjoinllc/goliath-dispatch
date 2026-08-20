<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * Tiene tenant_id: toda consulta pasa por TenantScope. Para saltárselo hace
 * falta pedirlo a la cara con withoutTenantScope().
 */
final class Route extends BaseModel
{
    use BelongsToTenant, SoftDeletes;

    protected $table = 'routes';

    /** @var list<string> */
    protected $fillable = [
        'tenant_id',
        'load_id',
        'provider',
        'total_miles',
        'estimated_duration_minutes',
        'estimated_toll_cents',
        'polyline',
        'legs',
        'raw_reference',
        'calculated_at',
        'is_current',
        'deleted_by',
        'deletion_reason',
    ];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'total_miles' => 'integer',
            'estimated_duration_minutes' => 'integer',
            'estimated_toll_cents' => 'integer',
            'legs' => 'array',
            'calculated_at' => 'immutable_datetime',
            'is_current' => 'boolean',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
            'deleted_at' => 'immutable_datetime',
        ];
    }

    /** @return BelongsTo<Load, $this> */
    public function freightLoad(): BelongsTo
    {
        return $this->belongsTo(Load::class, 'load_id');
    }

    /** @return HasMany<OversizeEvaluation, $this> */
    public function oversizeEvaluations(): HasMany
    {
        return $this->hasMany(OversizeEvaluation::class, 'route_id');
    }

    /** @return HasMany<RouteState, $this> */
    public function routeStates(): HasMany
    {
        return $this->hasMany(RouteState::class, 'route_id');
    }
}
