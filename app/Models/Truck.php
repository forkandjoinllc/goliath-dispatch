<?php

declare(strict_types=1);

namespace App\Models;

use App\Enums\EquipmentStatus;
use App\Enums\VerificationStatus;
use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * Tiene tenant_id: toda consulta pasa por TenantScope. Para saltárselo hace
 * falta pedirlo a la cara con withoutTenantScope().
 */
final class Truck extends BaseModel
{
    use BelongsToTenant, SoftDeletes;

    protected $table = 'trucks';

    /** @var list<string> */
    protected $fillable = [
        'tenant_id',
        'carrier_id',
        'unit_number',
        'vin',
        'vin_normalized',
        'year',
        'make',
        'model',
        'equipment_type_id',
        'plate_number',
        'plate_state',
        'plate_country',
        'status',
        'vin_decode_source',
        'vin_decoded_at',
        'registration_number',
        'registration_expires_at',
        'last_inspection_at',
        'next_inspection_due_at',
        'last_maintenance_at',
        'next_maintenance_due_at',
        'coi_verification_status',
        'out_of_service_reason',
        'notes',
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
            'year' => 'integer',
            'status' => EquipmentStatus::class,
            'vin_decoded_at' => 'immutable_datetime',
            'registration_expires_at' => 'immutable_datetime',
            'last_inspection_at' => 'immutable_datetime',
            'next_inspection_due_at' => 'immutable_datetime',
            'last_maintenance_at' => 'immutable_datetime',
            'next_maintenance_due_at' => 'immutable_datetime',
            'coi_verification_status' => VerificationStatus::class,
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
            'deleted_at' => 'immutable_datetime',
            'archived_at' => 'immutable_datetime',
            'purge_eligible_at' => 'immutable_datetime',
            'legal_hold' => 'boolean',
        ];
    }

    /** @return BelongsTo<Carrier, $this> */
    public function carrier(): BelongsTo
    {
        return $this->belongsTo(Carrier::class, 'carrier_id');
    }

    /** @return BelongsTo<EquipmentType, $this> */
    public function equipmentType(): BelongsTo
    {
        return $this->belongsTo(EquipmentType::class, 'equipment_type_id');
    }

    /** @return HasMany<LoadAssignment, $this> */
    public function loadAssignments(): HasMany
    {
        return $this->hasMany(LoadAssignment::class, 'truck_id');
    }

    /** @return HasMany<TrackingSession, $this> */
    public function trackingSessions(): HasMany
    {
        return $this->hasMany(TrackingSession::class, 'truck_id');
    }
}
