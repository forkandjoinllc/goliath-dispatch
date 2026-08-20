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
final class DocumentVersion extends BaseModel
{
    use BelongsToTenant, SoftDeletes;

    protected $table = 'document_versions';

    /** @var list<string> */
    protected $fillable = [
        'tenant_id',
        'document_id',
        'version_number',
        'storage_key',
        'original_filename',
        'content_type',
        'byte_size',
        'sha256',
        'page_count',
        'malware_scan_status',
        'malware_scan_at',
        'extraction',
        'extraction_status',
        'uploaded_by_user_id',
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
            'version_number' => 'integer',
            'byte_size' => 'integer',
            'page_count' => 'integer',
            'malware_scan_at' => 'immutable_datetime',
            'extraction' => 'array',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
            'deleted_at' => 'immutable_datetime',
            'archived_at' => 'immutable_datetime',
            'purge_eligible_at' => 'immutable_datetime',
            'legal_hold' => 'boolean',
        ];
    }

    /** @return BelongsTo<Document, $this> */
    public function document(): BelongsTo
    {
        return $this->belongsTo(Document::class, 'document_id');
    }

    /** @return BelongsTo<User, $this> */
    public function uploadedByUser(): BelongsTo
    {
        return $this->belongsTo(User::class, 'uploaded_by_user_id');
    }

    /** @return HasMany<DocumentAccessLog, $this> */
    public function documentAccessLogs(): HasMany
    {
        return $this->hasMany(DocumentAccessLog::class, 'document_version_id');
    }

    /** @return HasMany<DocumentReview, $this> */
    public function documentReviews(): HasMany
    {
        return $this->hasMany(DocumentReview::class, 'document_version_id');
    }

    /** @return HasMany<RateConfirmationAcceptance, $this> */
    public function rateConfirmationAcceptances(): HasMany
    {
        return $this->hasMany(RateConfirmationAcceptance::class, 'document_version_id');
    }
}
