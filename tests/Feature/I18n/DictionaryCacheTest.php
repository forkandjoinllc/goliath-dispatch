<?php

declare(strict_types=1);

use App\Enums\Locale;
use App\Support\Dictionary;

/*
| Esta prueba nace de un fallo que llegó a producción: la página de contacto
| enseñaba `marketing.company.hours247` en crudo, con la clave ya escrita en los
| dos diccionarios y desplegada. El diccionario estaba cacheado con
| `rememberForever` desde un despliegue anterior y el script de despliegue —que
| cachea config, rutas, vistas y eventos— nunca tocó la caché de aplicación.
*/

it('la clave de caché cambia cuando cambia el fichero', function () {
    $reflect = new ReflectionMethod(Dictionary::class, 'fingerprint');

    $antes = $reflect->invoke(null, Locale::En, ['common']);

    // Se toca la fecha del fichero, como haría un despliegue con una cadena
    // nueva dentro.
    $path = lang_path('en/common.json');
    $original = filemtime($path);
    touch($path, $original + 60);
    clearstatcache(true, $path);

    $despues = $reflect->invoke(null, Locale::En, ['common']);

    touch($path, $original);
    clearstatcache(true, $path);

    expect($despues)->not->toBe($antes);
});

it('la huella no cambia sola entre dos lecturas', function () {
    // Si cambiara sin motivo, la caché no cachearía nada y cada petición
    // volvería a leer y decodificar 190 KB de JSON.
    $reflect = new ReflectionMethod(Dictionary::class, 'fingerprint');

    expect($reflect->invoke(null, Locale::En, ['common', 'nav']))
        ->toBe($reflect->invoke(null, Locale::En, ['common', 'nav']));
});

it('cada idioma tiene su propia entrada', function () {
    $reflect = new ReflectionMethod(Dictionary::class, 'fingerprint');

    // Los dos ficheros no se escriben en el mismo instante, así que sus huellas
    // difieren; lo que importa es que el idioma forma parte de la clave y no
    // puede servirse español a quien pidió inglés.
    $en = Dictionary::for(Locale::En, ['marketing']);
    $es = Dictionary::for(Locale::Es, ['marketing']);

    expect($en['common']['appName'] ?? null)->not->toBeNull()
        ->and($es)->not->toBe($en);
});
