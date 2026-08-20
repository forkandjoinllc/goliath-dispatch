<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * Tiene tenant_id: toda consulta pasa por TenantScope. Para saltárselo hace
 * falta pedirlo a la cara con withoutTenantScope().
 */
final class OversizeRule extends BaseModel
{
    use BelongsToTenant, SoftDeletes;

    protected $table = 'oversize_rules';

    /** @var list<string> */
    protected $fillable = [
        'tenant_id',
        'state_code',
        'max_width_inches',
        'max_height_inches',
        'max_length_inches',
        'max_gross_weight_pounds',
        'max_axle_weight_pounds',
        'escort_width_threshold_inches',
        'escort_height_threshold_inches',
        'escort_length_threshold_inches',
        'police_escort_width_threshold_inches',
        'travel_restrictions',
        'permit_required_above_legal',
        'permit_authority_name',
        'permit_authority_url',
        'source_note',
        'last_reviewed_at',
        'deleted_by',
        'deletion_reason',
    ];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'max_width_inches' => 'integer',
            'max_height_inches' => 'integer',
            'max_length_inches' => 'integer',
            'max_gross_weight_pounds' => 'integer',
            'max_axle_weight_pounds' => 'integer',
            'escort_width_threshold_inches' => 'integer',
            'escort_height_threshold_inches' => 'integer',
            'escort_length_threshold_inches' => 'integer',
            'police_escort_width_threshold_inches' => 'integer',
            'travel_restrictions' => 'array',
            'permit_required_above_legal' => 'boolean',
            'last_reviewed_at' => 'immutable_datetime',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
            'deleted_at' => 'immutable_datetime',
        ];
    }
}
