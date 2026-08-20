<?php

declare(strict_types=1);

namespace App\Support\Marketing;

use App\Enums\Locale;
use App\Support\Locales;

/**
 * Las rutas públicas, en un solo sitio.
 *
 * La lista vive aquí porque la usan cuatro cosas que tienen que coincidir: el
 * enrutador, el sitemap, el robots.txt y las etiquetas hreflang de cada página.
 * Cuando estaban repartidas, añadir una página significaba acordarse de cuatro
 * ficheros; ahora la prueba de paridad falla si alguno se queda atrás.
 *
 * Los slugs van en INGLÉS en los dos idiomas (`/es/services`, no
 * `/es/servicios`). Traducirlos duplicaría el número de URLs a mantener,
 * partiría los enlaces que la gente ya haya compartido en cuanto se retoque una
 * traducción, y obligaría a una tabla de correspondencias en el enrutador. El
 * prefijo de idioma ya le dice a un buscador en qué idioma está el contenido.
 */
final class Site
{
    /** @var list<string> */
    public const ROUTES = [
        'home',
        'services',
        'heavy-haul',
        'for-carriers',
        'for-clients',
        'about',
        'contact',
        'resources',
        'carrier-signup',
        'privacy',
        'terms',
    ];

    /** Las que aparecen en la barra de navegación, en este orden. */
    public const PRIMARY_NAV = [
        'services',
        'heavy-haul',
        'for-carriers',
        'for-clients',
        'about',
        'contact',
    ];

    /**
     * `resources` y `about` no van todas en la barra a propósito: seis enlaces
     * se leen de un vistazo, nueve no. Las que faltan llegan desde el pie.
     */
    public const FOOTER_PRODUCT = ['services', 'heavy-haul', 'for-carriers', 'for-clients'];

    public const FOOTER_COMPANY = ['about', 'contact', 'resources', 'carrier-signup'];

    public const FOOTER_LEGAL = ['privacy', 'terms'];

    public static function path(Locale $locale, string $route = ''): string
    {
        if ($route === '' || $route === 'home') {
            return "/{$locale->value}";
        }

        return "/{$locale->value}/{$route}";
    }

    public static function url(string $path): string
    {
        return rtrim((string) config('app.url'), '/').'/'.ltrim($path, '/');
    }

    /**
     * Alternativas hreflang de una ruta, más `x-default`.
     *
     * `x-default` apunta al inglés porque es el idioma por omisión, no porque sea
     * más importante: es lo que se sirve a quien no expresa preferencia.
     *
     * @return array<string, string>
     */
    public static function languageAlternates(string $route): array
    {
        $out = [];

        foreach (Locale::cases() as $locale) {
            $out[Locales::tag($locale)] = self::url(self::path($locale, $route));
        }

        $out['x-default'] = self::url(self::path(Locale::En, $route));

        return $out;
    }

    /**
     * La clave del diccionario para una ruta: `heavy-haul` -> `heavyHaul`.
     */
    public static function dictionaryKey(string $route): string
    {
        return lcfirst(str_replace(' ', '', ucwords(str_replace('-', ' ', $route))));
    }

    /**
     * Los enlaces de un bloque de navegación, ya resueltos.
     *
     * @param  list<string>  $routes
     * @return list<array{route: string, href: string, labelKey: string}>
     */
    public static function links(Locale $locale, array $routes): array
    {
        return array_map(fn (string $route): array => [
            'route' => $route,
            'href' => self::path($locale, $route),
            'labelKey' => 'nav.public.'.self::dictionaryKey($route),
        ], $routes);
    }
}
