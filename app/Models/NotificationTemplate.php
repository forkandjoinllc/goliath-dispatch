<?php

declare(strict_types=1);

namespace App\Models;

use App\Enums\Locale;
use App\Enums\NotificationChannel;
use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * Tiene tenant_id: toda consulta pasa por TenantScope. Para saltárselo hace
 * falta pedirlo a la cara con withoutTenantScope().
 */
final class NotificationTemplate extends BaseModel
{
    use BelongsToTenant, SoftDeletes;

    protected $table = 'notification_templates';

    /** @var list<string> */
    protected $fillable = [
        'tenant_id',
        'event_key',
        'channel',
        'locale',
        'subject',
        'body',
        'available_tokens',
        'active',
        'deleted_by',
        'deletion_reason',
    ];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'channel' => NotificationChannel::class,
            'locale' => Locale::class,
            'available_tokens' => 'array',
            'active' => 'boolean',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
            'deleted_at' => 'immutable_datetime',
        ];
    }
}
