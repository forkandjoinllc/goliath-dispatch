<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Tiene tenant_id: toda consulta pasa por TenantScope. Para saltárselo hace
 * falta pedirlo a la cara con withoutTenantScope().
 */
final class VerificationToken extends BaseModel
{
    use BelongsToTenant;

    protected $table = 'verification_tokens';

    /** @var list<string> */
    protected $fillable = [
        'user_id',
        'tenant_id',
        'purpose',
        'token_hash',
        'email',
        'payload',
        'expires_at',
        'consumed_at',
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
            'payload' => 'array',
            'expires_at' => 'immutable_datetime',
            'consumed_at' => 'immutable_datetime',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
        ];
    }

    /** @return BelongsTo<User, $this> */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class, 'user_id');
    }
}
