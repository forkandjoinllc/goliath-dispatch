<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * Tiene tenant_id: toda consulta pasa por TenantScope. Para saltárselo hace
 * falta pedirlo a la cara con withoutTenantScope().
 */
final class FactoringCompany extends BaseModel
{
    use BelongsToTenant, SoftDeletes;

    protected $table = 'factoring_companies';

    /** @var list<string> */
    protected $fillable = [
        'tenant_id',
        'name',
        'contact_name',
        'email',
        'phone',
        'address_line1',
        'address_city',
        'address_state',
        'address_postal_code',
        'funding_instructions',
        'active',
        'deleted_by',
        'deletion_reason',
    ];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'active' => 'boolean',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
            'deleted_at' => 'immutable_datetime',
        ];
    }

    /** @return HasMany<CarrierSettlement, $this> */
    public function carrierSettlements(): HasMany
    {
        return $this->hasMany(CarrierSettlement::class, 'factoring_company_id');
    }

    /** @return HasMany<FactoringAssignment, $this> */
    public function factoringAssignments(): HasMany
    {
        return $this->hasMany(FactoringAssignment::class, 'factoring_company_id');
    }
}
