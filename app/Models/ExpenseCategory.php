<?php

declare(strict_types=1);

namespace App\Models;

use App\Enums\ExpenseTreatment;
use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * Tiene tenant_id: toda consulta pasa por TenantScope. Para saltárselo hace
 * falta pedirlo a la cara con withoutTenantScope().
 */
final class ExpenseCategory extends BaseModel
{
    use BelongsToTenant, SoftDeletes;

    protected $table = 'expense_categories';

    /** @var list<string> */
    protected $fillable = [
        'tenant_id',
        'code',
        'label_en',
        'label_es',
        'treatment',
        'is_system',
        'requires_receipt',
        'active',
        'sort_order',
        'deleted_by',
        'deletion_reason',
    ];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'treatment' => ExpenseTreatment::class,
            'is_system' => 'boolean',
            'requires_receipt' => 'boolean',
            'active' => 'boolean',
            'sort_order' => 'integer',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
            'deleted_at' => 'immutable_datetime',
        ];
    }

    /** @return HasMany<Expense, $this> */
    public function expenses(): HasMany
    {
        return $this->hasMany(Expense::class, 'category_id');
    }
}
