<?php

declare(strict_types=1);

use App\Http\Controllers\App\NotificationController;
use App\Support\Board\Period;
use Carbon\CarbonImmutable;
use Tests\Support\Source;

/**
 * La forma de los dos filtros y del panel de la campana.
 *
 * ## Lo que este lote vino a sujetar
 *
 * **Una pregunta contestada en cuatro sitios.** La lista, las cuentas de las
 * pestañas, el mapa y —a medias— los conductores preguntan por las mismas
 * cargas. Con el filtro escrito en cada una, la que se desviara sería la
 * cuenta de la pestaña: el número que dice «12» encima de tres tarjetas, y
 * quien lo mira concluye que faltan nueve.
 *
 * **Un enlace que pierde el filtro.** Abrir una carga con la pestaña puesta ya
 * devolvía el tablero a «sin asignar» antes de este lote. Con dos filtros más
 * el mismo defecto tiene dos formas nuevas, y la ayuda que los construye es lo
 * que impide que aparezca la tercera.
 *
 * **Un destino guardado en una columna de texto.** `action_url` la escribe la
 * aplicación, y aun así el servidor la comprueba antes de redirigir.
 */
function fuenteDelFiltro(string $ruta): string
{
    return (string) file_get_contents(Source::root().'/'.$ruta);
}

/* ── El periodo se resuelve en un solo sitio ────────────────────────────── */

it('los nueve periodos del desplegable son los que el servidor sabe resolver', function (): void {
    // La lista de la pantalla sale de `Period::CLAVES` por el payload, no
    // escrita a mano en el componente: un desplegable con una opción que el
    // servidor no conoce vuelve a «hoy» sin decir por qué.
    $pantalla = fuenteDelFiltro('resources/js/components/App/Board/Filters.tsx');

    test()->assertStringContainsString('period.options.map', $pantalla);
    test()->assertStringNotContainsString("['today', 'yesterday'", $pantalla);

    expect(Period::CLAVES)->toHaveCount(9);
    expect(Period::CLAVES[0])->toBe(Period::HOY);
});

it('cada periodo tiene su nombre en los dos idiomas', function (): void {
    foreach (['en', 'es'] as $idioma) {
        $dic = json_decode(
            (string) file_get_contents(Source::root().'/lang/'.$idioma.'/board.json'),
            true,
        );

        foreach (Period::CLAVES as $clave) {
            test()->assertArrayHasKey(
                $clave,
                $dic['filters']['periods'] ?? [],
                "Falta el nombre de «{$clave}» en {$idioma}: el desplegable pintaría la clave cruda.",
            );
        }
    }
});

it('el tablero pregunta por los filtros en un solo sitio', function (): void {
    $controlador = fuenteDelFiltro('app/Http/Controllers/App/BoardController.php');

    // `filtradas()` es ese sitio. Que exista no basta: hay que comprobar que
    // NADIE se lo salta llamando a `scoped()` para listar.
    test()->assertStringContainsString('private function filtradas(', $controlador);

    // `scoped()` se usa dentro de `filtradas()` y en la carga que se abre por
    // su enlace —que a propósito no pasa por el filtro—. Tres veces: la
    // declaración, la llamada de `filtradas` y la de `cargaElegida`.
    expect(substr_count($controlador, '$this->scoped('))->toBe(2);
});

it('las cuentas de las pestañas pasan por el mismo filtro que la lista', function (): void {
    $controlador = fuenteDelFiltro('app/Http/Controllers/App/BoardController.php');

    preg_match('/private function cuentas\(.*?\n    \}/s', $controlador, $m);
    expect($m)->not->toBeEmpty();

    test()->assertStringContainsString('$this->filtradas(', $m[0]);
});

it('el mapa dibuja lo mismo que enseña la lista', function (): void {
    // Puntos sin tarjeta: se pulsa uno y no hay dónde ir.
    $controlador = fuenteDelFiltro('app/Http/Controllers/App/BoardController.php');

    preg_match('/private function mapaDe\(.*?\n    \}/s', $controlador, $m);
    expect($m)->not->toBeEmpty();

    test()->assertStringContainsString('$this->filtradas(', $m[0]);
});

/* ── El último día entra entero ─────────────────────────────────────────── */

it('el periodo acaba al final del último día y no a su medianoche', function (): void {
    $ahora = CarbonImmutable::parse('2026-06-15 12:00:00', 'UTC');
    $p = Period::de('today', null, null, 'America/Chicago', $ahora);

    // Con `startOfDay` en el otro extremo, una carga de las cinco de la tarde
    // del último día caía fuera del rango que la nombra.
    expect($p->hastaUtc->setTimezone('America/Chicago')->format('H:i'))->toBe('23:59');
    expect($p->desdeUtc->setTimezone('America/Chicago')->format('H:i'))->toBe('00:00');
});

it('los límites se calculan en el huso de quien mira', function (): void {
    // Las tres de la madrugada UTC del 24 son todavía el 23 en Nueva York, y
    // «hoy» tiene que ser el 23. Resolverlo en UTC daría un «hoy» que empieza
    // a las siete de la tarde del día anterior para quien está en Texas.
    $ahora = CarbonImmutable::parse('2026-09-24 03:00:00', 'UTC');

    expect(Period::de('today', null, null, 'America/New_York', $ahora)->desde)->toBe('2026-09-23');
    expect(Period::de('today', null, null, 'UTC', $ahora)->desde)->toBe('2026-09-24');
});

it('un rango del revés no se arregla por dentro', function (): void {
    $ahora = CarbonImmutable::parse('2026-06-15 12:00:00', 'UTC');
    $p = Period::de('custom', '2026-03-15', '2026-03-01', 'America/Chicago', $ahora);

    // Intercambiarlas en silencio enseñaría un periodo que nadie pidió con el
    // nombre del que sí se pidió.
    expect($p->clave)->toBe(Period::HOY);
});

/* ── Los enlaces del tablero no pierden los filtros ─────────────────────── */

it('la dirección del tablero lleva la pestaña y los dos filtros', function (): void {
    $ayuda = fuenteDelFiltro('resources/js/components/App/Board/href.ts');

    test()->assertStringContainsString('tab: filtros.tab', $ayuda);
    test()->assertStringContainsString('period: filtros.period', $ayuda);
    test()->assertStringContainsString("q.set('carrier', filtros.carrier)", $ayuda);

    // Y las dos fechas SOLO con el periodo a medida: en los demás las calcula
    // el servidor, y mandarlas invitaría a creer que mandan.
    test()->assertStringContainsString("filtros.period === 'custom'", $ayuda);
});

it('ningún enlace del tablero se construye a mano', function (): void {
    foreach ([
        'resources/js/pages/App/Board.tsx',
        'resources/js/components/App/Board/LoadPanel.tsx',
        'resources/js/components/App/Board/DriverPanel.tsx',
        'resources/js/components/App/Board/Timeline.tsx',
    ] as $ruta) {
        // Sin comentarios: el aviso de no construir la dirección a mano
        // CONTIENE la dirección construida a mano, y sin esto el guardián se
        // caía midiendo su propia explicación.
        $fuente = Source::codigo(Source::root().'/'.$ruta);

        test()->assertStringNotContainsString('`/home?tab=', $fuente, $ruta.' construye la dirección a mano.');
        test()->assertStringNotContainsString('href="/home"', $fuente, $ruta.' vuelve al tablero sin nada puesto.');
        test()->assertStringNotContainsString('`/home?load=', $fuente);
        test()->assertStringNotContainsString('`/home?driver=', $fuente);
    }
});

/* ── La campana ─────────────────────────────────────────────────────────── */

it('el destino del aviso lo decide el servidor y no viaja a la pantalla', function (): void {
    $barra = fuenteDelFiltro('resources/js/components/App/Topbar.tsx');

    test()->assertStringContainsString('/open`', $barra);
    test()->assertStringContainsString('method="post"', $barra);
    // La pantalla no ve la dirección: solo si LA HAY.
    test()->assertStringNotContainsString('aviso.actionUrl', $barra);
});

it('el panel reutiliza el menú de la barra y no escribe otro', function (): void {
    // `useMenu` cierra al pulsar fuera, cierra con Escape y devuelve el foco al
    // botón. Un cuarto menú escrito a mano acabaría haciendo dos de las tres.
    $barra = fuenteDelFiltro('resources/js/components/App/Topbar.tsx');

    preg_match('/function NotificationBell\(.*?\n\}/s', $barra, $m);
    expect($m)->not->toBeEmpty();

    test()->assertStringContainsString('useMenu()', $m[0]);
    test()->assertStringNotContainsString("addEventListener('keydown'", $m[0]);
});

it('el «ver todos» está arriba y no escondido al final', function (): void {
    // Es la respuesta al defecto del argumento viejo —«un panel deja al resto
    // detrás de un ver todos que casi nadie pulsa»—, no una excusa para
    // ignorarlo.
    $barra = fuenteDelFiltro('resources/js/components/App/Topbar.tsx');

    preg_match('/function NotificationBell\(.*?\n\}/s', $barra, $m);

    $verTodos = mb_strpos($m[0], 'bell.seeAll');
    $lista = mb_strpos($m[0], 'avisos.map');

    expect($verTodos)->not->toBeFalse();
    expect($lista)->not->toBeFalse();
    expect($verTodos)->toBeLessThan($lista);
});

it('solo se sigue una ruta de dentro', function (): void {
    foreach (['/loads/1', '/documents?expiring=1', '/'] as $buena) {
        expect(NotificationController::destinoDe($buena))->toBe($buena);
    }

    foreach (['//fuera.example/x', 'https://fuera.example', 'javascript:alert(1)', '', null, 'loads/1', '/con espacio', '/con\\barra'] as $mala) {
        expect(NotificationController::destinoDe($mala))->toBeNull();
    }
});
