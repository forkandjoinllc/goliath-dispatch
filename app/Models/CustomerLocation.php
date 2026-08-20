<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * Tiene tenant_id: toda consulta pasa por TenantScope. Para saltárselo hace
 * falta pedirlo a la cara con withoutTenantScope().
 */
final class CustomerLocation extends BaseModel
{
    use BelongsToTenant, SoftDeletes;

    protected $table = 'customer_locations';

    /** @var list<string> */
    protected $fillable = [
        'tenant_id',
        'customer_id',
        'name',
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
        'phone',
        'hours',
        'instructions',
        'is_primary',
        'deleted_by',
        'deletion_reason',
    ];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'is_primary' => 'boolean',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
            'deleted_at' => 'immutable_datetime',
        ];
    }

    /** @return BelongsTo<Customer, $this> */
    public function customer(): BelongsTo
    {
        return $this->belongsTo(Customer::class, 'customer_id');
    }

    /** @return HasMany<CustomerContactLocation, $this> */
    public function customerContactLocations(): HasMany
    {
        return $this->hasMany(CustomerContactLocation::class, 'location_id');
    }

    /** @return HasMany<LoadStop, $this> */
    public function loadStops(): HasMany
    {
        return $this->hasMany(LoadStop::class, 'customer_location_id');
    }
}
