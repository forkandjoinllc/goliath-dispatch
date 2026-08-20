<?php

declare(strict_types=1);

namespace App\Models;

use App\Enums\VerificationStatus;
use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Tiene tenant_id: toda consulta pasa por TenantScope. Para saltárselo hace
 * falta pedirlo a la cara con withoutTenantScope().
 */
final class FmcsaVerification extends BaseModel
{
    use BelongsToTenant;

    protected $table = 'fmcsa_verifications';

    /** @var list<string> */
    protected $fillable = [
        'tenant_id',
        'carrier_id',
        'provider',
        'dot_number',
        'mc_number',
        'status',
        'normalized',
        'mismatches',
        'raw_reference',
        'raw_payload_digest',
        'attempt',
        'error_message',
        'checked_at',
        'overridden_by_user_id',
        'override_reason',
        'overridden_at',
    ];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'status' => VerificationStatus::class,
            'normalized' => 'array',
            'mismatches' => 'array',
            'attempt' => 'integer',
            'checked_at' => 'immutable_datetime',
            'overridden_at' => 'immutable_datetime',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
        ];
    }

    /** @return BelongsTo<Carrier, $this> */
    public function carrier(): BelongsTo
    {
        return $this->belongsTo(Carrier::class, 'carrier_id');
    }

    /** @return BelongsTo<User, $this> */
    public function overriddenByUser(): BelongsTo
    {
        return $this->belongsTo(User::class, 'overridden_by_user_id');
    }
}
