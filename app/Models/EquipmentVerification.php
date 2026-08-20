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
final class EquipmentVerification extends BaseModel
{
    use BelongsToTenant;

    protected $table = 'equipment_verifications';

    /** @var list<string> */
    protected $fillable = [
        'tenant_id',
        'equipment_type',
        'equipment_id',
        'carrier_id',
        'coi_document_id',
        'coi_document_version_id',
        'status',
        'extracted_vins',
        'matched_vin',
        'ocr_provider',
        'ocr_confidence',
        'media_count',
        'blocking_reasons',
        'overridden_by_user_id',
        'override_reason',
        'overridden_at',
        'verified_at',
    ];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'status' => VerificationStatus::class,
            'extracted_vins' => 'array',
            'ocr_confidence' => 'integer',
            'media_count' => 'integer',
            'blocking_reasons' => 'array',
            'overridden_at' => 'immutable_datetime',
            'verified_at' => 'immutable_datetime',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
        ];
    }

    /** @return BelongsTo<Carrier, $this> */
    public function carrier(): BelongsTo
    {
        return $this->belongsTo(Carrier::class, 'carrier_id');
    }

    /** @return BelongsTo<Document, $this> */
    public function coiDocument(): BelongsTo
    {
        return $this->belongsTo(Document::class, 'coi_document_id');
    }

    /** @return BelongsTo<User, $this> */
    public function overriddenByUser(): BelongsTo
    {
        return $this->belongsTo(User::class, 'overridden_by_user_id');
    }
}
