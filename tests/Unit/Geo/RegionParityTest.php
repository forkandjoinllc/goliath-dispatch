<?php

declare(strict_types=1);

use App\Support\Geo\Regions;

/*
| La lista de países y estados vive dos veces: en PHP, que valida, y en
| TypeScript, que pinta el desplegable. Está duplicada porque un desplegable no
| puede esperar a una petición al servidor — no porque haya dos verdades.
|
| Esta prueba es lo que hace que la duplicación sea segura. El día que alguien
| añada un estado en un sitio y no en el otro, revienta aquí y no en el
| formulario de un cliente.
*/

/**
 * @return array<string, list<array{code: string, name: string}>>
 */
function regionesDelNavegador(): array
{
    // dirname(__DIR__, 3) y no base_path(): las pruebas de tests/Unit no
    // arrancan la aplicación, así que el contenedor no sabe dónde está la raíz
    // y `base_path()` muere con «Call to undefined method
    // Container::basePath()». Esta comparación no necesita Laravel para nada.
    $ruta = dirname(__DIR__, 3).'/resources/js/lib/regions.ts';

    expect(file_exists($ruta))->toBeTrue('Falta resources/js/lib/regions.ts');

    $fuente = file_get_contents($ruta);

    // Se recorta al bloque SUBDIVISIONS para no confundirlo con COUNTRIES, que
    // tiene la misma forma.
    $inicio = strpos($fuente, 'export const SUBDIVISIONS');
    expect($inicio)->not->toBeFalse();

    $bloque = substr($fuente, (int) $inicio);

    $salida = [];
    $pais = null;

    foreach (preg_split('/\R/', $bloque) ?: [] as $linea) {
        if (preg_match('/^\s{2}([A-Z]{2}):\s*\[/', $linea, $m) === 1) {
            $pais = $m[1];
            $salida[$pais] = [];

            continue;
        }

        if ($pais !== null && preg_match("/code:\s*'([A-Z]{2,3})'\s*,\s*name:\s*'([^']+)'/", $linea, $m) === 1) {
            $salida[$pais][] = ['code' => $m[1], 'name' => $m[2]];
        }
    }

    return $salida;
}

it('el navegador y el servidor tienen los mismos países', function () {
    $fuente = file_get_contents(dirname(__DIR__, 3).'/resources/js/lib/regions.ts');

    // Se corta en el corchete que cierra COUNTRIES. Sin eso el bloque se comería
    // el principio de SUBDIVISIONS y la prueba pasaría contando estados.
    $inicio = (int) strpos($fuente, 'export const COUNTRIES');
    $fin = (int) strpos($fuente, "\n]", $inicio);
    $bloque = substr($fuente, $inicio, $fin - $inicio);

    preg_match_all("/code:\s*'([A-Z]{2})'/", $bloque, $m);

    expect($m[1])->toBe(Regions::countryCodes());
});

it('el navegador y el servidor tienen los mismos estados', function () {
    $navegador = regionesDelNavegador();

    foreach (Regions::countryCodes() as $pais) {
        expect($navegador)->toHaveKey($pais);
        expect($navegador[$pais])->toBe(
            Regions::subdivisions($pais),
            "La lista de {$pais} no coincide entre regions.ts y Regions.php",
        );
    }

    expect(array_keys($navegador))->toHaveCount(count(Regions::countryCodes()));
});

it('trae los tres países del corredor y ninguno más', function () {
    expect(Regions::countryCodes())->toBe(['US', 'MX', 'CA'])
        ->and(Regions::DEFAULT_COUNTRY)->toBe('US');
});

it('los códigos mexicanos son de tres letras', function () {
    // Esto es la razón de que las columnas de estado sean varchar(3). Si alguien
    // las devuelve a varchar(2), esta prueba sigue pasando y la de abajo no.
    $mx = Regions::subdivisionCodes('MX');

    expect($mx)->toContain('NLE', 'CMX', 'JAL')
        ->and(collect($mx)->every(fn (string $c): bool => strlen($c) === 3))->toBeTrue();
});

it('una subdivisión pertenece a un país y solo a uno de los tres', function () {
    expect(Regions::isSubdivisionOf('US', 'TX'))->toBeTrue()
        ->and(Regions::isSubdivisionOf('MX', 'TX'))->toBeFalse()
        ->and(Regions::isSubdivisionOf('CA', 'ON'))->toBeTrue()
        // ON no es de Estados Unidos aunque tenga forma de estado.
        ->and(Regions::isSubdivisionOf('US', 'ON'))->toBeFalse()
        // Vacío vale: la dirección puede estar incompleta.
        ->and(Regions::isSubdivisionOf('US', null))->toBeTrue()
        ->and(Regions::isSubdivisionOf('US', ''))->toBeTrue()
        // Un país que no despachamos no vale ni con un estado real.
        ->and(Regions::isSubdivisionOf('ES', 'MA'))->toBeFalse();
});

it('cuenta lo que debe contar', function () {
    // Cincuenta estados, más el Distrito de Columbia y Puerto Rico.
    expect(Regions::subdivisionCodes('US'))->toHaveCount(52)
        // Diez provincias y tres territorios.
        ->and(Regions::subdivisionCodes('CA'))->toHaveCount(13)
        // Treinta y una entidades federativas más Ciudad de México.
        ->and(Regions::subdivisionCodes('MX'))->toHaveCount(32);
});
