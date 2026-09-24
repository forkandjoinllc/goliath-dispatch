<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

/** Una persona del proveedor. A quién se llama cuando vence el contrato. */
final class VendorContact extends BaseModel
{
    use BelongsToTenant, SoftDeletes;

    protected $table = 'vendor_contacts';

    /** @var list<string> */
    protected $fillable = [
        'tenant_id',
        'vendor_id',
        'first_name',
        'last_name',
        'email',
        'phone',
        'phone_extension',
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
            'is_primary' => 'boolean',
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
}
