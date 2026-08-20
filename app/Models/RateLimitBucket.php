<?php

declare(strict_types=1);

namespace App\Models;

final class RateLimitBucket extends BaseModel
{
    protected $table = 'rate_limit_buckets';

    /** @var list<string> */
    protected $fillable = [
        'bucket_key',
        'window_start',
        'count',
    ];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'window_start' => 'immutable_datetime',
            'count' => 'integer',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
        ];
    }
}
