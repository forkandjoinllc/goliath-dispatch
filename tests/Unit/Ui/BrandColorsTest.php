<?php

declare(strict_types=1);

/**
 * Ninguna clase de color puede quedarse sin token detrás.
 *
 * En Tailwind v4 las utilidades de color se generan a partir de las variables
 * del bloque `@theme`. Una clase que pide un escalón que no existe —
 * `bg-danger-600` cuando `danger` solo define 50, 500 y 700— simplemente NO se
 * genera: la clase se queda en el HTML, el navegador la ignora y el elemento se
 * pinta sin ese color. No hay error, ni en compilación ni en consola.
 *
 * Así estuvieron cuatro botones destructivos —rechazar un gasto, anular una
 * factura, disputar un cobro, anular una liquidación— con el fondo rojo pedido
 * y sin fondo ninguno: texto blanco sobre blanco. Lo encontró mirar el CSS
 * compilado, no las 748 pruebas.
 */

/** @return list<string> */
function clasesDeColor(string $raiz): array
{
    $encontradas = [];

    $iterador = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($raiz.'/resources/js'));

    foreach ($iterador as $fichero) {
        if (! in_array($fichero->getExtension(), ['tsx', 'ts'], true)) {
            continue;
        }

        preg_match_all(
            '/\b(?:text|bg|border|ring|from|to|via|fill|stroke|divide|outline|decoration|accent|caret|shadow)-([a-z]+)-(\d{2,3})\b/',
            (string) file_get_contents($fichero->getPathname()),
            $m,
            PREG_SET_ORDER,
        );

        foreach ($m as $coincidencia) {
            $encontradas[] = $coincidencia[1].'-'.$coincidencia[2];
        }
    }

    return array_values(array_unique($encontradas));
}

/** Las familias que define la marca. Lo demás es paleta prestada. */
const FAMILIAS_DE_MARCA = ['navy', 'steel', 'safety', 'danger', 'warning', 'success', 'info'];

it('toda clase de color de la marca tiene su token', function () {
    $raiz = dirname(__DIR__, 3);
    $tokens = (string) file_get_contents($raiz.'/resources/css/tokens.css');
    $usadas = clasesDeColor($raiz);

    expect(count($usadas))->toBeGreaterThan(20);

    $huerfanas = [];

    foreach ($usadas as $clase) {
        [$familia] = explode('-', $clase, 2);

        if (! in_array($familia, FAMILIAS_DE_MARCA, true)) {
            continue;
        }

        if (! str_contains($tokens, "--color-{$clase}:")) {
            $huerfanas[] = $clase;
        }
    }

    sort($huerfanas);

    expect($huerfanas)->toBe([], "Clases de color sin token en tokens.css (se pintan sin color):\n".implode("\n", $huerfanas));
});

it('no se usan las paletas de Tailwind por defecto', function () {
    // La marca tiene sus propias escalas. Mezclar `amber-100` con `warning-100`
    // deja dos amarillos casi iguales decididos por dos sitios distintos, y el
    // día que cambie el de la marca solo cambia la mitad de la interfaz.
    $raiz = dirname(__DIR__, 3);
    $prestadas = [];

    foreach (clasesDeColor($raiz) as $clase) {
        [$familia] = explode('-', $clase, 2);

        if (! in_array($familia, FAMILIAS_DE_MARCA, true)) {
            $prestadas[] = $clase;
        }
    }

    sort($prestadas);

    expect($prestadas)->toBe([], "Paletas ajenas a la marca:\n".implode("\n", $prestadas));
});
