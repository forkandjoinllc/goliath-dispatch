<?php

declare(strict_types=1);

use App\Support\Customers\NameKey;

/*
| Sin base de datos y sin aplicación: NameKey es una función pura. Si algún día
| necesitara arrancar Laravel para responder, eso sería el fallo que hay que ver.
|
| ADVERTENCIA: estas pruebas no se han ejecutado (ver CarrierAccessTest). Los
| valores esperados sí se comprobaron llamando a NameKey a mano.
*/

it('funde la misma empresa escrita de formas distintas', function (string $a, string $b) {
    expect(NameKey::for($a))->toBe(NameKey::for($b));
})->with([
    'sufijo societario mexicano' => ['Aceros Delgado S.A. de C.V.', 'aceros delgado'],
    'acentos' => ['Aceros Delgádo', 'Aceros Delgado'],
    'sufijo LLC' => ['Harborworks Marine Fabrication LLC', 'Harborworks Marine Fabrication'],
    'sufijo Inc con punto' => ['Great Lakes Wind Components Inc.', 'Great Lakes Wind Components'],
    'sufijo Co' => ['Permian Basin Equipment Co.', 'permian basin equipment'],
    'S. de R.L.' => ['Transportes Cordillera S. de R.L.', 'Transportes Cordillera'],
    'espacios y puntuación' => ['  Cactus,  Freight   Systems  ', 'Cactus Freight Systems'],
]);

it('NO funde empresas que solo comparten palabras', function (string $a, string $b) {
    expect(NameKey::for($a))->not->toBe(NameKey::for($b));
})->with([
    // El caso que obliga a quitar el sufijo solo AL FINAL. Quitándolo en
    // cualquier posición, «Company Cold Storage» perdería su primera palabra y
    // se fundiría con una empresa distinta.
    'sufijo al principio no es sufijo' => ['Company Cold Storage', 'Cold Storage'],
    'nombres parecidos pero distintos' => ['Permian Basin Equipment', 'Permian Basin Rentals'],
    'no confunde ciudades' => ['Laredo Freight', 'El Paso Freight'],
]);

it('quita varios sufijos encadenados', function () {
    // «Transport Group LLC Inc» existe en los registros reales.
    expect(NameKey::for('Transport Group LLC Inc'))->toBe('transport group');
});

it('devuelve cadena vacía para un nombre sin letras ni números', function () {
    // No es un caso hipotético: alguien pega «---» en el formulario. Lo que
    // importa es que no reviente; la validación de longitud es otra capa.
    expect(NameKey::for('—— ...'))->toBe('');
});

it('es idempotente: normalizar lo ya normalizado no lo cambia', function (string $name) {
    $once = NameKey::for($name);
    expect(NameKey::for($once))->toBe($once);
})->with([
    'Aceros Delgado S.A. de C.V.',
    'Great Lakes Wind Components Inc.',
    'Cactus Freight Systems LLC',
]);
