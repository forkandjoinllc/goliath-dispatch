<?php

declare(strict_types=1);

namespace App\Authorization;

use App\Enums\Scope;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Query\Builder as QueryBuilder;

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

        $this->narrow($query, $table, $columns);

        return $query;
    }

    /**
     * El mismo estrechamiento, sobre una consulta sin modelo.
     *
     * ## Por qué hacía falta
     *
     * Dos pantallas se estrechaban a mano y las dos escribían lo mismo:
     *
     * ```php
     * Scope::Platform, Scope::Tenant, Scope::Assigned => $consulta,
     * ```
     *
     * Es decir: al despachador, cuyo ámbito ES `Assigned`, le devolvían la
     * empresa entera. En el tablero de altas veía el nombre legal, el número
     * DOT, el estado del alta y qué papeles le faltan a transportistas que no
     * son suyos; en firmas veía —y podía abrir— las solicitudes de esos mismos
     * transportistas, con el correo del firmante dentro.
     *
     * Y no era que la regla no existiera: `apply()` lleva desde siempre
     * traduciendo `Assigned` a `assignments->carrierIds`, y catorce sitios la
     * usan. Lo que pasaba es que esas dos pantallas usan `DB::table(...)` con
     * alias y join, no un modelo, y `apply()` pide un `Builder` de Eloquent
     * porque saca el nombre de la tabla de él. Ante una pieza que no encajaba,
     * se escribió el `match` a mano — y se escribió mal.
     *
     * ## Lo que hay que pasarle
     *
     * `$prefijo` es el alias con el que la consulta nombra la tabla (`c`, `r`),
     * porque aquí no hay modelo del que deducirlo.
     *
     * Y el filtro por `tenant_id` NO se aplica: sin modelo no se puede
     * comprobar si la tabla tiene la columna, y adivinarlo sería peor. Lo pone
     * quien llama, antes, y un guardián lo exige.
     *
     * @param  array{carrier?: string, driver?: string, truck?: string, trailer?: string, dispatcher?: string, owner?: string}  $columns
     */
    public function applyToQuery(QueryBuilder $query, string $prefijo, array $columns = []): QueryBuilder
    {
        if ($this->scope === Scope::Platform) {
            return $query;
        }

        $this->narrow($query, $prefijo, $columns);

        return $query;
    }

    /**
     * El estrechamiento, sin depender de qué clase de consulta sea.
     *
     * @param  Builder<\Illuminate\Database\Eloquent\Model>|QueryBuilder  $query
     * @param  array<string, string>  $columns
     */
    private function narrow($query, string $table, array $columns): void
    {
        match ($this->scope) {
            Scope::Platform, Scope::Tenant => null,

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
