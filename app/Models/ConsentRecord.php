<?php

declare(strict_types=1);

namespace App\Models;

use App\Enums\ConsentType;
use App\Enums\Locale;
use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Tiene tenant_id: toda consulta pasa por TenantScope. Para saltárselo hace
 * falta pedirlo a la cara con withoutTenantScope().
 */
final class ConsentRecord extends BaseModel
{
    use BelongsToTenant;

    protected $table = 'consent_records';

    /** @var list<string> */
    protected $fillable = [
        'tenant_id',
        'user_id',
        'subject_email',
        'consent_type',
        'policy_version',
        'granted',
        'locale',
        'ip_address',
        'user_agent',
        'revoked_at',
    ];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'consent_type' => ConsentType::class,
            'granted' => 'boolean',
            'locale' => Locale::class,
            'revoked_at' => 'immutable_datetime',
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
