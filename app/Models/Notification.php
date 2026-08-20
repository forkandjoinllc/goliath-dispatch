<?php

declare(strict_types=1);

namespace App\Models;

use App\Enums\Locale;
use App\Enums\NotificationChannel;
use App\Enums\NotificationStatus;
use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * Tiene tenant_id: toda consulta pasa por TenantScope. Para saltárselo hace
 * falta pedirlo a la cara con withoutTenantScope().
 */
final class Notification extends BaseModel
{
    use BelongsToTenant, SoftDeletes;

    protected $table = 'notifications';

    /** @var list<string> */
    protected $fillable = [
        'tenant_id',
        'user_id',
        'event_key',
        'channel',
        'status',
        'locale',
        'title',
        'body',
        'action_url',
        'subject_type',
        'subject_id',
        'dedupe_key',
        'provider_message_id',
        'failure_reason',
        'sent_at',
        'read_at',
        'deleted_by',
        'deletion_reason',
        'archived_at',
        'purge_eligible_at',
        'legal_hold',
    ];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'channel' => NotificationChannel::class,
            'status' => NotificationStatus::class,
            'locale' => Locale::class,
            'sent_at' => 'immutable_datetime',
            'read_at' => 'immutable_datetime',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
            'deleted_at' => 'immutable_datetime',
            'archived_at' => 'immutable_datetime',
            'purge_eligible_at' => 'immutable_datetime',
            'legal_hold' => 'boolean',
        ];
    }

    /** @return BelongsTo<User, $this> */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class, 'user_id');
    }
}
