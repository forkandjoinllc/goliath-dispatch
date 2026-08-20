<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Tiene tenant_id: toda consulta pasa por TenantScope. Para saltárselo hace
 * falta pedirlo a la cara con withoutTenantScope().
 */
final class OversizeEvaluation extends BaseModel
{
    use BelongsToTenant;

    protected $table = 'oversize_evaluations';

    /** @var list<string> */
    protected $fillable = [
        'tenant_id',
        'load_id',
        'route_id',
        'outcome',
        'permit_likely_required',
        'escort_likely_required',
        'police_escort_likely_required',
        'inputs',
        'state_results',
        'missing_data_warnings',
        'human_validation_status',
        'validated_by_user_id',
        'validated_at',
        'validation_notes',
        'evaluated_at',
    ];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'permit_likely_required' => 'boolean',
            'escort_likely_required' => 'boolean',
            'police_escort_likely_required' => 'boolean',
            'inputs' => 'array',
            'state_results' => 'array',
            'missing_data_warnings' => 'array',
            'validated_at' => 'immutable_datetime',
            'evaluated_at' => 'immutable_datetime',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
        ];
    }

    /** @return BelongsTo<Load, $this> */
    public function freightLoad(): BelongsTo
    {
        return $this->belongsTo(Load::class, 'load_id');
    }

    /** @return BelongsTo<Route, $this> */
    public function route(): BelongsTo
    {
        return $this->belongsTo(Route::class, 'route_id');
    }

    /** @return BelongsTo<User, $this> */
    public function validatedByUser(): BelongsTo
    {
        return $this->belongsTo(User::class, 'validated_by_user_id');
    }
}
