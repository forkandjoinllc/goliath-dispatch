<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * Tiene tenant_id: toda consulta pasa por TenantScope. Para saltárselo hace
 * falta pedirlo a la cara con withoutTenantScope().
 */
final class Permit extends BaseModel
{
    use BelongsToTenant, SoftDeletes;

    protected $table = 'permits';

    /** @var list<string> */
    protected $fillable = [
        'tenant_id',
        'load_id',
        'state_code',
        'permit_number',
        'permit_type',
        'issued_at',
        'expires_at',
        'cost_cents',
        'document_id',
        'route_survey_document_id',
        'status',
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
            'issued_at' => 'immutable_datetime',
            'expires_at' => 'immutable_datetime',
            'cost_cents' => 'integer',
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

    /** @return BelongsTo<Load, $this> */
    public function freightLoad(): BelongsTo
    {
        return $this->belongsTo(Load::class, 'load_id');
    }

    /** @return BelongsTo<Document, $this> */
    public function routeSurveyDocument(): BelongsTo
    {
        return $this->belongsTo(Document::class, 'route_survey_document_id');
    }
}
