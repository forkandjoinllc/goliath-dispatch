<?php

declare(strict_types=1);

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

final class MfaConfiguration extends BaseModel
{
    use SoftDeletes;

    protected $table = 'mfa_configurations';

    /** @var list<string> */
    protected $fillable = [
        'user_id',
        'method',
        'secret_encrypted',
        'recovery_code_hashes',
        'confirmed_at',
        'last_used_at',
        'failed_attempts',
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
        'secret_encrypted',
        'recovery_code_hashes',
    ];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'secret_encrypted' => 'encrypted',
            'recovery_code_hashes' => 'array',
            'confirmed_at' => 'immutable_datetime',
            'last_used_at' => 'immutable_datetime',
            'failed_attempts' => 'integer',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
            'deleted_at' => 'immutable_datetime',
        ];
    }

    /** @return BelongsTo<User, $this> */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class, 'user_id');
    }
}
