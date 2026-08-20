<?php

declare(strict_types=1);

namespace App\Authorization;

use App\Enums\Scope;
use Illuminate\Database\Eloquent\Builder;

/**
 * Traduce un ámbito concedido a un estrechamiento de consulta.
 *
 * Sirve para que la página índice de un despachador ni siquiera pueda *traer*
 * las filas que no le corresponde ver. Comprobar el permiso fila a fila después
 * de cargarlas sería tarde: los totales, los contadores y la paginación ya
 * habrían filtrado información.
 */
final readonly class ScopeFilter
{
    public function __construct(
        public Scope $scope,
        public ?string $tenantId,
        public ?string $userId = null,
        public ?string $carrierId = null,
        public ?string $driverId = null,
        public AssignmentScope $assignments = new AssignmentScope,
    ) {}

    public static function for(Actor $actor, Scope $scope): self
    {
        return new self(
            scope: $scope,
            tenantId: $actor->tenantId,
            userId: $actor->userId,
            carrierId: $actor->carrierId,
            driverId: $actor->driverId,
            assignments: $actor->assignments,
        );
    }

    /**
     * Aplica el estrechamiento a una consulta.
     *
     * $columns dice qué columna de ESTA tabla corresponde a cada hecho de ámbito.
     * Es explícito porque no todas las tablas nombran igual sus relaciones —
     * `loads` tiene `carrier_id`, pero `expenses` puede llegar al transportista
     * solo a través de la carga.
     *
     * @param  array{carrier?: string, driver?: string, truck?: string, trailer?: string, dispatcher?: string, owner?: string}  $columns
     *
     * @template TModel of \Illuminate\Database\Eloquent\Model
     *
     * @param  Builder<TModel>  $query
     * @return Builder<TModel>
     */
    public function apply(Builder $query, array $columns = []): Builder
    {
        if ($this->scope === Scope::Platform) {
            return $query;
        }

        $table = $query->getModel()->getTable();

        if ($this->tenantId !== null && $query->getModel()->getConnection()
            ->getSchemaBuilder()->hasColumn($table, 'tenant_id')) {
            $query->where("{$table}.tenant_id", $this->tenantId);
        }

        return match ($this->scope) {
            Scope::Tenant => $query,

            Scope::Carrier => isset($columns['carrier'])
                ? $query->where("{$table}.{$columns['carrier']}", $this->carrierId)
                // Sin columna de transportista no se puede demostrar la pertenencia:
                // no devolvemos nada, en lugar de devolverlo todo.
                : $query->whereRaw('1 = 0'),

            Scope::Own => $query->where(function ($q) use ($table, $columns): void {
                $matched = false;
                if (isset($columns['owner'])) {
                    $q->orWhere("{$table}.{$columns['owner']}", $this->userId);
                    $matched = true;
                }
                if (isset($columns['driver']) && $this->driverId !== null) {
                    $q->orWhere("{$table}.{$columns['driver']}", $this->driverId);
                    $matched = true;
                }
                if (isset($columns['dispatcher'])) {
                    $q->orWhere("{$table}.{$columns['dispatcher']}", $this->userId);
                    $matched = true;
                }
                if (! $matched) {
                    $q->whereRaw('1 = 0');
                }
            }),

            Scope::Assigned => $query->where(function ($q) use ($table, $columns): void {
                $matched = false;
                if (isset($columns['carrier']) && $this->assignments->carrierIds !== []) {
                    $q->orWhereIn("{$table}.{$columns['carrier']}", $this->assignments->carrierIds);
                    $matched = true;
                }
                if (isset($columns['truck']) && $this->assignments->truckIds !== []) {
                    $q->orWhereIn("{$table}.{$columns['truck']}", $this->assignments->truckIds);
                    $matched = true;
                }
                if (isset($columns['trailer']) && $this->assignments->trailerIds !== []) {
                    $q->orWhereIn("{$table}.{$columns['trailer']}", $this->assignments->trailerIds);
                    $matched = true;
                }
                if (isset($columns['driver']) && $this->assignments->driverIds !== []) {
                    $q->orWhereIn("{$table}.{$columns['driver']}", $this->assignments->driverIds);
                    $matched = true;
                }
                if (isset($columns['dispatcher'])) {
                    $q->orWhere("{$table}.{$columns['dispatcher']}", $this->userId);
                    $matched = true;
                }
                if (! $matched) {
                    $q->whereRaw('1 = 0');
                }
            }),

        };
    }
}
