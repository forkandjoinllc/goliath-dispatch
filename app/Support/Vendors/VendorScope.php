<?php

declare(strict_types=1);

namespace App\Support\Vendors;

use App\Authorization\Actor;
use App\Authorization\PermissionChecker;
use App\Authorization\ResourceContext;
use App\Enums\Scope;
use App\Models\Vendor;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;

/**
 * Qué proveedores alcanza quien mira.
 *
 * ## Por qué esto no cabe en `ScopeFilter`
 *
 * Un proveedor no tiene columna de transportista: a quién sirve vive en
 * `vendor_carriers`, así que el alcance de transportista es un EXISTS y no un
 * WHERE. `ScopeFilter` sabe recortar por columna y no sabe expresar esto.
 *
 * Es exactamente la misma forma que `Drivers\DriverScope`, y por el mismo
 * motivo: la relación es de muchos a muchos.
 *
 * ## Y por qué un transportista solo ve los suyos
 *
 * Porque la lista de proveedores de una empresa de despacho es la lista de con
 * quién trabaja toda su flota. Un transportista que entra a ver su arrendadora
 * no tiene por qué llevarse de paso los talleres y las aseguradoras de sus
 * competidores, que están en la misma pantalla.
 */
final class VendorScope
{
    /**
     * @param  Builder<Vendor>  $query
     * @return Builder<Vendor>
     */
    public static function apply(Builder $query, PermissionChecker $checker, Actor $actor, Scope $scope): Builder
    {
        if (in_array($scope, [Scope::Carrier, Scope::Assigned], true)) {
            $carrierIds = $scope === Scope::Carrier
                ? array_filter([$actor->carrierId])
                : $actor->assignments->carrierIds;

            return $query
                ->where('vendors.tenant_id', $actor->tenantId)
                ->whereExists(function ($q) use ($carrierIds): void {
                    $q->select(DB::raw(1))
                        ->from('vendor_carriers as vc')
                        ->whereColumn('vc.vendor_id', 'vendors.id')
                        ->whereIn('vc.carrier_id', $carrierIds)
                        ->whereNull('vc.deleted_at');
                });
        }

        // Un proveedor no es de nadie en particular: no hay «lo mío». Quien
        // llegue con alcance propio no alcanza ninguno, y lo dice con una
        // lista vacía y no con un error.
        if ($scope === Scope::Own) {
            return $query->whereRaw('1 = 0');
        }

        return $checker->scopeFilter($actor, $scope)->apply($query);
    }

    /**
     * El contexto con el que se pide permiso sobre UN proveedor.
     *
     * `carrierId` va nulo a propósito: el proveedor no pertenece a un
     * transportista, le sirve a varios, y pasar uno de ellos como si fuera
     * «su» transportista daría permiso sobre el proveedor entero a quien solo
     * comparte una de sus relaciones. El recorte por transportista lo hace
     * `apply()`, que es donde puede expresarse.
     *
     * Los argumentos van NOMBRADOS. `ResourceContext` toma cuatro cadenas y
     * ponerlas en otro orden no falla: devuelve un contexto que parece
     * correcto y deniega por «fuera de alcance» sin decir por qué. Ya pasó una
     * vez, en el lote 36.
     */
    public static function contexto(Vendor $vendor): ResourceContext
    {
        return new ResourceContext(
            tenantId: (string) $vendor->tenant_id,
            carrierId: null,
        );
    }
}
