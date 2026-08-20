<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * Tiene tenant_id: toda consulta pasa por TenantScope. Para saltárselo hace
 * falta pedirlo a la cara con withoutTenantScope().
 */
final class CustomerContactLocation extends BaseModel
{
    use BelongsToTenant, SoftDeletes;

    protected $table = 'customer_contact_locations';

    /** @var list<string> */
    protected $fillable = [
        'tenant_id',
        'contact_id',
        'location_id',
        'deleted_by',
        'deletion_reason',
    ];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
            'deleted_at' => 'immutable_datetime',
        ];
    }

    /** @return BelongsTo<CustomerContact, $this> */
    public function contact(): BelongsTo
    {
        return $this->belongsTo(CustomerContact::class, 'contact_id');
    }

    /** @return BelongsTo<CustomerLocation, $this> */
    public function location(): BelongsTo
    {
        return $this->belongsTo(CustomerLocation::class, 'location_id');
    }
}
