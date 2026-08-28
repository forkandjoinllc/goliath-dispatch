<?php

declare(strict_types=1);

namespace App\Models;

use App\Enums\LoadRequirementType;
use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * Un requisito de una carga. Ver App\Support\Loads\DriverEligibility.
 */
final class LoadRequirement extends BaseModel
{
    use BelongsToTenant, SoftDeletes;

    protected $table = 'load_requirements';

    /** @var list<string> */
    protected $fillable = [
        'tenant_id',
        'load_id',
        'requirement_type',
        'value',
        'source',
        'notes',
        'created_by_user_id',
        'deleted_by',
        'deletion_reason',
    ];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'requirement_type' => LoadRequirementType::class,
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
            'deleted_at' => 'immutable_datetime',
        ];
    }

    /** @return BelongsTo<Load, $this> */
    public function load(): BelongsTo
    {
        return $this->belongsTo(Load::class, 'load_id');
    }
}
