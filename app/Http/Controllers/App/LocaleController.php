<?php

declare(strict_types=1);

namespace App\Http\Controllers\App;

use App\Support\Locales;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cookie;
use Illuminate\Validation\Rule;

/**
 * Cambia el idioma dentro de la aplicación.
 *
 * En el sitio público el idioma va en la URL (/es/servicios) porque esas URLs se
 * comparten y se indexan. Aquí no: /loads es /loads para todo el mundo, y el
 * idioma es una preferencia de la persona. Duplicar cada ruta interna por idioma
 * no daría nada a cambio de doblar la superficie de rutas.
 *
 * Se guarda en la COLUMNA del usuario, no solo en una cookie, para que la
 * elección viaje al móvil, a los correos y a los PDF que genera el sistema.
 */
final class LocaleController
{
    public function __invoke(Request $request): RedirectResponse
    {
        $validated = $request->validate([
            'locale' => ['required', 'string', Rule::in(Locales::all())],
        ]);

        $locale = Locales::normalize($validated['locale']);

        $request->user()->forceFill(['locale' => $locale->value])->save();

        // La cookie además de la columna: SetLocale la consulta antes de que
        // haya sesión, así que la pantalla de acceso sale ya en el idioma
        // elegido la próxima vez.
        Cookie::queue(Cookie::forever(Locales::COOKIE, $locale->value));

        return back();
    }
}
