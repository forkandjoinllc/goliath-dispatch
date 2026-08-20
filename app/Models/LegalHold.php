<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Tiene tenant_id: toda consulta pasa por TenantScope. Para saltárselo hace
 * falta pedirlo a la cara con withoutTenantScope().
 */
final class LegalHold extends BaseModel
{
    use BelongsToTenant;

    protected $table = 'legal_holds';

    /** @var list<string> */
    protected $fillable = [
        'tenant_id',
        'name',
        'reason',
        'scope_type',
        'entity_type',
        'entity_id',
        'matter_reference',
        'applied_by_user_id',
        'applied_at',
        'released_by_user_id',
        'released_at',
        'release_reason',
    ];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'applied_at' => 'immutable_datetime',
            'released_at' => 'immutable_datetime',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
        ];
    }

    /** @return BelongsTo<User, $this> */
    public function appliedByUser(): BelongsTo
    {
        return $this->belongsTo(User::class, 'applied_by_user_id');
    }

    /** @return BelongsTo<User, $this> */
    public function releasedByUser(): BelongsTo
    {
        return $this->belongsTo(User::class, 'released_by_user_id');
    }
}
