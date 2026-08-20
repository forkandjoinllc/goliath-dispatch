<?php

declare(strict_types=1);

namespace App\Models;

use App\Enums\JobStatus;
use App\Models\Concerns\BelongsToTenant;

/**
 * Tiene tenant_id: toda consulta pasa por TenantScope. Para saltárselo hace
 * falta pedirlo a la cara con withoutTenantScope().
 */
final class RetentionJob extends BaseModel
{
    use BelongsToTenant;

    protected $table = 'retention_jobs';

    /** @var list<string> */
    protected $fillable = [
        'tenant_id',
        'action',
        'entity_type',
        'status',
        'cutoff_at',
        'candidate_count',
        'processed_count',
        'skipped_legal_hold_count',
        'error_message',
        'started_at',
        'completed_at',
    ];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'status' => JobStatus::class,
            'cutoff_at' => 'immutable_datetime',
            'candidate_count' => 'integer',
            'processed_count' => 'integer',
            'skipped_legal_hold_count' => 'integer',
            'started_at' => 'immutable_datetime',
            'completed_at' => 'immutable_datetime',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
        ];
    }
}
