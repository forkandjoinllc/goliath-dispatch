<?php

declare(strict_types=1);

use App\Enums\LoadStatus;
use App\Http\Controllers\App\BoardController;
use App\Support\Loads\Transitions;
use Tests\Support\Source;

/**
 * Los paneles del tablero: lo que abren, lo que ofrecen y lo que devuelven.
 *
 * ## Las tres formas que este lote vino a sujetar
 *
 * **Una acción escrita con dos nombres.** `cancelled` es el último segmento de
 * la URL y la clave que mira `Transitions`. Estuvo escrito «cancel» en el
 * tablero, y `allowedFrom` contestaba que no —sin equivocarse: no hay ninguna
 * arista con ese nombre— así que el menú no enseñaba nunca la opción, para
 * todo el mundo, sin un solo error en ningún sitio.
 *
 * **Un guardado que no es un parche.** `PATCH /loads/{id}` reemplaza: escribe
 * cada columna con lo que le llegue y sustituye las paradas por las que
 * recibe. Una ventana de edición que mandara solo lo que enseña dejaría la
 * carga sin PO, sin peso, sin millas y con las paradas reducidas a dos, sin
 * contactos ni código postal, diciendo «guardado».
 *
 * **Un menú que ofrece lo que el servidor rechaza.** Las tres acciones se
 * deciden en el servidor, en `can`, y no en la pantalla.
 *
 * La cronología y los permisos de verdad los prueban las pruebas de
 * funcionalidad; esto sujeta la FORMA, que es lo que se rompe al refactorizar.
 */
function fuenteDelPanel(string $ruta): string
{
    return (string) file_get_contents(Source::root().'/'.$ruta);
}

/**
 * La misma fuente SIN comentarios.
 *
 * Un guardián que busca una cadena prohibida en el fichero entero la encuentra
 * en el comentario que explica por qué está prohibida, y se cae solo. Pasó aquí
 * con `bg-${`: el aviso de no construir clases al vuelo contenía el trozo que
 * el guardián buscaba, así que medía el comentario en vez del código.
 */
/**
 * El cuerpo de UN método, y no el fichero desde su nombre hasta el final.
 *
 * Un molde con `.*?` desde el nombre del método sigue buscando en los métodos
 * de debajo, y encuentra en el vecino lo que falta en este. Es la forma más
 * discreta de guardián inútil: verde porque mide otra cosa.
 */
function metodoDelPanel(string $ruta, string $metodo): string
{
    preg_match(
        '/function '.preg_quote($metodo, '/').'\\(.*?\\n    \\}/s',
        fuenteDelPanel($ruta),
        $m,
    );

    expect($m)->not->toBeEmpty();

    return $m[0];
}

function codigoDelPanel(string $ruta): string
{
    $fuente = fuenteDelPanel($ruta);
    $fuente = (string) preg_replace('#/\*.*?\*/#s', '', $fuente);

    return (string) preg_replace('#^\s*//.*$#m', '', $fuente);
}

/* ── Cancelar se escribe una sola vez ───────────────────────────────────── */

it('la palabra de cancelar es una sola y es la de la ruta', function (): void {
    // Una arista de verdad: si alguien renombra la acción, esto se cae aquí y
    // no en el menú de un despachador un martes.
    expect(Transitions::allowedFrom(BoardController::CANCELAR, LoadStatus::Available))
        ->toBeTrue();

    // Y la pantalla publica en ESA palabra, no en otra parecida.
    $panel = fuenteDelPanel('resources/js/components/App/Board/LoadPanel.tsx');

    test()->assertStringContainsString(
        '/status/'.BoardController::CANCELAR.'`',
        $panel,
        'El panel tiene que publicar en la misma acción que comprueba el servidor.',
    );
});

it('el tablero no comprueba la cancelación con una palabra suya', function (): void {
    $controlador = fuenteDelPanel('app/Http/Controllers/App/BoardController.php');

    // La comprobación pasa por la constante. Un literal suelto es cómo volvió
    // a aparecer «cancel» la primera vez.
    test()->assertStringContainsString('Transitions::allowedFrom(self::CANCELAR', $controlador);
    test()->assertStringNotContainsString("allowedFrom('cancel'", $controlador);
});

/* ── La edición devuelve la carga entera ────────────────────────────────── */

it('el formulario de edición lleva todas las columnas que el guardado pisa', function (): void {
    $controlador = fuenteDelPanel('app/Http/Controllers/App/BoardController.php');

    // Las que `LoadController::loadColumns` escribe con `?? null` dentro del
    // bloque de mercancía: lo que no vuelva se pierde en silencio.
    foreach ([
        'customer_id', 'customer_reference', 'po_number', 'commodity', 'weight_pounds',
        'piece_count', 'length_inches', 'width_inches', 'height_inches',
        'required_equipment_type_id', 'is_oversize', 'is_overweight', 'miles',
        'deadhead_miles', 'special_instructions', 'internal_notes',
    ] as $columna) {
        // La columna tiene que salir DE SÍ MISMA, no de cualquier sitio: el
        // molde exige `$carga->{columna}` en la misma línea. Da igual lo que
        // haya entre medias —una conversión, un ternario para el nulo— pero no
        // vale mandar el peso en el hueco de las millas.
        test()->assertMatchesRegularExpression(
            '/\''.$columna.'\' => [^\n]*\$carga->'.$columna.'/',
            $controlador,
            "La ventana de edición no devuelve `{$columna}`, así que guardarla la borraría.",
        );
    }
});

it('las paradas de la edición llevan todo lo que syncStops escribe', function (): void {
    $controlador = fuenteDelPanel('app/Http/Controllers/App/BoardController.php');
    $cargas = fuenteDelPanel('app/Http/Controllers/App/LoadController.php');

    // Se leen las columnas DEL OTRO LADO, no una lista copiada aquí: una lista
    // copiada envejece sola en cuanto `syncStops` gane una columna.
    preg_match('/private function syncStops\(.*?\n    \}/s', $cargas, $m);
    expect($m)->not->toBeEmpty();

    preg_match_all("/'([a-z_]+)' => \\\$stop\['/", $m[0], $encontradas);
    $columnas = array_unique($encontradas[1]);

    expect($columnas)->not->toBeEmpty();

    foreach ($columnas as $columna) {
        test()->assertMatchesRegularExpression(
            '/\''.$columna.'\' => [^\n]*\$s->'.$columna.'/',
            $controlador,
            "`syncStops` escribe `{$columna}` y la ventana de edición no lo devuelve: guardar lo borraría.",
        );
    }
});

it('el rótulo del sitio no viaja de vuelta como si fuera un campo', function (): void {
    // `locationName` es para enseñar. Mandarlo metería en el array que recorre
    // `syncStops` una clave que ninguna regla valida.
    $panel = fuenteDelPanel('resources/js/components/App/Board/LoadPanel.tsx');

    test()->assertStringContainsString('locationName: _', $panel);
    test()->assertStringContainsString('transform(', $panel);
});

it('la parada vuelve con su id o el guardado crearía copias', function (): void {
    // DENTRO del método y no «en algún sitio después de su nombre»: el molde
    // con `.*?` seguía encontrando el `'id' => (string) $s->id` de
    // `paradasDe`, que es el vecino de abajo y no tiene nada que ver. Es un
    // guardián que se queda verde midiendo la casa de al lado.
    $cuerpo = metodoDelPanel(
        'app/Http/Controllers/App/BoardController.php',
        'paradasParaEditar',
    );

    // Sin `id`, `syncStops` no reconoce la parada: borra la de verdad y crea
    // una nueva, y con ella se van las horas de llegada y las detenciones.
    test()->assertStringContainsString("'id' => (string) \$s->id", $cuerpo);
});

/* ── El menú no ofrece lo que el servidor rechaza ───────────────────────── */

it('las tres acciones las decide el servidor', function (): void {
    $controlador = fuenteDelPanel('app/Http/Controllers/App/BoardController.php');

    foreach (['update', 'assign', 'cancel'] as $accion) {
        test()->assertStringContainsString("'".$accion."' => ", $controlador);
    }

    // Y la pantalla solo las lee. Un permiso recalculado en el navegador es un
    // permiso que se puede cambiar desde la consola del navegador.
    $panel = fuenteDelPanel('resources/js/components/App/Board/LoadPanel.tsx');

    // DOS veces cada uno, y las dos hacen falta: una cierra el menú entero
    // cuando no hay ninguna acción, y la otra guarda su propia entrada.
    // Comprobar solo que la palabra aparece dejaba pasar quitarle la guarda a
    // la entrada, porque la del menú entero seguía nombrándola.
    foreach (['update', 'assign', 'cancel'] as $accion) {
        test()->assertSame(
            2,
            substr_count($panel, 'carga.can.'.$accion),
            "La entrada «{$accion}» del menú tiene que mirar su propio permiso, no solo el del menú entero.",
        );
    }
});

it('reasignar lleva a la ficha y no abre una lista sin comprobar', function (): void {
    // Asignar de verdad mira licencias, tarjetas médicas, inspecciones y
    // solapes, y los enseña uno a uno. Una ventanita con nombres ofrecería
    // conductores que el servidor va a rechazar.
    $panel = fuenteDelPanel('resources/js/components/App/Board/LoadPanel.tsx');

    test()->assertStringContainsString('#assign', $panel);
});

/* ── La ventana modal deja salir ────────────────────────────────────────── */

it('la ventana atrapa el foco, lo devuelve y cierra con Escape', function (): void {
    $modal = fuenteDelPanel('resources/js/components/App/Modal.tsx');

    // Las cuatro, porque las cuatro juntas son lo que hace que una caja con
    // sombra sea una ventana y no una trampa para quien usa el teclado.
    test()->assertStringContainsString("e.key === 'Escape'", $modal);
    test()->assertStringContainsString("e.key !== 'Tab'", $modal);
    test()->assertStringContainsString('devolverA.current?.focus()', $modal);
    test()->assertStringContainsString('aria-modal="true"', $modal);
});

/* ── La selección viaja en la URL ───────────────────────────────────────── */

it('abrir una carga o un conductor cambia la URL y conserva la pestaña', function (): void {
    $tablero = fuenteDelPanel('resources/js/pages/App/Board.tsx');

    // Sin esto la selección vive en el estado del componente: el enlace no se
    // puede pegar, el botón de atrás no cierra nada y el refresco de cada
    // minuto la pierde.
    test()->assertStringContainsString('boardHref(tab, { load: carga.id })', $tablero);
    test()->assertStringContainsString('boardHref(tab, { driver: conductor.id })', $tablero);

    // Y la pestaña va en TODOS: es lo que evita que cerrar el panel devuelva
    // el tablero a «sin asignar» desde cualquier otra pestaña.
    $ayuda = fuenteDelPanel('resources/js/components/App/Board/href.ts');
    test()->assertStringContainsString('new URLSearchParams({ tab })', $ayuda);

    foreach ([
        'resources/js/components/App/Board/LoadPanel.tsx',
        'resources/js/components/App/Board/DriverPanel.tsx',
        'resources/js/components/App/Board/Timeline.tsx',
    ] as $ruta) {
        $fuente = fuenteDelPanel($ruta);

        test()->assertStringNotContainsString(
            'href="/home"',
            $fuente,
            "{$ruta} vuelve al tablero sin la pestaña: cerrar el panel cambiaría la lista de debajo.",
        );
        test()->assertStringNotContainsString('`/home?load=', $fuente);
        test()->assertStringNotContainsString('`/home?driver=', $fuente);
    }
});

/* ── Las altas rápidas van por las puertas de siempre ───────────────────── */

it('el alta rápida usa las dos rutas de siempre y no una tercera', function (): void {
    $rapida = fuenteDelPanel('resources/js/components/App/Board/QuickAdd.tsx');

    test()->assertStringContainsString("post('/loads'", $rapida);
    test()->assertStringContainsString("post('/drivers'", $rapida);

    // Y ninguna ruta propia del tablero: un segundo camino de creación es un
    // segundo sitio donde olvidarse de un límite de plan o de un permiso.
    $rutas = fuenteDelPanel('routes/auth.php');
    test()->assertStringNotContainsString('board/loads', $rutas);
    test()->assertStringNotContainsString('board/drivers', $rutas);
});

it('la ventana rápida pide las dos paradas que el servidor exige', function (): void {
    $rapida = fuenteDelPanel('resources/js/components/App/Board/QuickAdd.tsx');

    // `stops` con `min:2`: una ventana con una sola parada prometería que basta
    // con un sitio, y el servidor la devolvería con un error que no señala
    // ningún campo de la ventana.
    test()->assertStringContainsString("stop_type: 'pickup'", $rapida);
    test()->assertStringContainsString("stop_type: 'delivery'", $rapida);
});

/* ── Los colores del hilo son clases enteras ────────────────────────────── */

it('los puntos de la cronología no se montan con una plantilla', function (): void {
    // Tailwind lee el código para decidir qué clases genera: `bg-${x}-600` no
    // aparece en el CSS y el punto sale sin color. Ver la lección del lote 36.
    $linea = codigoDelPanel('resources/js/components/App/Board/Timeline.tsx');

    test()->assertStringNotContainsString('bg-${', $linea);
    test()->assertStringContainsString("created: 'bg-navy-700'", $linea);
});
