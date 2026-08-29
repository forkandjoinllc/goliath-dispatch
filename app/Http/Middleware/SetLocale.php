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
 *  4. **El prefijo de la URL DE LA QUE VIENE** (el referente). Solo importa en
 *     los envíos de formulario: los tres formularios públicos van a `/leads`,
 *     `/quote-requests` y `/carrier-signup`, sin prefijo de idioma, así que sin
 *     esto un visitante que rellena la página en español entra en la base con
 *     `locale = 'en'` — y `leads.locale` es justo la columna que decide en qué
 *     idioma se le contesta. Se mira por debajo de la cookie: quien eligió
 *     idioma a mano eligió, y la página en la que estaba no le contradice.
 *  5. **La cabecera Accept-Language**.
 *  6. Inglés.
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

        $referente = $this->localeDelReferente($request);
        if ($referente !== null) {
            return $referente;
        }

        return Locales::negotiate($request->header('Accept-Language'));
    }

    /**
     * El idioma del prefijo de la página desde la que se envió el formulario.
     *
     * Se comprueba que el referente sea del MISMO host antes de mirarle el
     * camino. Un referente lo pone el navegador y puede venir de cualquier
     * sitio; sin esta comprobación, una página ajena podría decidir en qué
     * idioma se guarda un prospecto. No es grave —lo peor es contestar en el
     * idioma equivocado— pero es gratis no dejarlo abierto.
     */
    private function localeDelReferente(Request $request): ?Locale
    {
        $referente = (string) $request->headers->get('referer');

        if ($referente === '') {
            return null;
        }

        $partes = parse_url($referente);

        if (! is_array($partes) || ($partes['host'] ?? null) !== $request->getHost()) {
            return null;
        }

        $primerSegmento = explode('/', trim((string) ($partes['path'] ?? ''), '/'))[0] ?? '';

        return Locales::isSupported($primerSegmento) ? Locales::normalize($primerSegmento) : null;
    }
}
