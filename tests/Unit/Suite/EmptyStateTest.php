<?php

declare(strict_types=1);

use App\Enums\Scope;
use Tests\Support\Source;

/**
 * Una lista vacía no puede decir por qué está vacía si no sabe quién mira.
 *
 * ## El defecto
 *
 * Las seis pantallas de listado decían esto, sin mirar quién estaba delante.
 * Con el conductor de la base de datos de demostración, en `/documents`:
 *
 *     Todavía no hay documentos
 *     Suba el primero. Un transportista no puede despachar sin su
 *     certificado de seguro.
 *
 * Tres cosas falsas a la vez:
 *
 *  1. La empresa tiene TREINTA Y DOS documentos. El alcance de ese conductor es
 *     `own` y él no tiene ninguno; la frase habla de la empresa, y quien la lee
 *     no ve la empresa.
 *  2. El consejo es de otro rol: los papeles de un conductor son su CDL y su
 *     tarjeta médica.
 *  3. «Agregue el primero» se decía sin comprobar el permiso. Contabilidad lee
 *     transportistas, conductores, equipos y clientes y no puede crear ninguno:
 *     leía una instrucción que no puede seguir. Comprobado ocultando los
 *     transportistas y entrando como contabilidad.
 *
 * Y las seis pantallas ya recibían `scope` y `can`. La información estaba ahí y
 * el estado vacío no la miraba.
 *
 * ## Lo que este guardián exige
 *
 * 1. Que las seis usen el componente y que ninguna se quede con el panel
 *    escrito a mano — que es cómo volvería el defecto.
 * 2. Que el componente decida en el ORDEN correcto: el alcance ANTES del
 *    permiso. Un despachador crea conductores en su cartera, así que mira el
 *    permiso y sale que sí, y «todavía no hay conductores» seguiría siendo
 *    falso. Es la única de las cuatro ramas cuyo orden puede equivocarse sin
 *    que se note.
 * 3. Que cada alcance acotado tenga titular y pista en los dos idiomas.
 * 4. Que un listado que ACOTA la consulta y no manda el alcance a la vista esté
 *    declarado abajo con su motivo. Es lo que impide que entre el séptimo.
 */
function raizVacia(): string
{
    return Source::root();
}

/**
 * Las seis pantallas del lote: espacio de diccionario => [fichero, permiso].
 *
 * El permiso no se llama igual en todas —`can.upload` en documentos— y por eso
 * va declarado: exigir `can.create` en las seis habría dejado documentos fuera
 * sin que nada se quejara.
 *
 * @var array<string, array{0: string, 1: string}>
 */
const PANTALLAS_CON_ESTADO = [
    'carriers' => ['Carriers', 'can.create'],
    'customers' => ['Customers', 'can.create'],
    'drivers' => ['Drivers', 'can.create'],
    'equipment' => ['Equipment', 'can.create'],
    'documents' => ['Documents', 'can.upload'],
    'loads' => ['Loads', 'can.create'],
];

/**
 * Listados que ACOTAN la consulta y todavía no mandan el alcance a la vista.
 *
 * Mismo patrón que `Enforcement::SIN_APLICAR` y `Time\Pending::SIN_CONVERTIR`:
 * la deuda que queda está contada y con motivo, y el guardián falla si aparece
 * una nueva sin declarar o si una declarada ya se arregló.
 *
 * Vive en la prueba y no en `app/` porque es un hecho sobre el CABLEADO entre
 * controlador y componente, no una regla que el código consulte.
 *
 * @var array<string, string>
 */
const ACOTAN_SIN_DECIRLO = [
    'InvoiceController' => 'El transportista tiene invoice:read con alcance Carrier, así que ve solo lo que se le cobra. Su lista vacía dice «No hay facturas que coincidan» — que además culpa a filtros que no hay puestos. Se arregla con la misma pieza, pero esta pantalla no tiene todavía la distinción filtro/vacío y eso es un segundo cambio.',
    'ExpenseController' => 'Igual que las facturas, y con el añadido de que un gasto lo puede presentar quien no lo puede aprobar: hay dos permisos y hay que decidir cuál manda en el consejo.',
    'SettlementController' => 'Acota por transportista. Su mensaje también está escrito en forma de «no coincide» sin que haya filtros.',
    'MessageController' => 'Acota por participación, no por rol, y su mensaje ya es honesto sobre eso: «No estás en ningún hilo todavía». Es el único de la lista que dice la verdad hoy; se declara para que el guardián no dé por bueno el cableado.',
    'PermitController' => 'Acota por cartera de cargas. La pantalla de permisos no tiene diccionario propio de estado vacío todavía.',
    'UserController' => 'Acota por transportista para el rol carrier —solo ve a los suyos— y dice «Todavía no hay nadie más». Su estado vacío es un párrafo dentro de dos secciones, no el panel de las otras seis: la pieza no encaja sin rediseñar la pantalla.',
];

/* ── Las seis usan la pieza, y ninguna se queda con el panel a mano ─────── */

it('las seis pantallas pintan el estado vacío con el componente', function (): void {
    foreach (PANTALLAS_CON_ESTADO as $ns => [$carpeta, $permiso]) {
        $fuente = (string) file_get_contents(raizVacia()."/resources/js/pages/App/{$carpeta}/Index.tsx");

        test()->assertStringContainsString(
            "<EmptyState ns=\"{$ns}\"",
            $fuente,
            "{$carpeta} no usa el componente: su estado vacío no puede saber quién mira.",
        );

        // El alcance y el permiso, los dos. Con uno solo, dos de las cuatro
        // ramas no se pueden distinguir.
        test()->assertStringContainsString('scope={scope}', $fuente, "{$carpeta} no le pasa el alcance.");
        test()->assertStringContainsString("canCreate={{$permiso}}", $fuente, "{$carpeta} no le pasa el permiso.");
    }
});

it('ninguna se queda con el panel escrito a mano', function (): void {
    // Es la forma en que volvería: alguien copia el bloque de otra pantalla.
    foreach (PANTALLAS_CON_ESTADO as $ns => [$carpeta]) {
        $fuente = (string) file_get_contents(raizVacia()."/resources/js/pages/App/{$carpeta}/Index.tsx");

        expect($fuente)->not->toContain(
            "t(filtered ? '{$ns}.index.noResults' : '{$ns}.index.empty')",
            "{$carpeta} volvió a decidir el texto por su cuenta.",
        );
    }
});

it('ninguna deduce «hay filtros» de todos los valores de filters', function (): void {
    // `filters` lleva además lo que NO es un filtro: en cinco de las seis viaja
    // ahí el orden, con valor por omisión. Con `Object.values(filters).some(...)`
    // la pantalla creería que siempre hay filtros puestos, diría «nada coincide
    // con estos filtros» para siempre y las otras tres ramas no se alcanzarían
    // nunca — el defecto de este lote, entrado por otra puerta.
    //
    // Documentos lo hacía así y hoy no ordena, así que no fallaba. Se cambió
    // antes de que empezara a fallar.
    foreach (PANTALLAS_CON_ESTADO as $ns => [$carpeta]) {
        $fuente = (string) file_get_contents(raizVacia()."/resources/js/pages/App/{$carpeta}/Index.tsx");

        expect($fuente)->not->toContain(
            'Object.values(filters)',
            "{$carpeta} deduce «hay filtros» de todos los valores, y ahí viaja también el orden.",
        );

        test()->assertMatchesRegularExpression(
            '/const filtered =\s*\n?\s*filters\.\w+ !== /',
            $fuente,
            "{$carpeta} tiene que nombrar sus filtros uno a uno.",
        );
    }
});

/* ── El componente decide bien, y en el orden que importa ────────────────── */

it('el componente mira el alcance ANTES del permiso', function (): void {
    // Un despachador crea conductores en su cartera: si el permiso se mirara
    // primero, saldría que sí y la pantalla diría «todavía no hay conductores»
    // a alguien que solo ve su cartera. Es el único orden que puede
    // equivocarse sin que se note en una pantalla suelta.
    $fuente = (string) file_get_contents(raizVacia().'/resources/js/components/App/EmptyState.tsx');

    $posFiltro = strpos($fuente, 'if (filtered)');
    $posAlcance = strpos($fuente, "scope !== 'tenant'");
    $posPermiso = strpos($fuente, 'canCreate ?');

    expect($posFiltro)->toBeInt()->and($posAlcance)->toBeInt()->and($posPermiso)->toBeInt();

    expect($posFiltro)->toBeLessThan($posAlcance, 'Con filtros puestos manda el filtro: es lo que la persona acaba de hacer.');
    expect($posAlcance)->toBeLessThan($posPermiso, 'El alcance va primero: un alcance acotado hace falsa la frase de empresa aunque haya permiso de crear.');
});

it('el alcance de plataforma no se trata como acotado', function (): void {
    // Quien mira desde la plataforma lo ve todo: para él la frase de empresa es
    // tan cierta como para un administrador. Sin esta rama, la pantalla le
    // diría que la lista está acotada a él.
    $fuente = (string) file_get_contents(raizVacia().'/resources/js/components/App/EmptyState.tsx');

    test()->assertStringContainsString("scope !== 'platform'", $fuente);
});

it('sin permiso de crear no se pide crear', function (): void {
    $fuente = (string) file_get_contents(raizVacia().'/resources/js/components/App/EmptyState.tsx');

    test()->assertStringContainsString(
        "canCreate ? `\${ns}.index.emptyHint` : 'common.states.emptyNoPermission'",
        $fuente,
        'El consejo tiene que depender del permiso: «Agregue el primero» a quien no puede es una instrucción imposible.',
    );
});

/* ── Cada alcance acotado tiene qué decir, en los dos idiomas ────────────── */

it('los alcances acotados tienen titular y pista en los dos idiomas', function (): void {
    // Del enum, no de una lista escrita aquí: si mañana entra un alcance nuevo,
    // esta prueba pide su texto antes de que una pantalla enseñe la clave cruda.
    $acotados = array_values(array_filter(
        array_map(static fn (Scope $s): string => $s->value, Scope::cases()),
        static fn (string $v): bool => ! in_array($v, ['tenant', 'platform'], true),
    ));

    expect($acotados)->not->toBeEmpty();

    foreach (['es', 'en'] as $idioma) {
        $common = json_decode((string) file_get_contents(raizVacia()."/lang/{$idioma}/common.json"), true);

        foreach ($acotados as $alcance) {
            expect($common['states']['scoped'][$alcance] ?? null)->toBeString(
                "Falta el titular de «{$alcance}» en {$idioma}: la pantalla enseñaría common.states.scoped.{$alcance}.",
            );

            expect($common['states']['scoped'][$alcance.'Hint'] ?? null)->toBeString(
                "Falta la pista de «{$alcance}» en {$idioma}.",
            );
        }

        expect($common['states']['emptyNoPermission'] ?? null)->toBeString();
    }
});

it('las seis conservan el texto de empresa, que sigue haciendo falta', function (): void {
    // El componente sigue usando `<ns>.index.empty` para el caso de empresa. Si
    // alguien los borra creyendo que ya no se usan, esa rama enseña la clave.
    foreach (['es', 'en'] as $idioma) {
        foreach (array_keys(PANTALLAS_CON_ESTADO) as $ns) {
            $d = json_decode((string) file_get_contents(raizVacia()."/lang/{$idioma}/{$ns}.json"), true);

            foreach (['empty', 'emptyHint', 'noResults', 'noResultsHint'] as $clave) {
                expect($d['index'][$clave] ?? null)->toBeString("Falta {$ns}.index.{$clave} en {$idioma}.");
            }
        }
    }
});

/* ── Lo que acota y no lo dice, está contado ─────────────────────────────── */

it('todo listado que acota manda el alcance a la vista, o está declarado', function (): void {
    $sinDeclarar = [];

    foreach (glob(raizVacia().'/app/Http/Controllers/App/*Controller.php') ?: [] as $fichero) {
        $fuente = Source::sinComentarios($fichero);
        $nombre = basename($fichero, '.php');

        // Solo listados: los que pintan una pantalla Index.
        if (preg_match("/Inertia::render\('App\/\w+\/Index'/", $fuente) !== 1) {
            continue;
        }

        $acota = preg_match('/scopeFilter\(|LoadScope::apply|DocumentScope::|MessageScope::/', $fuente) === 1;
        $manda = str_contains($fuente, "'scope' => \$scope->value");

        if ($acota && ! $manda && ! array_key_exists($nombre, ACOTAN_SIN_DECIRLO)) {
            $sinDeclarar[] = $nombre;
        }
    }

    expect($sinDeclarar)->toBe(
        [],
        'Estos listados acotan la consulta y no le dicen a la vista con qué alcance, así que su estado '.
        "vacío no puede saber si la lista está vacía o solo recortada:\n  ".implode("\n  ", $sinDeclarar),
    );
});

it('la lista no reclama deuda ya pagada', function (): void {
    foreach (array_keys(ACOTAN_SIN_DECIRLO) as $nombre) {
        $fichero = raizVacia()."/app/Http/Controllers/App/{$nombre}.php";

        test()->assertFileExists($fichero, "{$nombre} ya no existe: quítalo de ACOTAN_SIN_DECIRLO.");

        $fuente = Source::sinComentarios($fichero);

        expect(str_contains($fuente, "'scope' => \$scope->value"))->toBeFalse(
            "{$nombre} ya manda el alcance a la vista: bórralo de ACOTAN_SIN_DECIRLO y dale el componente.",
        );
    }
});

it('cada pendiente dice por qué sigue así', function (): void {
    foreach (ACOTAN_SIN_DECIRLO as $nombre => $motivo) {
        expect(strlen($motivo))->toBeGreaterThan(
            60,
            "{$nombre}: el motivo tiene que decir qué acota y qué hay que decidir antes de tocarlo.",
        );
    }
});
