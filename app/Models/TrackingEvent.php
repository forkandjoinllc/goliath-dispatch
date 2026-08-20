<?php

declare(strict_types=1);

namespace App\Models;

use App\Enums\TrackingEventType;
use App\Enums\TrackingProvider;
use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Tiene tenant_id: toda consulta pasa por TenantScope. Para saltárselo hace
 * falta pedirlo a la cara con withoutTenantScope().
 */
final class TrackingEvent extends BaseModel
{
    use BelongsToTenant;

    protected $table = 'tracking_events';

    /** @var list<string> */
    protected $fillable = [
        'tenant_id',
        'session_id',
        'load_id',
        'provider',
        'event_type',
        'latitude',
        'longitude',
        'speed_mph',
        'heading_degrees',
        'location_label',
        'stop_id',
        'raw_provider_reference',
        'raw_payload',
        'occurred_at',
        'ingested_at',
        'archived_at',
        'purge_eligible_at',
        'legal_hold',
    ];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'provider' => TrackingProvider::class,
            'event_type' => TrackingEventType::class,
            'speed_mph' => 'integer',
            'heading_degrees' => 'integer',
            'raw_payload' => 'array',
            'occurred_at' => 'immutable_datetime',
            'ingested_at' => 'immutable_datetime',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
            'archived_at' => 'immutable_datetime',
            'purge_eligible_at' => 'immutable_datetime',
            'legal_hold' => 'boolean',
        ];
    }

    /** @return BelongsTo<Load, $this> */
    public function freightLoad(): BelongsTo
    {
        return $this->belongsTo(Load::class, 'load_id');
    }

    /** @return BelongsTo<TrackingSession, $this> */
    public function session(): BelongsTo
    {
        return $this->belongsTo(TrackingSession::class, 'session_id');
    }
}
