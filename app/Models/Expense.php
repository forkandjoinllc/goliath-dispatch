<?php

declare(strict_types=1);

namespace App\Models;

use App\Enums\ExpenseStatus;
use App\Enums\ExpenseTreatment;
use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * Tiene tenant_id: toda consulta pasa por TenantScope. Para saltárselo hace
 * falta pedirlo a la cara con withoutTenantScope().
 */
final class Expense extends BaseModel
{
    use BelongsToTenant, SoftDeletes;

    protected $table = 'expenses';

    /** @var list<string> */
    protected $fillable = [
        'tenant_id',
        'load_id',
        'carrier_id',
        'category_id',
        'treatment_snapshot',
        // Si la categoría exigía recibo el día que se presentó. Copia
        // congelada, igual que el tratamiento y por la misma razón.
        'requires_receipt_snapshot',
        'amount_cents',
        'description',
        'incurred_on',
        'receipt_document_id',
        'status',
        'submitted_by_user_id',
        'reviewed_by_user_id',
        'reviewed_at',
        'rejection_reason',
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
            'treatment_snapshot' => ExpenseTreatment::class,
            'requires_receipt_snapshot' => 'boolean',
            'amount_cents' => 'integer',
            'incurred_on' => 'immutable_datetime',
            'status' => ExpenseStatus::class,
            'reviewed_at' => 'immutable_datetime',
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

    /** @return BelongsTo<ExpenseCategory, $this> */
    public function category(): BelongsTo
    {
        return $this->belongsTo(ExpenseCategory::class, 'category_id');
    }

    /** @return BelongsTo<Load, $this> */
    public function freightLoad(): BelongsTo
    {
        return $this->belongsTo(Load::class, 'load_id');
    }

    /** @return BelongsTo<Document, $this> */
    public function receiptDocument(): BelongsTo
    {
        return $this->belongsTo(Document::class, 'receipt_document_id');
    }

    /** @return BelongsTo<User, $this> */
    public function reviewedByUser(): BelongsTo
    {
        return $this->belongsTo(User::class, 'reviewed_by_user_id');
    }

    /** @return BelongsTo<User, $this> */
    public function submittedByUser(): BelongsTo
    {
        return $this->belongsTo(User::class, 'submitted_by_user_id');
    }
}
