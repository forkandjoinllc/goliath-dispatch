<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * Un proveedor: quien le da servicio a un transportista.
 *
 * La arrendadora del camión, el taller, la aseguradora. Vive a nivel de
 * empresa y a quién sirve se anota en `vendor_carriers`: la misma arrendadora
 * que trabaja con tres transportistas es UNA ficha. Ver la migración
 * `2026_09_26_100000_create_vendors`.
 *
 * Tiene tenant_id: toda consulta pasa por TenantScope.
 */
final class Vendor extends BaseModel
{
    use BelongsToTenant, SoftDeletes;

    protected $table = 'vendors';

    /** @var list<string> */
    protected $fillable = [
        'tenant_id',
        'company_name',
        'company_name_normalized',
        'vendor_type',
        'website',
        'phone',
        'phone_normalized',
        'email',
        'email_normalized',
        'preferred_locale',
        'line1',
        'line2',
        'city',
        'state',
        'country',
        'postal_code',
        'tax_id_encrypted',
        'tax_id_last4',
        'w9_on_file',
        'w9_received_on',
        'payment_terms_days',
        'payment_method',
        'account_last4',
        'status',
        'notes',
        'deleted_by',
        'deletion_reason',
    ];

    /**
     * El identificador fiscal no sale de la base. Solo viajan los cuatro
     * últimos, que es lo que hace falta para reconocerlo.
     *
     * @var list<string>
     */
    protected $hidden = [
        'tax_id_encrypted',
    ];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'tax_id_encrypted' => 'encrypted',
            'w9_on_file' => 'boolean',
            'w9_received_on' => 'immutable_date',
            'payment_terms_days' => 'integer',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
            'deleted_at' => 'immutable_datetime',
        ];
    }

    /** @return HasMany<VendorContact, $this> */
    public function vendorContacts(): HasMany
    {
        return $this->hasMany(VendorContact::class, 'vendor_id');
    }

    /** @return HasMany<VendorCarrier, $this> */
    public function vendorCarriers(): HasMany
    {
        return $this->hasMany(VendorCarrier::class, 'vendor_id');
    }
}
