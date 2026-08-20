<?php

declare(strict_types=1);

namespace App\Models;

use App\Enums\DocumentReviewStatus;
use App\Enums\DocumentType;
use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * Tiene tenant_id: toda consulta pasa por TenantScope. Para saltárselo hace
 * falta pedirlo a la cara con withoutTenantScope().
 */
final class Document extends BaseModel
{
    use BelongsToTenant, SoftDeletes;

    protected $table = 'documents';

    /** @var list<string> */
    protected $fillable = [
        'tenant_id',
        'document_type',
        'owner_type',
        'owner_id',
        'title',
        'description',
        'current_version_id',
        'review_status',
        'issue_date',
        'expiration_date',
        'is_required',
        'expires_soon_at',
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
            'document_type' => DocumentType::class,
            'review_status' => DocumentReviewStatus::class,
            'issue_date' => 'immutable_datetime',
            'expiration_date' => 'immutable_datetime',
            'is_required' => 'boolean',
            'expires_soon_at' => 'immutable_datetime',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
            'deleted_at' => 'immutable_datetime',
            'archived_at' => 'immutable_datetime',
            'purge_eligible_at' => 'immutable_datetime',
            'legal_hold' => 'boolean',
        ];
    }

    /** @return BelongsTo<User, $this> */
    public function uploadedByUser(): BelongsTo
    {
        return $this->belongsTo(User::class, 'uploaded_by_user_id');
    }

    /** @return HasMany<CarrierSettlement, $this> */
    public function carrierSettlements(): HasMany
    {
        return $this->hasMany(CarrierSettlement::class, 'pdf_document_id');
    }

    /** @return HasMany<DocumentAccessLog, $this> */
    public function documentAccessLogs(): HasMany
    {
        return $this->hasMany(DocumentAccessLog::class, 'document_id');
    }

    /** @return HasMany<DocumentExpiration, $this> */
    public function documentExpirations(): HasMany
    {
        return $this->hasMany(DocumentExpiration::class, 'document_id');
    }

    /** @return HasMany<DocumentReview, $this> */
    public function documentReviews(): HasMany
    {
        return $this->hasMany(DocumentReview::class, 'document_id');
    }

    /** @return HasMany<DocumentVersion, $this> */
    public function documentVersions(): HasMany
    {
        return $this->hasMany(DocumentVersion::class, 'document_id');
    }

    /** @return HasMany<EquipmentVerification, $this> */
    public function equipmentVerifications(): HasMany
    {
        return $this->hasMany(EquipmentVerification::class, 'coi_document_id');
    }

    /** @return HasMany<Escort, $this> */
    public function escorts(): HasMany
    {
        return $this->hasMany(Escort::class, 'document_id');
    }

    /** @return HasMany<Expense, $this> */
    public function expenses(): HasMany
    {
        return $this->hasMany(Expense::class, 'receipt_document_id');
    }

    /** @return HasMany<Invoice, $this> */
    public function invoices(): HasMany
    {
        return $this->hasMany(Invoice::class, 'pdf_document_id');
    }

    /** @return HasMany<LoadDocument, $this> */
    public function loadDocuments(): HasMany
    {
        return $this->hasMany(LoadDocument::class, 'document_id');
    }

    /** @return HasMany<Permit, $this> */
    public function documentPermits(): HasMany
    {
        return $this->hasMany(Permit::class, 'document_id');
    }

    /** @return HasMany<Permit, $this> */
    public function routeSurveyDocumentPermits(): HasMany
    {
        return $this->hasMany(Permit::class, 'route_survey_document_id');
    }

    /** @return HasMany<RateConfirmationAcceptance, $this> */
    public function rateConfirmationAcceptances(): HasMany
    {
        return $this->hasMany(RateConfirmationAcceptance::class, 'document_id');
    }

    /** @return HasMany<SignatureRecord, $this> */
    public function auditCertificateDocumentSignatureRecords(): HasMany
    {
        return $this->hasMany(SignatureRecord::class, 'audit_certificate_document_id');
    }

    /** @return HasMany<SignatureRecord, $this> */
    public function signedDocumentSignatureRecords(): HasMany
    {
        return $this->hasMany(SignatureRecord::class, 'signed_document_id');
    }
}
