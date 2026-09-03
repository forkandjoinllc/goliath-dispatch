<?php

declare(strict_types=1);

namespace App\Support\Loads;

use App\Enums\LoadStatus;
use Illuminate\Support\Str;

/**
 * El nombre traducido de un estado de carga.
 *
 * EL FALLO QUE CIERRA. Las claves de `nav.status.load` están en camello
 * —`enRouteToPickup`— porque las escribe y las lee React, que camelliza el valor
 * antes de buscarlas. El servidor no camellizaba nada: pedía
 * `nav.status.load.en_route_to_pickup`, no encontraba nada, y Laravel devuelve
 * la clave cuando no encuentra la traducción. El mensaje de éxito de cinco de
 * los trece estados —los cinco de nombre compuesto, que son los del viaje y por
 * tanto los más pulsados— decía literalmente
 * «nav.status.load.en_route_to_pickup», en la pantalla más usada de la
 * aplicación.
 *
 * Vive aquí y no en el controlador porque eran DOS sitios haciendo lo mismo mal,
 * y React hace lo mismo en cinco más. Un helper es la respuesta a la segunda
 * copia; ésta era la séptima.
 */
final class StatusLabel
{
    public static function of(LoadStatus|string $status): string
    {
        $valor = $status instanceof LoadStatus ? $status->value : $status;

        return __('nav.status.load.'.Str::camel($valor));
    }
}
