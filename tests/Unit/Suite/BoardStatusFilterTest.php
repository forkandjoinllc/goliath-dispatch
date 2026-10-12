<?php

declare(strict_types=1);

use App\Enums\DriverStatus;
use App\Support\Board\Statuses;
use App\Support\Board\Tabs;
use Tests\Support\Source;

/**
 * Los dos filtros por estado del tablero.
 *
 * ## Lo que este lote vino a sujetar
 *
 * **Un filtro que no puede encontrar nada.** Las tres pestañas dejan fuera el
 * borrador y lo cancelado. Ofrecerlos en el desplegable daría cero cargas en
 * las tres pestañas sin que nada en la pantalla explique por qué.
 *
 * **Una columna que se vacía sola.** El tablero enseñaba también a los dados
 * de baja y a los inactivos en la columna que contesta «¿a quién se la doy?».
 * Al dejarlos fuera por defecto hay dos maneras nuevas de equivocarse: que un
 * estado nuevo caiga fuera del reparto sin que nadie lo decida, y que la
 * columna se quede en blanco porque alguien tecleó mal la URL.
 *
 * **Una pregunta contestada en cuatro sitios.** Ya pasaba con el periodo y el
 * transportista; con el estado son seis, contando las tres cuentas.
 */
function fuenteDelEstado(string $ruta): string
{
    return Source::codigo(Source::root().'/'.$ruta);
}

/* ── Solo se ofrece lo que se puede enseñar ─────────────────────────────── */

it('el filtro de cargas no ofrece lo que ninguna pestaña enseña', function (): void {
    // Elegir «Cancelada» daría cero en las tres pestañas, y no habría nada en
    // la pantalla que lo explicara.
    foreach (Tabs::fuera() as $fuera) {
        expect(Statuses::deCarga())->not->toContain($fuera);
    }

    // Y lo que sí enseñan las pestañas está entero: un estado que faltara del
    // filtro escondería sus cargas en cuanto alguien tocara el desplegable.
    expect(Statuses::deCarga())->toContain('available', 'in_transit', 'delivered', 'paid');
});

it('la lista de estados de carga se calcula restando', function (): void {
    /*
    | Escrita a mano, el día que se añada un estado el filtro no lo ofrecería
    | —y sus cargas desaparecerían del tablero al filtrar—, y el día que uno
    | salga de las pestañas el filtro lo seguiría ofreciendo para nada.
    */
    $soporte = fuenteDelEstado('app/Support/Board/Statuses.php');

    test()->assertStringContainsString('array_diff(', $soporte);
    test()->assertStringContainsString('Tabs::fuera()', $soporte);
    test()->assertStringContainsString('LoadStatus::cases()', $soporte);
});

/* ── El reparto por defecto de los conductores ──────────────────────────── */

it('por defecto no salen ni los dados de baja ni los inactivos', function (): void {
    expect(Statuses::porDefectoDeConductor())
        ->not->toContain('terminated')
        ->not->toContain('inactive')
        ->toContain('available', 'on_load', 'off_duty', 'on_hold');
});

it('el reparto por defecto se escribe al revés, por quién NO trabaja', function (): void {
    /*
    | Escrito al derecho —una lista de «los que sí»— un estado nuevo quedaría
    | fuera del reparto por defecto y esos conductores desaparecerían del
    | tablero sin que nadie lo hubiera decidido. Al revés, un estado nuevo
    | entra solo: ese es el error que se puede ver.
    |
    | Se mide sobre la propiedad y no sobre la constante: lo que importa es que
    | TODO estado que no esté declarado como «no trabaja» entre en el reparto.
    */
    $declarados = Statuses::NO_TRABAJAN;
    $esperado = array_values(array_diff(DriverStatus::values(), $declarados));

    expect(Statuses::porDefectoDeConductor())->toBe(array_values(array_intersect(
        Statuses::deConductor(),
        $esperado,
    )));
});

it('ningún estado de conductor se cae del filtro', function (): void {
    // El orden lo escribe la clase —el de la jornada, el mismo que la
    // pantalla—, pero lo que no esté escrito va al final en vez de caerse.
    foreach (DriverStatus::values() as $estado) {
        expect(Statuses::deConductor())->toContain($estado);
    }

    expect(Statuses::deConductor())->toHaveCount(count(DriverStatus::values()));
    expect(Statuses::deConductor()[0])->toBe('available');
});

it('la pantalla y el servidor ordenan los estados igual', function (): void {
    // Dos órdenes distintos para la misma lista se notan al leerla dos veces
    // seguidas.
    $componente = fuenteDelEstado('resources/js/components/App/DriverStatus.tsx');

    preg_match('/ESTADOS_DE_CONDUCTOR = \[(.*?)\]/s', $componente, $m);
    expect($m)->not->toBeEmpty();

    preg_match_all("/'([a-z_]+)'/", $m[1], $enPantalla);

    expect($enPantalla[1])->toBe(Statuses::CONDUCTOR);
});

/* ── Lo que llega por la URL ────────────────────────────────────────────── */

it('vacío quiere decir todos y no ninguno', function (): void {
    expect(Statuses::deCargaElegidos(null))->toBe([]);
    expect(Statuses::deCargaElegidos(''))->toBe([]);

    // Y en el controlador, una lista vacía no se convierte en `whereIn([])`,
    // que devuelve cero filas: el tablero se quedaría en blanco la primera vez
    // que alguien lo abre sin tocar nada.
    $controlador = fuenteDelEstado('app/Http/Controllers/App/BoardController.php');

    test()->assertStringContainsString(
        "return \$estados === [] ? \$query : \$query->whereIn('loads.status', \$estados);",
        $controlador,
    );
});

it('la basura de la URL no vacía la columna de conductores', function (): void {
    // Una columna vacía porque alguien tecleó mal la dirección no es un
    // filtro: es una pantalla rota.
    foreach ([null, '', 'inventado', 'terminado,disponible', ','] as $crudo) {
        expect(Statuses::deConductorElegidos($crudo))->toBe(Statuses::porDefectoDeConductor());
    }
});

it('lo que no existe se descarta y lo que existe se queda', function (): void {
    expect(Statuses::deCargaElegidos('in_transit,inventado,cancelled'))->toBe(['in_transit']);
    expect(Statuses::deConductorElegidos('terminated,inventado'))->toBe(['terminated']);
});

it('la URL no decide el orden', function (): void {
    // Dos direcciones con los mismos estados tienen que ser la misma
    // dirección: si no, el botón de atrás y el enlace pegado en un mensaje
    // llevan a dos sitios que se ven igual.
    expect(Statuses::deCargaElegidos('delivered,available'))
        ->toBe(Statuses::deCargaElegidos('available,delivered'));

    expect(Statuses::deCargaElegidos('delivered,available')[0])->toBe('available');
});

/* ── Una pregunta, un sitio ─────────────────────────────────────────────── */

it('la lista, las cuentas y el mapa filtran por los mismos estados', function (): void {
    /*
    | Este guardián nació midiendo lo de al lado.
    |
    | Buscaba `$estados` dentro de cada método, y los tres lo declaran en su
    | FIRMA: quitarlo de la llamada a `filtradas()` —que es el defecto— dejaba
    | la palabra en el texto y el guardián en verde. Lo que hay que medir es la
    | LLAMADA, que es donde el filtro se aplica o se pierde.
    */
    $controlador = fuenteDelEstado('app/Http/Controllers/App/BoardController.php');

    foreach (['cargas', 'cuentas', 'mapaDe'] as $metodo) {
        preg_match('/private function '.$metodo.'\(.*?\n    \}/s', $controlador, $m);
        expect($m)->not->toBeEmpty("No se encontró `{$metodo}()`.");

        test()->assertStringContainsString(
            '$periodo, $transportista, $estados)',
            $m[0],
            "`{$metodo}()` llama a `filtradas()` sin los estados: su respuesta se desviaría de la de los otros dos.",
        );
    }
});

it('lo que se esconde se cuenta con el mismo alcance que lo que se enseña', function (): void {
    // Contar sobre la empresa entera daría un número que no cuadra con nada de
    // lo que se está mirando.
    $controlador = fuenteDelEstado('app/Http/Controllers/App/BoardController.php');

    preg_match('/private function conductoresEscondidos\(.*?\n    \}/s', $controlador, $m);
    expect($m)->not->toBeEmpty();

    test()->assertStringContainsString('DriverScope::apply(', $m[0]);
    test()->assertStringContainsString('$this->deEseTransportista(', $m[0]);
    test()->assertStringContainsString("whereNotIn('drivers.status', \$estados)", $m[0]);
});

/* ── Lo que la pantalla promete ─────────────────────────────────────────── */

it('el enlace del tablero conserva los dos filtros nuevos', function (): void {
    $ayuda = fuenteDelEstado('resources/js/components/App/Board/href.ts');

    test()->assertStringContainsString("q.set('status', filtros.status.join(','))", $ayuda);
    test()->assertStringContainsString("q.set('driverStatus', filtros.driverStatus.join(','))", $ayuda);
});

it('cada control manda los cuatro filtros y no solo el suyo', function (): void {
    /*
    | Con dos filtros había dos ayudas —«el periodo que ya está puesto» y «el
    | transportista que ya está puesto»— para que tocar uno no borrara el otro.
    | Con cuatro harían falta doce, y la que faltara sería la que borra un
    | filtro al tocar otro.
    */
    $pantalla = fuenteDelEstado('resources/js/components/App/Board/Filters.tsx');

    test()->assertStringContainsString('const todos = ()', $pantalla);
    test()->assertStringContainsString("router.get('/home', { tab, ...todos(), ...params }", $pantalla);

    // Y las dos ayudas viejas no vuelven.
    test()->assertStringNotContainsString('function periodoEn(', $pantalla);
    test()->assertStringNotContainsString('function transportistaEn(', $pantalla);
});

it('las opciones del desplegable vienen del servidor', function (): void {
    // Escritas en el componente, el día que se añada un estado el filtro no lo
    // ofrecería y sus cargas desaparecerían al filtrar.
    $pantalla = fuenteDelEstado('resources/js/components/App/Board/Filters.tsx');

    test()->assertStringContainsString('filtro.options.map(', $pantalla);
    test()->assertStringNotContainsString("'in_transit'", $pantalla);
    test()->assertStringNotContainsString("'on_load'", $pantalla);
});

it('cada diccionario se lee con su convención', function (): void {
    /*
    | `nav.status.load` escribe `enRouteToPickup` y `drivers.status` escribe
    | `on_load`. No es un descuido: `UnnamedValuesTest` lleva declarado cuál es
    | cuál. Convertir siempre a camello pintaba la clave cruda en los seis
    | estados de conductor.
    */
    $pantalla = fuenteDelEstado('resources/js/components/App/Board/Filters.tsx');

    test()->assertStringContainsString('enCamello ? camello(estado) : estado', $pantalla);
    test()->assertStringContainsString('prefijo="drivers.status"', $pantalla);
});

it('el menú de los estados no escribe su propio cierre', function (): void {
    /*
    | `useMenu` cierra al pulsar fuera, cierra con Escape y devuelve el foco al
    | botón. Su propio comentario avisaba de que «un cuarto menú escrito a mano
    | acabaría haciendo dos de las tres» — y este es el cuarto, así que el
    | gancho salió de la barra superior a `lib/useMenu`.
    */
    $pantalla = fuenteDelEstado('resources/js/components/App/Board/Filters.tsx');
    $barra = fuenteDelEstado('resources/js/components/App/Topbar.tsx');

    test()->assertStringContainsString('useMenu()', $pantalla);
    test()->assertStringNotContainsString("addEventListener('keydown'", $pantalla);

    // Y la barra lo usa del sitio común en vez de tener su copia.
    test()->assertStringContainsString("from '@/lib/useMenu'", $barra);
    test()->assertStringNotContainsString('function useMenu()', $barra);
});

it('la pantalla dice cuántos conductores esconde', function (): void {
    // Un conductor que falta de una lista sin explicación se busca durante un
    // rato. Es la misma razón por la que el alta dice cuántos camiones no
    // ofrece.
    $pantalla = fuenteDelEstado('resources/js/components/App/Board/Filters.tsx');

    test()->assertStringContainsString('board.filters.driversHidden', $pantalla);
});

it('cada estado del filtro tiene nombre en los dos idiomas', function (): void {
    foreach (['en', 'es'] as $idioma) {
        $nav = json_decode((string) file_get_contents(Source::root()."/lang/{$idioma}/nav.json"), true);
        $cond = json_decode((string) file_get_contents(Source::root()."/lang/{$idioma}/drivers.json"), true);

        foreach (Statuses::deCarga() as $estado) {
            $clave = lcfirst(str_replace(' ', '', ucwords(str_replace('_', ' ', $estado))));

            test()->assertArrayHasKey(
                $clave,
                $nav['status']['load'] ?? [],
                "Falta «{$estado}» en nav.status.load de {$idioma}: el desplegable pintaría la clave cruda.",
            );
        }

        foreach (Statuses::deConductor() as $estado) {
            test()->assertArrayHasKey(
                $estado,
                $cond['status'] ?? [],
                "Falta «{$estado}» en drivers.status de {$idioma}.",
            );
        }
    }
});

it('cada rótulo que pide la barra de filtros existe en los dos idiomas', function (): void {
    /*
    | El botón del filtro de conductores leía `board.filters.defaultDriverStatuses`
    | —la clave cruda, con sus puntos— porque el diccionario la llamaba
    | `workingDrivers`. La suite entera pasaba: ninguna prueba mira qué rótulos
    | PIDE un componente, solo qué rótulos existen.
    |
    | Lo encontró el paseo por el navegador, que es demasiado tarde para algo
    | que se ve en la primera pantalla.
    */
    $pantalla = fuenteDelEstado('resources/js/components/App/Board/Filters.tsx');

    preg_match_all("/t\('board\\.filters\\.([a-zA-Z]+)'/", $pantalla, $m);
    expect($m[1])->not->toBeEmpty();

    // Los que se piden con `n`: el diccionario necesita además su hermano
    // singular, o se lee «1 estados».
    preg_match_all("/t\('board\\.filters\\.([a-zA-Z]+)', \{ n:/", $pantalla, $plurales);

    $pedidos = array_unique([
        ...$m[1],
        ...array_map(static fn (string $c): string => $c.'One', $plurales[1]),
    ]);

    foreach (['en', 'es'] as $idioma) {
        $dic = json_decode(
            (string) file_get_contents(Source::root()."/lang/{$idioma}/board.json"),
            true,
        );

        foreach ($pedidos as $clave) {
            test()->assertArrayHasKey(
                $clave,
                $dic['filters'] ?? [],
                "La barra de filtros pide «board.filters.{$clave}» y {$idioma} no lo tiene: la pantalla pintaría la clave cruda.",
            );
        }
    }
});
