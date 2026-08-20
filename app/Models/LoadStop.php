<?php

declare(strict_types=1);

namespace App\Models;

use App\Enums\AppointmentType;
use App\Enums\StopType;
use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * Tiene tenant_id: toda consulta pasa por TenantScope. Para saltárselo hace
 * falta pedirlo a la cara con withoutTenantScope().
 */
final class LoadStop extends BaseModel
{
    use BelongsToTenant, SoftDeletes;

    protected $table = 'load_stops';

    /** @var list<string> */
    protected $fillable = [
        'tenant_id',
        'load_id',
        'stop_type',
        'sequence',
        'facility_name',
        'customer_location_id',
        'line1',
        'line2',
        'city',
        'state',
        'postal_code',
        'country',
        'latitude',
        'longitude',
        'place_id',
        'timezone',
        'contact_name',
        'contact_phone',
        'contact_email',
        'confirmation_number',
        'instructions',
        'appointment_type',
        'window_start',
        'window_end',
        'planned_arrival_at',
        'actual_arrival_at',
        'actual_departure_at',
        'detention_minutes',
        'detention_notes',
        'deleted_by',
        'deletion_reason',
    ];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'stop_type' => StopType::class,
            'sequence' => 'integer',
            'appointment_type' => AppointmentType::class,
            'window_start' => 'immutable_datetime',
            'window_end' => 'immutable_datetime',
            'planned_arrival_at' => 'immutable_datetime',
            'actual_arrival_at' => 'immutable_datetime',
            'actual_departure_at' => 'immutable_datetime',
            'detention_minutes' => 'integer',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
            'deleted_at' => 'immutable_datetime',
        ];
    }

    /** @return BelongsTo<CustomerLocation, $this> */
    public function customerLocation(): BelongsTo
    {
        return $this->belongsTo(CustomerLocation::class, 'customer_location_id');
    }

    /** @return BelongsTo<Load, $this> */
    public function freightLoad(): BelongsTo
    {
        return $this->belongsTo(Load::class, 'load_id');
    }

    /** @return HasMany<LoadDocument, $this> */
    public function loadDocuments(): HasMany
    {
        return $this->hasMany(LoadDocument::class, 'stop_id');
    }
}
