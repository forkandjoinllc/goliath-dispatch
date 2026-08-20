<?php

declare(strict_types=1);

use App\Enums\Locale;
use App\Support\Dictionary;
use App\Support\Locales;

/**
 * El sistema es bilingüe de verdad, no «inglés con traducciones»: las dos
 * versiones se despliegan a la vez y se indexan por separado. Una clave que
 * falta en español no es un detalle cosmético — es una página que sale a medias
 * en producción, y el idioma en el que sale a medias es siempre el mismo.
 */

/** @return array<string, string> */
function flatten(array $node, string $prefix = ''): array
{
    $out = [];

    foreach ($node as $key => $value) {
        $path = $prefix === '' ? (string) $key : "{$prefix}.{$key}";

        if (is_array($value)) {
            $out += flatten($value, $path);

            continue;
        }

        $out[$path] = (string) $value;
    }

    return $out;
}

/**
 * La ruta a lang/ se calcula desde este fichero y no con lang_path().
 *
 * Los conjuntos de datos de Pest (`->with(...)`) se evalúan al RECOLECTAR las
 * pruebas, antes de que la aplicación arranque, así que cualquier helper de
 * Laravel ahí dentro revienta con «Call to undefined method Container::langPath».
 */
function langDir(): string
{
    return dirname(__DIR__, 3).'/lang';
}

/** @return list<string> */
function namespaceNames(): array
{
    $names = array_map(
        static fn (string $path): string => basename($path, '.json'),
        glob(langDir().'/en/*.json') ?: [],
    );
    sort($names);

    return $names;
}

function dictionaryOf(string $locale, string $namespace): array
{
    $path = langDir()."/{$locale}/{$namespace}.json";
    expect(is_file($path))->toBeTrue("falta {$path}");

    return flatten((array) json_decode((string) file_get_contents($path), true, 512, JSON_THROW_ON_ERROR));
}

it('los dos idiomas tienen los mismos espacios de nombres', function () {
    $en = collect(glob(langDir().'/en/*.json'))->map(fn ($p) => basename($p))->sort()->values();
    $es = collect(glob(langDir().'/es/*.json'))->map(fn ($p) => basename($p))->sort()->values();

    expect($es->all())->toBe($en->all());
    expect($en)->toHaveCount(22);
});

it('cada espacio tiene exactamente las mismas claves en los dos idiomas', function (string $namespace) {
    $en = dictionaryOf('en', $namespace);
    $es = dictionaryOf('es', $namespace);

    $missingEs = array_values(array_diff(array_keys($en), array_keys($es)));
    $missingEn = array_values(array_diff(array_keys($es), array_keys($en)));

    expect($missingEs)->toBe([], "{$namespace}: sin traducir al español → ".implode(', ', array_slice($missingEs, 0, 5)));
    expect($missingEn)->toBe([], "{$namespace}: solo en español → ".implode(', ', array_slice($missingEn, 0, 5)));
})->with(fn () => namespaceNames());

it('ninguna cadena larga quedó idéntica en los dos idiomas', function (string $namespace) {
    $en = dictionaryOf('en', $namespace);
    $es = dictionaryOf('es', $namespace);

    // Las cadenas cortas coinciden legítimamente («Email», «PDF», «OK»). A partir
    // de 30 caracteres, un texto idéntico es casi seguro un copiar-pegar sin
    // traducir.
    $suspicious = [];
    foreach ($en as $key => $value) {
        if (mb_strlen($value) > 30 && ($es[$key] ?? null) === $value) {
            $suspicious[] = $key;
        }
    }

    expect($suspicious)->toBe([], "{$namespace}: idénticas en ambos idiomas → ".implode(', ', array_slice($suspicious, 0, 5)));
})->with(fn () => namespaceNames());

it('los marcadores {…} coinciden entre idiomas', function (string $namespace) {
    $en = dictionaryOf('en', $namespace);
    $es = dictionaryOf('es', $namespace);

    // Las llaves DOBLES no son parámetros: son ejemplos de la sintaxis de
    // plantillas de firma, como «referenciadas en el cuerpo como {{tokenName}}».
    // Ahí el nombre es ilustrativo y traducirlo es correcto. Se quitan antes de
    // extraer los parámetros de verdad.
    $stripExamples = static fn (string $text): string => (string) preg_replace('/\{\{\w+\}\}/', '', $text);

    $problems = [];
    foreach ($en as $key => $value) {
        preg_match_all('/\{(\w+)\}/', $stripExamples($value), $enMatches);
        preg_match_all('/\{(\w+)\}/', $stripExamples($es[$key] ?? ''), $esMatches);

        $enParams = array_unique($enMatches[1]);
        $esParams = array_unique($esMatches[1]);
        sort($enParams);
        sort($esParams);

        // Un {year} que se pierde al traducir deja el año literal «{year}» en la
        // pantalla, y no lo ve nadie que trabaje en inglés.
        if ($enParams !== $esParams) {
            $problems[] = "{$key} (en: ".implode(',', $enParams).' / es: '.implode(',', $esParams).')';
        }
    }

    expect($problems)->toBe([], "{$namespace}: ".implode(' | ', array_slice($problems, 0, 5)));
})->with(fn () => namespaceNames());

it('el cargador resuelve claves anidadas en los dos idiomas', function () {
    foreach (Locales::all() as $locale) {
        app()->setLocale($locale);

        // Si esto devolviera la clave, el JSON por espacio no se estaría
        // cargando y todo el SEO saldría como «marketing.seo.home.title».
        expect(__('marketing.seo.home.title'))->not->toBe('marketing.seo.home.title');
        expect(__('nav.public.heavyHaul'))->not->toBe('nav.public.heavyHaul');
        // Y los mensajes propios de Laravel siguen funcionando.
        expect(__('validation.required', ['attribute' => 'x']))->not->toBe('validation.required');
    }
});

it('Dictionary manda solo los espacios pedidos', function () {
    $only = Dictionary::for(Locale::Es, ['marketing']);

    expect(array_keys($only))->toEqualCanonicalizing([...Dictionary::ALWAYS, 'marketing']);
    // Mandar los 22 serían 3.374 claves y unos 190 KB en cada página.
    expect($only)->not->toHaveKey('finance');
});
