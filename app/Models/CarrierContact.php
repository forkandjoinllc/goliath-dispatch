<?php

declare(strict_types=1);

namespace App\Models;

use App\Enums\CarrierContactPosition;
use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * Una persona concreta dentro de un transportista.
 *
 * El principal (`is_primary`) es el que se copia a las columnas
 * `contact_first_name` / `contact_last_name` / `email` / `phone` de `carriers`.
 * Esas columnas siguen siendo las que lee medio sistema; esta tabla es la que
 * manda. Ver la migración 2026_08_28_100000.
 *
 * `live_primary_key` NO está en `$fillable` a propósito: la calcula MySQL. Un
 * create() con ese atributo moriría con ERROR 3105.
 */
final class CarrierContact extends BaseModel
{
    use BelongsToTenant, SoftDeletes;

    protected $table = 'carrier_contacts';

    /** @var list<string> */
    protected $fillable = [
        'tenant_id',
        'carrier_id',
        'first_name',
        'last_name',
        'email',
        'phone',
        'position',
        'preferred_locale',
        'is_primary',
        'notes',
        'deleted_by',
        'deletion_reason',
    ];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'position' => CarrierContactPosition::class,
            'is_primary' => 'boolean',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
            'deleted_at' => 'immutable_datetime',
        ];
    }

    /** @return BelongsTo<Carrier, $this> */
    public function carrier(): BelongsTo
    {
        return $this->belongsTo(Carrier::class, 'carrier_id');
    }

    public function fullName(): string
    {
        return trim("{$this->first_name} {$this->last_name}");
    }
}
