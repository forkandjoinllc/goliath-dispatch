<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * A qué transportista le da servicio este proveedor.
 *
 * Una fila por par. La misma arrendadora con tres transportistas tiene tres
 * filas aquí y UNA ficha de proveedor, que es justo lo que evita duplicar sus
 * contactos y sus datos fiscales tres veces.
 */
final class VendorCarrier extends BaseModel
{
    use BelongsToTenant, SoftDeletes;

    protected $table = 'vendor_carriers';

    /** @var list<string> */
    protected $fillable = [
        'tenant_id',
        'vendor_id',
        'carrier_id',
        'account_reference',
        'notes',
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

    /** @return BelongsTo<Vendor, $this> */
    public function vendor(): BelongsTo
    {
        return $this->belongsTo(Vendor::class, 'vendor_id');
    }

    /** @return BelongsTo<Carrier, $this> */
    public function carrier(): BelongsTo
    {
        return $this->belongsTo(Carrier::class, 'carrier_id');
    }
}
