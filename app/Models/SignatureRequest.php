<?php

declare(strict_types=1);

namespace App\Models;

use App\Enums\Locale;
use App\Enums\SignatureStatus;
use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * Tiene tenant_id: toda consulta pasa por TenantScope. Para saltárselo hace
 * falta pedirlo a la cara con withoutTenantScope().
 */
final class SignatureRequest extends BaseModel
{
    use BelongsToTenant, SoftDeletes;

    protected $table = 'signature_requests';

    /** @var list<string> */
    protected $fillable = [
        'tenant_id',
        'template_id',
        'template_version',
        'template_content_hash',
        'subject_type',
        'subject_id',
        'carrier_id',
        'signer_user_id',
        'signer_email',
        'signer_legal_name',
        'locale',
        'status',
        'token_values',
        'access_token_hash',
        'requested_by_user_id',
        'requested_at',
        'first_viewed_at',
        'completed_at',
        'declined_at',
        'decline_reason',
        'expires_at',
        'voided_at',
        'void_reason',
        'superseded_by_request_id',
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
        'template_content_hash',
        'access_token_hash',
    ];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'template_version' => 'integer',
            'locale' => Locale::class,
            'status' => SignatureStatus::class,
            'token_values' => 'array',
            'requested_at' => 'immutable_datetime',
            'first_viewed_at' => 'immutable_datetime',
            'completed_at' => 'immutable_datetime',
            'declined_at' => 'immutable_datetime',
            'expires_at' => 'immutable_datetime',
            'voided_at' => 'immutable_datetime',
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

    /** @return BelongsTo<User, $this> */
    public function requestedByUser(): BelongsTo
    {
        return $this->belongsTo(User::class, 'requested_by_user_id');
    }

    /** @return BelongsTo<User, $this> */
    public function signerUser(): BelongsTo
    {
        return $this->belongsTo(User::class, 'signer_user_id');
    }

    /** @return BelongsTo<SignatureTemplate, $this> */
    public function template(): BelongsTo
    {
        return $this->belongsTo(SignatureTemplate::class, 'template_id');
    }

    /** @return HasMany<SignatureAuditEvent, $this> */
    public function signatureAuditEvents(): HasMany
    {
        return $this->hasMany(SignatureAuditEvent::class, 'request_id');
    }

    /** @return HasOne<SignatureRecord, $this> */
    public function signatureRecord(): HasOne
    {
        // hasOne y no hasMany: SignatureRecord.request_id tiene índice único.
        return $this->hasOne(SignatureRecord::class, 'request_id');
    }
}
