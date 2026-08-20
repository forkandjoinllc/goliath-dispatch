<?php

declare(strict_types=1);

namespace App\Models;

final class LoginAttempt extends BaseModel
{
    protected $table = 'login_attempts';

    /** @var list<string> */
    protected $fillable = [
        'email_normalized',
        'ip_address',
        'successful',
        'failure_reason',
        'user_agent',
    ];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'successful' => 'boolean',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
        ];
    }
}
