<?php

declare(strict_types=1);

use App\Support\Board\Tabs;
use Tests\Support\Source;

/**
 * Lo que el tablero de despacho AFIRMA en pantalla.
 *
 * Tres columnas, un mapa que se refresca solo y una lista con pestañas. Cada
 * una de esas cosas es una promesa, y las promesas de una pantalla que se mira
 * todo el día se cobran caras: si el mapa deja de refrescarse, nadie lo nota —
 * sigue enseñando camiones, solo que los de hace tres horas.
 */
function fuenteDelTablero(string $ruta): string
{
    return (string) file_get_contents(Source::root().'/'.$ruta);
}

it('las tres pestañas no se pisan ni dejan huecos', function (): void {
    // Una partición: lo terminado y lo que queda fuera no pueden compartir ni
    // un estado, o una carga se contaría dos veces.
    $comunes = array_intersect(Tabs::terminados(), Tabs::fuera());

    expect($comunes)->toBe([]);
    expect(Tabs::TODAS)->toHaveCount(3);

    foreach (Tabs::TODAS as $pestana) {
        expect(Tabs::valida($pestana))->toBeTrue();
    }

    expect(Tabs::valida('cualquiera'))->toBeFalse();
});

it('«sin asignar» mira el conductor, no el estado de la carga', function (): void {
    // Una carga despachada a la que alguien le quitó el conductor sigue sin
    // asignar, y es justo la que hay que ver primero.
    $codigo = Source::sinComentarios(
        Source::root().'/app/Http/Controllers/App/BoardController.php',
    );

    test()->assertStringContainsString("whereNotNull('la.driver_id')", $codigo);
    test()->assertStringContainsString('whereNotExists($conConductor)', $codigo);
});

it('el mapa se refresca solo, cada minuto', function (): void {
    $pantalla = fuenteDelTablero('resources/js/pages/App/Board.tsx');

    test()->assertStringContainsString('const CADA = 60_000', $pantalla);
    test()->assertStringContainsString('setInterval', $pantalla);
    // Y vuelve SOLO lo que cambia: una recarga entera cada minuto devolvería
    // también el armazón y el menú.
    test()->assertStringContainsString(
        "only: ['loads', 'drivers', 'map', 'counts', 'refreshedAt']",
        $pantalla,
    );
});

it('el PIN dice si es recogida o entrega, y el color los separa', function (): void {
    $mapa = fuenteDelTablero('resources/js/components/App/Board/BoardMap.tsx');

    // La letra dentro de la gota, en las dos mitades del mapa.
    expect(substr_count($mapa, "parada.type === 'pickup' ? 'P' : 'D'"))->toBe(2);

    $pines = fuenteDelTablero('resources/js/components/App/Board/pins.ts');

    // Colores distintos, y salidos de los tokens de marca.
    test()->assertStringContainsString("token('--color-safety-600'", $pines);
    test()->assertStringContainsString("token('--color-navy-700'", $pines);
});

it('el icono del camión sale del tipo de remolque', function (): void {
    // En un mapa con treinta puntos el dibujo se lee antes que el texto, y lo
    // que distingue a un conjunto de otro en la calle es el remolque.
    $pines = fuenteDelTablero('resources/js/components/App/Board/pins.ts');

    foreach (['flatbed', 'step_deck', 'double_drop', 'rgn', 'lowboy', 'conestoga', 'dry_van'] as $tipo) {
        test()->assertStringContainsString(
            $tipo.':',
            $pines,
            "El tipo de remolque `{$tipo}` se quedó sin silueta.",
        );
    }

    // Y el que no esté no se queda sin dibujo: el conjunto existe aunque no
    // sepamos de qué tipo es.
    test()->assertStringContainsString('SILUETA_GENERICA', $pines);
});

it('las dos mitades del mapa dibujan lo mismo', function (): void {
    // Con clave y sin ella. Si cada mitad dibujara lo suyo, la instalación sin
    // clave enseñaría un mapa que no se parece al de producción y nadie lo
    // notaría hasta llegar allí.
    $mapa = fuenteDelTablero('resources/js/components/App/Board/BoardMap.tsx');

    // Las dos formas de usar el MISMO dibujo: `d={...}` en el SVG de fondo
    // liso y `path: ...` en el marcador de Google. Contar el nombre a secas no
    // valía: con el import ya salían dos, y un sabotaje que cambiaba el de
    // Google por otra figura dejaba el guardián en verde.
    test()->assertStringContainsString('d={GOTA}', $mapa);
    test()->assertStringContainsString('path: GOTA,', $mapa);
    test()->assertStringContainsString('d={siluetaDe(unidad.trailerType)}', $mapa);
    test()->assertStringContainsString('path: siluetaDe(unidad.trailerType),', $mapa);
    test()->assertStringContainsString('fill={colorParada(parada.type)}', $mapa);
    test()->assertStringContainsString('fillColor: colorParada(parada.type),', $mapa);
});

it('el mapa sin teselas dice que no las tiene', function (): void {
    // Un rectángulo gris sin explicación se lee como «esto está cargando» o
    // «esto está roto».
    $mapa = fuenteDelTablero('resources/js/components/App/Board/BoardMap.tsx');

    test()->assertStringContainsString('board.map.noTiles', $mapa);
    test()->assertStringContainsString('board.map.noTilesHint', $mapa);

    // Y el zoom funciona igual sin ellas: prometer zoom y no darlo sería peor
    // que no prometerlo.
    test()->assertStringContainsString('board.map.zoomIn', $mapa);
    test()->assertStringContainsString('board.map.zoomOut', $mapa);
});

it('las cargas sin posición se cuentan y se explican', function (): void {
    // Colocar el camión donde estuvo ayer sería peor que no colocarlo.
    $mapa = fuenteDelTablero('resources/js/components/App/Board/BoardMap.tsx');

    test()->assertStringContainsString('withoutSignal', $mapa);
    test()->assertStringContainsString('board.map.withoutSignalHint', $mapa);

    foreach (['es', 'en'] as $idioma) {
        $d = json_decode(
            (string) file_get_contents(Source::root()."/lang/{$idioma}/board.json"),
            true,
            512,
            JSON_THROW_ON_ERROR,
        );

        // Con su hermana en singular: «1 cargas» es lo primero que hace
        // parecer barato un producto que se vende en dos idiomas.
        expect($d['map']['withoutSignalOne'] ?? null)->toBeString();
    }
});

it('la columna de conductores dice el estado con las palabras de su ficha', function (): void {
    // Un segundo juego de nombres para los mismos cuatro estados acabaría
    // diciendo otra cosa que la ficha del conductor.
    $pantalla = fuenteDelTablero('resources/js/pages/App/Board.tsx');

    test()->assertStringContainsString('drivers.status.${conductor.status}', $pantalla);
    test()->assertStringNotContainsString('board.drivers.status', $pantalla);

    // Y el teléfono se marca: el tablero se mira desde el móvil.
    test()->assertStringContainsString('href={`tel:', $pantalla);
});

it('el tablero dice de qué es la fecha', function (): void {
    // Una fecha suelta obliga a adivinar si es la recogida o la entrega.
    $pantalla = fuenteDelTablero('resources/js/pages/App/Board.tsx');

    test()->assertStringContainsString('board.stop.${carga.nextStop.type}', $pantalla);

    foreach (['es', 'en'] as $idioma) {
        $d = json_decode(
            (string) file_get_contents(Source::root()."/lang/{$idioma}/board.json"),
            true,
            512,
            JSON_THROW_ON_ERROR,
        );

        expect($d['stop']['pickup'] ?? null)->toBeString();
        expect($d['stop']['delivery'] ?? null)->toBeString();
    }
});

it('la hora es la del muelle, resuelta en el servidor', function (): void {
    // Una recogida a las 02:00 en Laredo pintada con el reloj de quien mira
    // sale con la fecha del día anterior. `LoadClock` existe por eso.
    $codigo = Source::sinComentarios(
        Source::root().'/app/Http/Controllers/App/BoardController.php',
    );

    // En LOS DOS sitios que mandan una hora de parada: la tarjeta de la carga
    // y el punto del mapa. Comprobar que aparece «alguna vez» dejaba pasar un
    // sabotaje que solo tocaba uno.
    expect(substr_count($codigo, 'LoadClock::previsto('))->toBe(2);
});
