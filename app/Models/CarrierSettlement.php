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
final class CarrierSettlement extends BaseModel
{
    use BelongsToTenant, SoftDeletes;

    protected $table = 'carrier_settlements';

    /** @var list<string> */
    protected $fillable = [
        'tenant_id',
        'carrier_id',
        'settlement_number',
        'period_start',
        'period_end',
        'gross_rate_cents',
        'reimbursements_cents',
        'dispatch_fees_cents',
        'deductions_cents',
        'net_amount_cents',
        'status',
        'factoring_company_id',
        'factoring_submitted_at',
        'pdf_document_id',
        'issued_at',
        'paid_at',
        'notes',
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
            'period_start' => 'immutable_datetime',
            'period_end' => 'immutable_datetime',
            'gross_rate_cents' => 'integer',
            'reimbursements_cents' => 'integer',
            'dispatch_fees_cents' => 'integer',
            'deductions_cents' => 'integer',
            'net_amount_cents' => 'integer',
            'factoring_submitted_at' => 'immutable_datetime',
            'issued_at' => 'immutable_datetime',
            'paid_at' => 'immutable_datetime',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
            'deleted_at' => 'immutable_datetime',
            'archived_at' => 'immutable_datetime',
            'purge_eligible_at' => 'immutable_datetime',
            'legal_hold' => 'boolean',
        ];
    }

    /** @return BelongsTo<Carrier, $this> */
    public function carrier(): BelongsTo
    {
        return $this->belongsTo(Carrier::class, 'carrier_id');
    }

    /** @return BelongsTo<FactoringCompany, $this> */
    public function factoringCompany(): BelongsTo
    {
        return $this->belongsTo(FactoringCompany::class, 'factoring_company_id');
    }

    /** @return BelongsTo<Document, $this> */
    public function pdfDocument(): BelongsTo
    {
        return $this->belongsTo(Document::class, 'pdf_document_id');
    }

    /** @return HasMany<CarrierSettlementLine, $this> */
    public function carrierSettlementLines(): HasMany
    {
        return $this->hasMany(CarrierSettlementLine::class, 'settlement_id');
    }
}
