<?php

declare(strict_types=1);

namespace App\Models;

use App\Enums\JobStatus;
use App\Models\Concerns\BelongsToTenant;

/**
 * Tiene tenant_id: toda consulta pasa por TenantScope. Para saltárselo hace
 * falta pedirlo a la cara con withoutTenantScope().
 */
final class JobQueue extends BaseModel
{
    use BelongsToTenant;

    protected $table = 'job_queue';

    /** @var list<string> */
    protected $fillable = [
        'tenant_id',
        'job_type',
        'payload',
        'status',
        'priority',
        'run_at',
        'started_at',
        'completed_at',
        'attempts',
        'max_attempts',
        'last_error',
        'locked_by',
        'locked_until',
        'dedupe_key',
    ];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'payload' => 'array',
            'status' => JobStatus::class,
            'priority' => 'integer',
            'run_at' => 'immutable_datetime',
            'started_at' => 'immutable_datetime',
            'completed_at' => 'immutable_datetime',
            'attempts' => 'integer',
            'max_attempts' => 'integer',
            'locked_until' => 'immutable_datetime',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
        ];
    }
}
