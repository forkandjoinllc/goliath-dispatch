<?php

declare(strict_types=1);

namespace App\Http\Controllers\App;

use App\Support\Time\Clock;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * Cambia el reloj con el que esta persona lee la aplicación.
 *
 * ## Por qué hacía falta una pantalla
 *
 * `users.timezone` existía desde el primer esquema, con `America/New_York` por
 * omisión, y NADIE lo leía. Cuando este lote empezó a leerlo apareció el
 * problema de verdad: una empresa de Texas veía todo con una hora de más y no
 * tenía dónde arreglarlo. Un ajuste que solo se puede cambiar con un `update`
 * a mano en la base de datos no es un ajuste.
 *
 * ## Por qué en la barra y no en una pantalla de perfil
 *
 * Es hermano del idioma, no de los ajustes de empresa: cambia lo que dicen
 * TODAS las pantallas, no lo que hace el sistema. Por eso vive junto al
 * selector de idioma —misma ruta corta, mismo sitio en la barra— y no detrás de
 * un menú de configuración que solo abre quien ya sospecha que hay algo mal.
 *
 * ## Sin permiso, y es deliberado
 *
 * Igual que el idioma: nadie decide en qué reloj lee otro. La frontera aquí es
 * la identidad —`$request->user()`, no un actor con alcance— y por eso no se
 * consulta el catálogo de permisos.
 *
 * ## Sin cookie, a diferencia del idioma
 *
 * El idioma guarda además una cookie porque la pantalla de acceso tiene que
 * salir en el idioma correcto ANTES de que haya sesión. El huso no pinta nada
 * antes de entrar: sin sesión no hay ninguna hora que enseñar.
 */
final class TimezoneController
{
    public function __invoke(Request $request): RedirectResponse
    {
        $validated = $request->validate([
            'timezone' => ['required', 'string', Rule::in(Clock::opciones())],
        ]);

        // `Rule::in` sobre la lista corta y no `timezone_identifiers_list()`:
        // el desplegable ofrece ocho husos y esta ruta acepta esos ocho. Aceptar
        // los cuatrocientos permitiría dejar la cuenta en un huso que ninguna
        // pantalla vuelve a ofrecer, y desde el que ya no se puede salir sin
        // tocar la base de datos.
        $request->user()->forceFill(['timezone' => $validated['timezone']])->save();

        return back();
    }
}
