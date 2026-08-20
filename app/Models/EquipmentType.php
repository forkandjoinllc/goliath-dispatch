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
final class EquipmentType extends BaseModel
{
    use BelongsToTenant, SoftDeletes;

    protected $table = 'equipment_types';

    /** @var list<string> */
    protected $fillable = [
        'tenant_id',
        'code',
        'label_en',
        'label_es',
        'category',
        'is_system',
        'supports_rgn',
        'sort_order',
        'active',
        'deleted_by',
        'deletion_reason',
    ];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'is_system' => 'boolean',
            'supports_rgn' => 'boolean',
            'sort_order' => 'integer',
            'active' => 'boolean',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
            'deleted_at' => 'immutable_datetime',
        ];
    }

    /** @return HasMany<Load, $this> */
    public function loads(): HasMany
    {
        return $this->hasMany(Load::class, 'required_equipment_type_id');
    }

    /** @return HasMany<Trailer, $this> */
    public function trailers(): HasMany
    {
        return $this->hasMany(Trailer::class, 'equipment_type_id');
    }

    /** @return HasMany<Truck, $this> */
    public function trucks(): HasMany
    {
        return $this->hasMany(Truck::class, 'equipment_type_id');
    }
}
