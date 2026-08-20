<?php

declare(strict_types=1);

namespace App\Models;

use App\Enums\Locale;
use App\Enums\TenantStatus;
use Illuminate\Database\Eloquent\SoftDeletes;

final class Tenant extends BaseModel
{
    use SoftDeletes;

    protected $table = 'tenants';

    /** @var list<string> */
    protected $fillable = [
        'slug',
        'legal_name',
        'display_name',
        'status',
        'custom_domain',
        'custom_domain_verified_at',
        'default_locale',
        'default_timezone',
        'suspended_at',
        'suspension_reason',
        'provisioned_at',
        'deleted_by',
        'deletion_reason',
    ];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'status' => TenantStatus::class,
            'custom_domain_verified_at' => 'immutable_datetime',
            'default_locale' => Locale::class,
            'suspended_at' => 'immutable_datetime',
            'provisioned_at' => 'immutable_datetime',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
            'deleted_at' => 'immutable_datetime',
        ];
    }
}
