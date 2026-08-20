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
     * @param  list<string>  $namespaces
     * @return array<string, mixed>
     */
    public static function for(Locale $locale, array $namespaces = []): array
    {
        $wanted = array_values(array_unique([...self::ALWAYS, ...$namespaces]));
        sort($wanted);

        $key = "dict:{$locale->value}:".implode(',', $wanted);

        // En producción el diccionario no cambia entre despliegues, así que se
        // cachea. En local no, para no tener que limpiar la caché cada vez que se
        // toca una cadena.
        $load = fn (): array => self::load($locale, $wanted);

        return app()->isProduction()
            ? Cache::rememberForever($key, $load)
            : $load();
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
