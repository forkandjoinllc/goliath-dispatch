<?php

declare(strict_types=1);

namespace App\Models;

use App\Enums\Locale;
use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * Tiene tenant_id: toda consulta pasa por TenantScope. Para saltárselo hace
 * falta pedirlo a la cara con withoutTenantScope().
 */
final class QuoteRequest extends BaseModel
{
    use BelongsToTenant, SoftDeletes;

    protected $table = 'quote_requests';

    /** @var list<string> */
    protected $fillable = [
        'tenant_id',
        'lead_id',
        'contact_name',
        'email',
        'phone',
        'company_name',
        'commodity',
        'weight_pounds',
        'length_inches',
        'width_inches',
        'height_inches',
        'origin_city',
        'origin_state',
        'destination_city',
        'destination_state',
        'ready_date',
        'equipment_preference',
        'is_oversize_suspected',
        'notes',
        'locale',
        'status',
        'ip_address',
        'user_agent',
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
            'weight_pounds' => 'integer',
            'length_inches' => 'integer',
            'width_inches' => 'integer',
            'height_inches' => 'integer',
            'ready_date' => 'immutable_datetime',
            'is_oversize_suspected' => 'boolean',
            'locale' => Locale::class,
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
            'deleted_at' => 'immutable_datetime',
            'archived_at' => 'immutable_datetime',
            'purge_eligible_at' => 'immutable_datetime',
            'legal_hold' => 'boolean',
        ];
    }

    /** @return BelongsTo<Lead, $this> */
    public function lead(): BelongsTo
    {
        return $this->belongsTo(Lead::class, 'lead_id');
    }
}
