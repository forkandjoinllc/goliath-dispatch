<?php

declare(strict_types=1);

namespace App\Models;

use App\Enums\VerificationStatus;
use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * Tiene tenant_id: toda consulta pasa por TenantScope. Para saltárselo hace
 * falta pedirlo a la cara con withoutTenantScope().
 */
final class FactoringAssignment extends BaseModel
{
    use BelongsToTenant, SoftDeletes;

    protected $table = 'factoring_assignments';

    /** @var list<string> */
    protected $fillable = [
        'tenant_id',
        'carrier_id',
        'factoring_company_id',
        'verification_status',
        'notice_of_assignment_document_id',
        'change_of_payee_document_id',
        'effective_from',
        'effective_to',
        'verified_by_user_id',
        'verified_at',
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
            'verification_status' => VerificationStatus::class,
            'effective_from' => 'immutable_datetime',
            'effective_to' => 'immutable_datetime',
            'verified_at' => 'immutable_datetime',
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

    /** @return BelongsTo<User, $this> */
    public function verifiedByUser(): BelongsTo
    {
        return $this->belongsTo(User::class, 'verified_by_user_id');
    }
}
