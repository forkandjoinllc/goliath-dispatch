<?php

declare(strict_types=1);

namespace App\Support\Loads;

use App\Authorization\Actor;
use App\Authorization\PermissionChecker;
use App\Enums\Scope;
use App\Models\Load;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;

/**
 * Estrecha una consulta de cargas al ámbito concedido.
 *
 * Envuelve a ScopeFilter en lugar de sustituirlo, porque `loads` tiene un caso
 * que el filtro genérico no sabe expresar: **el conductor**.
 *
 * `loads` tiene `carrier_id` y `dispatcher_user_id`, así que los ámbitos de
 * transportista y despachador se resuelven con una columna. Pero un conductor no
 * aparece en la tabla de cargas: llega a ella a través de `load_assignments`, y
 * eso es un EXISTS, no un WHERE. Sin este puente, ScopeFilter no encontraría
 * ninguna columna que casara y devolvería `1 = 0` — el conductor entraría con
 * sus quince permisos y vería una lista vacía.
 *
 * Devolver cero filas es la forma segura de equivocarse, y por eso ScopeFilter
 * hace bien en hacerlo. Pero aquí sabemos cómo llegar, así que llegamos.
 */
final class LoadScope
{
    /**
     * @return Builder<Load>
     */
    public static function apply(
        Builder $query,
        PermissionChecker $checker,
        Actor $actor,
        Scope $scope,
    ): Builder {
        if ($scope === Scope::Own && $actor->driverId !== null) {
            // El ámbito `own` de un conductor: las cargas donde está asignado y
            // no se le ha quitado. `unassigned_at` importa — a un conductor al
            // que se le retiró una carga hace dos meses no se le sigue enseñando.
            return $query
                ->where('loads.tenant_id', $actor->tenantId)
                ->whereExists(function ($q) use ($actor): void {
                    $q->select(DB::raw(1))
                        ->from('load_assignments')
                        ->whereColumn('load_assignments.load_id', 'loads.id')
                        ->where('load_assignments.driver_id', $actor->driverId)
                        ->whereNull('load_assignments.unassigned_at')
                        ->whereNull('load_assignments.deleted_at');
                });
        }

        return $checker->scopeFilter($actor, $scope)->apply($query, [
            'carrier' => 'carrier_id',
            'dispatcher' => 'dispatcher_user_id',
            'owner' => 'dispatcher_user_id',
        ]);
    }
}
