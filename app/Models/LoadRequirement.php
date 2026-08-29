<?php

declare(strict_types=1);

namespace App\Models;

use App\Enums\LoadRequirementType;
use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * Un requisito de una carga. Ver App\Support\Loads\DriverEligibility.
 */
final class LoadRequirement extends BaseModel
{
    use BelongsToTenant, SoftDeletes;

    protected $table = 'load_requirements';

    /** @var list<string> */
    protected $fillable = [
        'tenant_id',
        'load_id',
        'requirement_type',
        'value',
        'source',
        'notes',
        'created_by_user_id',
        'deleted_by',
        'deletion_reason',
    ];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'requirement_type' => LoadRequirementType::class,
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
            'deleted_at' => 'immutable_datetime',
        ];
    }

    /**
     * La carga a la que pertenece este requisito.
     *
     * NO se puede llamar `load()`: Eloquent\Model ya declara `load($relations)`
     * —la de cargar relaciones a posteriori— y redeclararla con otra firma es un
     * FATAL al cargar la clase, no un aviso. Con ese nombre, `LoadRequirement`
     * era una clase que no se podía ni autocargar: cualquier código que la
     * tocara reventaba el proceso entero, y bajo Pest sin imprimir nada.
     *
     * @return BelongsTo<Load, $this>
     */
    public function parentLoad(): BelongsTo
    {
        return $this->belongsTo(Load::class, 'load_id');
    }
}
