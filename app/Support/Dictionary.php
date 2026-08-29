<?php

declare(strict_types=1);

namespace App\Support;

use App\Enums\Locale;
use Illuminate\Support\Facades\Cache;

/**
 * Carga los diccionarios de traducción para enviarlos al cliente.
 *
 * Lo importante aquí es lo que NO hace: no manda los 22 espacios de nombres a
 * cada página. Son 3.374 claves, unos 190 KB de JSON en dos idiomas, y una
 * página de marketing necesita tres de ellos. Enviarlo todo triplicaría el peso
 * del HTML inicial por comodidad del programador.
 *
 * Cada página declara los espacios que usa y solo esos viajan.
 */
final class Dictionary
{
    /** Espacios que necesita toda página: navegación, textos comunes, errores. */
    public const ALWAYS = ['common', 'nav', 'errors'];

    /**
     * Espacios que necesita todo lo que va DENTRO de la aplicación.
     *
     * `notifications` está aquí por la campana, que vive en la barra superior y
     * por tanto envuelve todas las pantallas autenticadas. Si dependiera de que
     * cada controlador lo declarase, un olvido dejaría la campana con la clave
     * en crudo en su etiqueta accesible — invisible para quien mira y roto para
     * quien usa un lector de pantalla.
     *
     * Y está SEPARADO de `ALWAYS` porque el sitio público no tiene campana y no
     * debe pagar por ella: lo pilló `PublicSiteTest`, que comprueba que a una
     * página de marketing solo le viajan los espacios que pidió.
     */
    public const AUTHENTICATED = ['notifications'];

    /**
     * @param  list<string>  $namespaces
     * @return array<string, mixed>
     */
    public static function for(Locale $locale, array $namespaces = []): array
    {
        $wanted = array_values(array_unique([...self::ALWAYS, ...$namespaces]));
        sort($wanted);

        // La huella de los ficheros entra en la CLAVE. Sin ella, `rememberForever`
        // hacía honor a su nombre: el diccionario cacheado en el primer
        // despliegue sobrevivía a todos los siguientes, y una cadena nueva salía
        // en la página como `marketing.company.hours247` hasta que alguien se
        // acordaba de limpiar la caché a mano. El despliegue cachea config, rutas,
        // vistas y eventos, pero nunca tocó esta.
        //
        // Cuesta un `stat` por espacio de nombres —seis en una página de
        // marketing, y el sistema operativo los tiene en memoria— a cambio de que
        // nadie tenga que acordarse de nada.
        $key = "dict:{$locale->value}:".implode(',', $wanted).':'.self::fingerprint($locale, $wanted);

        // En producción se cachea; en local no, para no limpiar nada al tocar una
        // cadena.
        $load = fn (): array => self::load($locale, $wanted);

        return app()->isProduction()
            ? Cache::rememberForever($key, $load)
            : $load();
    }

    /**
     * La huella de los ficheros que componen este diccionario.
     *
     * La fecha de modificación de cada uno, resumida. Cambia una cadena y cambia
     * la clave, así que la entrada vieja deja de consultarse sola — y la nueva
     * se calcula en la primera petición que la pida.
     *
     * Las entradas huérfanas caducan por su cuenta cuando el almacén de caché
     * las expulsa. No se borran a mano: `rememberForever` sobre una clave que ya
     * nadie pregunta no hace daño, y buscarlas para borrarlas costaría más que
     * dejarlas.
     *
     * @param  list<string>  $namespaces
     */
    private static function fingerprint(Locale $locale, array $namespaces): string
    {
        $stamps = [];

        foreach ($namespaces as $namespace) {
            $path = lang_path("{$locale->value}/{$namespace}.json");

            $stamps[] = is_file($path) ? (string) filemtime($path) : '0';
        }

        return substr(md5(implode('|', $stamps)), 0, 12);
    }

    /**
     * @param  list<string>  $namespaces
     * @return array<string, mixed>
     */
    private static function load(Locale $locale, array $namespaces): array
    {
        $out = [];

        foreach ($namespaces as $namespace) {
            $path = lang_path("{$locale->value}/{$namespace}.json");

            if (! is_file($path)) {
                continue;
            }

            $decoded = json_decode((string) file_get_contents($path), true);

            if (is_array($decoded)) {
                $out[$namespace] = $decoded;
            }
        }

        return $out;
    }

    /** @return list<string> */
    public static function namespaces(): array
    {
        return collect(glob(lang_path('en/*.json')) ?: [])
            ->map(fn (string $p): string => basename($p, '.json'))
            ->sort()
            ->values()
            ->all();
    }
}
