<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Tiene tenant_id: toda consulta pasa por TenantScope. Para saltárselo hace
 * falta pedirlo a la cara con withoutTenantScope().
 */
final class DocumentExpiration extends BaseModel
{
    use BelongsToTenant;

    protected $table = 'document_expirations';

    /** @var list<string> */
    protected $fillable = [
        'tenant_id',
        'document_id',
        'expiration_date',
        'warning_days',
        'kind',
        'first_detected_at',
        'notified_at',
        'resolved_at',
    ];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'expiration_date' => 'immutable_datetime',
            'warning_days' => 'integer',
            'first_detected_at' => 'immutable_datetime',
            'notified_at' => 'immutable_datetime',
            'resolved_at' => 'immutable_datetime',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
        ];
    }

    /** @return BelongsTo<Document, $this> */
    public function document(): BelongsTo
    {
        return $this->belongsTo(Document::class, 'document_id');
    }
}
