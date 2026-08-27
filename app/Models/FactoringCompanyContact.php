<?php

declare(strict_types=1);

namespace App\Models;

use App\Enums\FactoringContactPosition;
use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * Una persona concreta dentro de una empresa de factoring.
 *
 * El cargo (`position`) es lo que da valor a la fila: dice a quién llamar para
 * qué. Ver App\Enums\FactoringContactPosition.
 */
final class FactoringCompanyContact extends BaseModel
{
    use BelongsToTenant, SoftDeletes;

    protected $table = 'factoring_company_contacts';

    /** @var list<string> */
    protected $fillable = [
        'tenant_id',
        'factoring_company_id',
        'first_name',
        'last_name',
        'email',
        'phone',
        'position',
        'notes',
        'deleted_by',
        'deletion_reason',
    ];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'position' => FactoringContactPosition::class,
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
            'deleted_at' => 'immutable_datetime',
        ];
    }

    /**
     * @return BelongsTo<FactoringCompany, $this>
     */
    public function company(): BelongsTo
    {
        return $this->belongsTo(FactoringCompany::class, 'factoring_company_id');
    }

    public function fullName(): string
    {
        return trim("{$this->first_name} {$this->last_name}");
    }
}
