<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Enums\Locale;
use App\Support\Locales;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\App;
use Symfony\Component\HttpFoundation\Response;

/**
 * Decide en qué idioma se sirve esta petición.
 *
 * Orden de precedencia, de más a menos específico:
 *
 *  1. **El prefijo de la URL** (`/es/servicios`). Manda sobre todo lo demás
 *     porque es lo que se comparte, se indexa y se marca como favorito. Si una
 *     cookie pudiera cambiar lo que sirve una URL, dos personas que abren el
 *     mismo enlace verían páginas distintas — y Google indexaría una de las dos.
 *  2. **La preferencia del usuario autenticado** (`users.locale`).
 *  3. **La cookie**, para quien ya eligió sin tener cuenta.
 *  4. **La cabecera Accept-Language**.
 *  5. Inglés.
 */
final class SetLocale
{
    public function handle(Request $request, Closure $next): Response
    {
        $locale = $this->resolve($request);

        App::setLocale($locale->value);
        // El de reserva es el otro idioma, no el inglés siempre: si a una clave
        // le falta la traducción, es mejor mostrarla en el otro idioma que
        // mostrar la clave cruda al usuario. Las pruebas garantizan que no falte
        // ninguna, así que esto es un cinturón sobre unos tirantes.
        App::setFallbackLocale(Locales::alternate($locale)->value);

        $request->attributes->set('locale', $locale);

        return $next($request);
    }

    private function resolve(Request $request): Locale
    {
        $segment = $request->segment(1);
        if (Locales::isSupported($segment)) {
            return Locales::normalize($segment);
        }

        $user = $request->user();
        if ($user !== null && isset($user->locale)) {
            return Locales::normalize(
                $user->locale instanceof Locale ? $user->locale->value : (string) $user->locale
            );
        }

        $cookie = $request->cookie(Locales::COOKIE);
        if (is_string($cookie) && Locales::isSupported($cookie)) {
            return Locales::normalize($cookie);
        }

        return Locales::negotiate($request->header('Accept-Language'));
    }
}
