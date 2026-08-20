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
final class PublicTrackingLink extends BaseModel
{
    use BelongsToTenant, SoftDeletes;

    protected $table = 'public_tracking_links';

    /** @var list<string> */
    protected $fillable = [
        'tenant_id',
        'load_id',
        'token_hash',
        'label',
        'recipient_email',
        'expires_at',
        'revoked_at',
        'view_count',
        'last_viewed_at',
        'created_by_user_id',
        'deleted_by',
        'deletion_reason',
    ];

    /**
     * Nunca se serializan hacia el cliente. Son hashes, tokens y secretos:
     * el valor en claro no existe en la base de datos, y el hash tampoco tiene
     * por qué salir de ella.
     *
     * @var list<string>
     */
    protected $hidden = [
        'token_hash',
    ];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'expires_at' => 'immutable_datetime',
            'revoked_at' => 'immutable_datetime',
            'view_count' => 'integer',
            'last_viewed_at' => 'immutable_datetime',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
            'deleted_at' => 'immutable_datetime',
        ];
    }

    /** @return BelongsTo<User, $this> */
    public function createdByUser(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by_user_id');
    }

    /** @return BelongsTo<Load, $this> */
    public function freightLoad(): BelongsTo
    {
        return $this->belongsTo(Load::class, 'load_id');
    }
}
