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
final class Customer extends BaseModel
{
    use BelongsToTenant, SoftDeletes;

    protected $table = 'customers';

    /** @var list<string> */
    protected $fillable = [
        'tenant_id',
        'company_name',
        'company_name_normalized',
        'dot_number',
        'mc_number',
        'website',
        'phone',
        'phone_normalized',
        'email',
        'email_normalized',
        'physical_line1',
        'physical_line2',
        'physical_city',
        'physical_state',
        'physical_country',
        'physical_postal_code',
        'physical_place_id',
        'billing_same_as_physical',
        'billing_line1',
        'billing_line2',
        'billing_city',
        'billing_state',
        'billing_country',
        'billing_postal_code',
        'tax_id_encrypted',
        'tax_id_last4',
        'credit_limit_cents',
        'credit_approved',
        'credit_notes',
        'payment_terms_days',
        'uses_factoring',
        'factoring_company_name',
        'status',
        'notes',
        'duplicate_override_by_user_id',
        'duplicate_override_reason',
        'deleted_by',
        'deletion_reason',
        'archived_at',
        'purge_eligible_at',
        'legal_hold',
    ];

    /**
     * Nunca se serializan hacia el cliente. Son hashes, tokens y secretos:
     * el valor en claro no existe en la base de datos, y el hash tampoco tiene
     * por qué salir de ella.
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
            'billing_same_as_physical' => 'boolean',
            'tax_id_encrypted' => 'encrypted',
            'credit_limit_cents' => 'integer',
            'credit_approved' => 'boolean',
            'payment_terms_days' => 'integer',
            'uses_factoring' => 'boolean',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
            'deleted_at' => 'immutable_datetime',
            'archived_at' => 'immutable_datetime',
            'purge_eligible_at' => 'immutable_datetime',
            'legal_hold' => 'boolean',
        ];
    }

    /** @return BelongsTo<User, $this> */
    public function duplicateOverrideByUser(): BelongsTo
    {
        return $this->belongsTo(User::class, 'duplicate_override_by_user_id');
    }

    /** @return HasMany<CustomerContact, $this> */
    public function customerContacts(): HasMany
    {
        return $this->hasMany(CustomerContact::class, 'customer_id');
    }

    /** @return HasMany<CustomerLocation, $this> */
    public function customerLocations(): HasMany
    {
        return $this->hasMany(CustomerLocation::class, 'customer_id');
    }

    /** @return HasMany<Invoice, $this> */
    public function invoices(): HasMany
    {
        return $this->hasMany(Invoice::class, 'customer_id');
    }

    /** @return HasMany<Load, $this> */
    public function loads(): HasMany
    {
        return $this->hasMany(Load::class, 'customer_id');
    }
}
