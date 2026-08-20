<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * Tiene tenant_id: toda consulta pasa por TenantScope. Para saltárselo hace
 * falta pedirlo a la cara con withoutTenantScope().
 */
final class SignatureTemplate extends BaseModel
{
    use BelongsToTenant, SoftDeletes;

    protected $table = 'signature_templates';

    /** @var list<string> */
    protected $fillable = [
        'tenant_id',
        'template_key',
        'version',
        'title_en',
        'title_es',
        'body_en',
        'body_es',
        'consent_copy_en',
        'consent_copy_es',
        'content_hash',
        'required_tokens',
        'active',
        'effective_from',
        'retired_at',
        'deleted_by',
        'deletion_reason',
        'archived_at',
        'purge_eligible_at',
        'legal_hold',
    ];

    /**
     * Nunca se serializan hacia el cliente. Son hashes, tokens y secretos:
     * el valor en claro no existe en la base de datos, y el hash tampoco tiene
     * por qué salir de ella.
     *
     * @var list<string>
     */
    protected $hidden = [
        'content_hash',
    ];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'version' => 'integer',
            'required_tokens' => 'array',
            'active' => 'boolean',
            'effective_from' => 'immutable_datetime',
            'retired_at' => 'immutable_datetime',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
            'deleted_at' => 'immutable_datetime',
            'archived_at' => 'immutable_datetime',
            'purge_eligible_at' => 'immutable_datetime',
            'legal_hold' => 'boolean',
        ];
    }

    /** @return HasMany<SignatureRequest, $this> */
    public function signatureRequests(): HasMany
    {
        return $this->hasMany(SignatureRequest::class, 'template_id');
    }
}
