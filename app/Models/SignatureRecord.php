<?php

declare(strict_types=1);

namespace App\Models;

use App\Enums\Locale;
use App\Enums\SignatureMethod;
use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * El esquema impide borrar filas de esta tabla y restringe qué columnas
 * pueden actualizarse (trigger de guarda). Ver database/schema/9*.sql.
 *
 * Tiene tenant_id: toda consulta pasa por TenantScope. Para saltárselo hace
 * falta pedirlo a la cara con withoutTenantScope().
 */
final class SignatureRecord extends BaseModel
{
    use BelongsToTenant;

    protected $table = 'signature_records';

    /** @var list<string> */
    protected $fillable = [
        'tenant_id',
        'request_id',
        'signer_user_id',
        'signer_legal_name',
        'signer_email',
        'signer_title',
        'method',
        'signature_storage_key',
        'signature_sha256',
        'typed_name_value',
        'consent_accepted',
        'consent_copy_hash',
        'document_sha256',
        'signed_document_id',
        'audit_certificate_document_id',
        'integrity_seal',
        'seal_algorithm',
        'ip_address',
        'user_agent',
        'locale',
        'signed_at',
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
        'consent_copy_hash',
    ];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'method' => SignatureMethod::class,
            'consent_accepted' => 'boolean',
            'locale' => Locale::class,
            'signed_at' => 'immutable_datetime',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
            'archived_at' => 'immutable_datetime',
            'purge_eligible_at' => 'immutable_datetime',
            'legal_hold' => 'boolean',
        ];
    }

    /** @return BelongsTo<Document, $this> */
    public function auditCertificateDocument(): BelongsTo
    {
        return $this->belongsTo(Document::class, 'audit_certificate_document_id');
    }

    /** @return BelongsTo<SignatureRequest, $this> */
    public function request(): BelongsTo
    {
        return $this->belongsTo(SignatureRequest::class, 'request_id');
    }

    /** @return BelongsTo<Document, $this> */
    public function signedDocument(): BelongsTo
    {
        return $this->belongsTo(Document::class, 'signed_document_id');
    }

    /** @return BelongsTo<User, $this> */
    public function signerUser(): BelongsTo
    {
        return $this->belongsTo(User::class, 'signer_user_id');
    }

    /** @return HasMany<SignatureAuditEvent, $this> */
    public function signatureAuditEvents(): HasMany
    {
        return $this->hasMany(SignatureAuditEvent::class, 'record_id');
    }
}
