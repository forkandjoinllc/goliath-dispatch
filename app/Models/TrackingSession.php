<?php

declare(strict_types=1);

namespace App\Models;

use App\Enums\TrackingProvider;
use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * Tiene tenant_id: toda consulta pasa por TenantScope. Para saltárselo hace
 * falta pedirlo a la cara con withoutTenantScope().
 */
final class TrackingSession extends BaseModel
{
    use BelongsToTenant, SoftDeletes;

    protected $table = 'tracking_sessions';

    /** @var list<string> */
    protected $fillable = [
        'tenant_id',
        'load_id',
        'driver_id',
        'truck_id',
        'provider',
        'provider_session_id',
        'consent_granted_at',
        'consent_revoked_at',
        'consent_user_id',
        'started_at',
        'ended_at',
        'health_status',
        'last_event_at',
        'last_latitude',
        'last_longitude',
        'last_location_label',
        'route_progress_percent',
        'remaining_miles',
        'eta_at',
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
            'provider' => TrackingProvider::class,
            'consent_granted_at' => 'immutable_datetime',
            'consent_revoked_at' => 'immutable_datetime',
            'started_at' => 'immutable_datetime',
            'ended_at' => 'immutable_datetime',
            'last_event_at' => 'immutable_datetime',
            'route_progress_percent' => 'integer',
            'remaining_miles' => 'integer',
            'eta_at' => 'immutable_datetime',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
            'deleted_at' => 'immutable_datetime',
            'archived_at' => 'immutable_datetime',
            'purge_eligible_at' => 'immutable_datetime',
            'legal_hold' => 'boolean',
        ];
    }

    /** @return BelongsTo<User, $this> */
    public function consentUser(): BelongsTo
    {
        return $this->belongsTo(User::class, 'consent_user_id');
    }

    /** @return BelongsTo<Driver, $this> */
    public function driver(): BelongsTo
    {
        return $this->belongsTo(Driver::class, 'driver_id');
    }

    /** @return BelongsTo<Load, $this> */
    public function freightLoad(): BelongsTo
    {
        return $this->belongsTo(Load::class, 'load_id');
    }

    /** @return BelongsTo<Truck, $this> */
    public function truck(): BelongsTo
    {
        return $this->belongsTo(Truck::class, 'truck_id');
    }

    /** @return HasMany<TrackingEvent, $this> */
    public function trackingEvents(): HasMany
    {
        return $this->hasMany(TrackingEvent::class, 'session_id');
    }
}
