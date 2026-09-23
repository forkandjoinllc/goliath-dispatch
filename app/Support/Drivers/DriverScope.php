<?php

declare(strict_types=1);

namespace App\Support\Drivers;

use App\Authorization\Actor;
use App\Authorization\PermissionChecker;
use App\Authorization\ResourceContext;
use App\Enums\Scope;
use App\Models\Driver;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;

/**
 * Qué conductores alcanza quien mira.
 *
 * ## Por qué esto no cabe en `ScopeFilter`
 *
 * Un conductor no tiene columna de transportista: la relación vive en
 * `driver_carrier_relationships`, así que el alcance de transportista es un
 * EXISTS y no un WHERE. `ScopeFilter` sabe recortar por columna y no sabe
 * expresar esto, y por eso hay que tenderle el puente.
 *
 * ## Y por qué está aquí y no en el controlador
 *
 * Porque ahora hay DOS pantallas que enseñan conductores —la lista y el
 * tablero de despacho— y la misma pregunta contestada en dos sitios acaba
 * contestándose distinto. La que se desviara sería la del tablero, que es la
 * que se mira todo el día: enseñaría a un conductor de otro transportista en
 * la columna de la derecha mientras la lista no lo enseña, y nadie sabría cuál
 * de las dos tiene razón.
 *
 * Hermana de `Loads\LoadScope`, `Documents\DocumentScope` y
 * `Messaging\MessageScope`, por el mismo motivo y con la misma forma.
 */
final class DriverScope
{
    /**
     * @param  Builder<Driver>  $query
     * @return Builder<Driver>
     */
    public static function apply(Builder $query, PermissionChecker $checker, Actor $actor, Scope $scope): Builder
    {
        if (in_array($scope, [Scope::Carrier, Scope::Assigned], true)) {
            $carrierIds = $scope === Scope::Carrier
                ? array_filter([$actor->carrierId])
                : $actor->assignments->carrierIds;

            return $query
                ->where('drivers.tenant_id', $actor->tenantId)
                ->whereExists(function ($q) use ($carrierIds): void {
                    $q->select(DB::raw(1))
                        ->from('driver_carrier_relationships as r')
                        ->whereColumn('r.driver_id', 'drivers.id')
                        ->whereIn('r.carrier_id', $carrierIds)
                        ->whereNull('r.deleted_at');
                });
        }

        if ($scope === Scope::Own) {
            // Su propia ficha y nada más.
            return $query
                ->where('drivers.tenant_id', $actor->tenantId)
                ->whereKey($actor->driverId ?? '-');
        }

        return $checker->scopeFilter($actor, $scope)->apply($query);
    }

    /**
     * El contexto con el que se pide permiso sobre UN conductor.
     *
     * Aquí y no en cada controlador porque `ResourceContext` toma cuatro
     * identificadores del mismo tipo —todos cadenas— y ponerlos en otro orden
     * no falla: devuelve un contexto que parece correcto y deniega por
     * «fuera de alcance» sin decir por qué. Pasó al escribir la asignación de
     * equipo, y costó más encontrarlo que escribirlo.
     */
    public static function contexto(Driver $driver): ResourceContext
    {
        // El transportista del conductor sale de la relación. Se coge la
        // vigente: un conductor que trabajó para otro transportista hace dos
        // años no debe dar acceso a aquel transportista.
        $carrierId = DB::table('driver_carrier_relationships')
            ->where('driver_id', $driver->id)
            ->whereNull('deleted_at')
            ->where(function ($q): void {
                $q->whereNull('end_date')->orWhereDate('end_date', '>=', now()->toDateString());
            })
            ->orderByDesc('is_primary')
            ->value('carrier_id');

        return new ResourceContext(
            tenantId: $driver->tenant_id,
            carrierId: $carrierId,
            driverId: $driver->id,
            ownerUserId: $driver->user_id,
        );
    }
}
