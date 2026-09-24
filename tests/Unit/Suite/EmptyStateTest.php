<?php

declare(strict_types=1);

use App\Authorization\RoleMatrix;
use App\Enums\Role;
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
    'OnboardingController' => 'Entró en la lista al arreglarse la fuga: acotaba mal —le daba la empresa entera al despachador— y ahora acota bien. Su pantalla es un TABLERO por columnas de estado, no el panel de las otras seis, así que no tiene dónde encajar el componente sin rediseñarla. Mientras tanto, un despachador sin transportistas asignados ve un tablero vacío sin saber si es que no hay altas o es que no son suyas.',
    'SignatureController' => 'Lo mismo y por lo mismo. Su tabla pinta un texto suelto —«signature.index.empty»— que dice «Todavía no hay solicitudes», y con alcance Assigned eso es falso: las hay, no son suyas.',
    'ReportController' => 'Acota dentro de `Reports\\PeriodReport`, que recorta por transportista o por cartera según el alcance. La pantalla no es un listado con filtros sino cinco tablas de un periodo, y su texto vacío —«Nada en este periodo»— se repite en las cinco: darle el alcance obliga a decidir si la frase es de la tabla o de la pantalla entera.',
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
    // Y no solo las seis del lote: TODA pantalla que use el componente, que es
    // como entró cobros. Una lista escrita a mano solo cubre lo que ya existía.
    foreach (glob(raizVacia().'/resources/js/pages/App/*/Index.tsx') ?: [] as $pagina) {
        $fuente = (string) file_get_contents($pagina);

        if (! str_contains($fuente, '<EmptyState')) {
            continue;
        }

        $carpeta = basename(dirname($pagina));

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
    $fichero = (string) file_get_contents(raizVacia().'/resources/js/components/App/EmptyState.tsx');

    // Solo el cuerpo que decide: en la lista de props de arriba `canCreate`
    // aparece antes que todo, y medir sobre el fichero entero daría por bueno
    // un `if (!canCreate)` colado delante del alcance.
    $inicio = strpos($fichero, 'const [titulo, pista] = (() => {');
    expect($inicio)->toBeInt('El componente ya no decide en esa función: revisa este guardián antes que nada.');

    $fin = strpos($fichero, '})()', (int) $inicio);
    expect($fin)->toBeInt();

    $fuente = substr($fichero, (int) $inicio, (int) $fin - (int) $inicio);

    $posFiltro = strpos($fuente, 'if (filtered)');
    $posAlcance = strpos($fuente, "scope !== 'tenant'");
    $posPermiso = strpos($fuente, 'canCreate');

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
    // La condición creció al entrar `createdElsewhere` —cobros no los da de
    // alta nadie desde su pantalla— y la exigencia NO se relaja: el consejo
    // sigue dependiendo del permiso, solo que ahora también de si el dominio
    // crea aquí. Lo que no puede volver es que la pista de crear se enseñe sin
    // mirar ninguna de las dos cosas.
    $fuente = (string) file_get_contents(raizVacia().'/resources/js/components/App/EmptyState.tsx');

    test()->assertStringContainsString(
        "canCreate || createdElsewhere ? `\${ns}.index.emptyHint` : 'common.states.emptyNoPermission'",
        $fuente,
        'El consejo tiene que depender del permiso: «Agregue el primero» a quien no puede es una instrucción imposible.',
    );
});

it('sólo se declara «no nace aquí» donde de verdad no nace', function (): void {
    // La salida de la cuarta rama es fácil de usar como atajo: puesta en una
    // pantalla que SÍ crea, esconde el «no tiene permiso» detrás de una pista
    // amable y nadie se entera.
    foreach (glob(raizVacia().'/resources/js/pages/App/*/Index.tsx') ?: [] as $pagina) {
        $fuente = (string) file_get_contents($pagina);

        if (! str_contains($fuente, 'createdElsewhere')) {
            continue;
        }

        $carpeta = basename(dirname($pagina));

        test()->assertStringContainsString(
            'canCreate={false}',
            $fuente,
            "{$carpeta} dice que sus filas no nacen aquí y a la vez pasa un permiso de crear.",
        );

        // Y del lado del servidor: que no haya acción de alta en la pantalla.
        foreach (listadosConIndex() as $nombre) {
            if (carpetaDelListado($nombre) !== $carpeta) {
                continue;
            }

            expect(preg_match("/'create' =>|'upload' =>/", fuenteDelListado($nombre)))->toBe(
                0,
                "{$nombre} manda un permiso de alta a la vista: sus filas sí nacen aquí.",
            );
        }
    }
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

/**
 * Cómo le dice cada listado a la vista con qué alcance está mirando.
 *
 * El nombre de la prop va declarado porque NO es el mismo en todas: seis
 * mandan `scope` y dos mandan `onlyMine`, que dice menos pero dice la verdad
 * —son listas de dos alcances, empresa o suyo, y un booleano los distingue—.
 * Exigir la cadena `'scope' => $scope->value` a todas era el error anterior:
 * dejaba fuera a las dos que sí lo dicen y las habría contado como deuda.
 *
 * @var array<string, string>
 */
const DICEN_EL_ALCANCE = [
    'CarrierController' => 'scope',
    'CustomerController' => 'scope',
    'DocumentController' => 'scope',
    'DriverController' => 'scope',
    'EquipmentController' => 'scope',
    'LoadController' => 'scope',
    'PaymentController' => 'scope',
    'VendorController' => 'scope',
    'AssignmentController' => 'onlyMine',
    'CommissionController' => 'onlyMine',
];

/**
 * Listados que son de UNA persona por naturaleza, no por su rol.
 *
 * La matriz concede `notification:preference:update` con alcance `own` a los
 * seis roles, así que por la regla de abajo este listado «puede venir
 * acotado». Y viene, pero no por quién es: la bandeja de avisos de un
 * administrador tampoco lleva los de otro. Decir «aquí solo salen los suyos»
 * en una bandeja personal no informa de nada.
 *
 * Lo que se comprueba no es el motivo, es el hecho: la consulta tiene que
 * acotar por el usuario del actor. Si un día deja de hacerlo, esta excusa deja
 * de valer y el guardián lo dice.
 *
 * @var array<string, string>
 */
const PERSONALES = [
    'NotificationController' => 'La bandeja de avisos de cada cual. Acota por user_id para los seis roles, no por alcance de rol.',
];

/**
 * Los permisos que un controlador autoriza, tal como los pide.
 *
 * @return list<string>
 */
function permisosQueAutoriza(string $fuente): array
{
    preg_match_all("/authorize\(\\\$actor, '([a-z:_]+)'/", $fuente, $m);

    /** @var list<string> $permisos */
    $permisos = array_values(array_unique($m[1]));

    return $permisos;
}

/**
 * Quién puede llegar a esta pantalla con la lista recortada.
 *
 * No se busca cómo está escrita la consulta: se pregunta a la matriz de
 * permisos, que es donde está el hecho. Un listado puede venir acotado si
 * ALGÚN rol tiene alguno de sus permisos con alcance por debajo de empresa —da
 * igual que la consulta lo aplique con `ScopeFilter`, con un `whereExists` a
 * mano o dentro de una clase de informe.
 *
 * @return list<string> «rol:alcance(permiso)», vacío si nadie lo ve acotado
 */
function quienLoVeAcotado(string $fuente): array
{
    $quien = [];

    foreach (permisosQueAutoriza($fuente) as $permiso) {
        foreach (Role::cases() as $rol) {
            $alcance = RoleMatrix::for($rol)[$permiso] ?? null;

            if ($alcance !== null && ! $alcance->atLeast(Scope::Tenant)) {
                $quien[] = "{$rol->value}:{$alcance->value}({$permiso})";
            }
        }
    }

    return $quien;
}

/** @return list<string> Los controladores que pintan una pantalla Index. */
function listadosConIndex(): array
{
    $nombres = [];

    foreach (glob(raizVacia().'/app/Http/Controllers/App/*Controller.php') ?: [] as $fichero) {
        if (preg_match("/Inertia::render\('App\/\w+\/Index'/", Source::sinComentarios($fichero)) === 1) {
            $nombres[] = basename($fichero, '.php');
        }
    }

    return $nombres;
}

function fuenteDelListado(string $nombre): string
{
    return Source::sinComentarios(raizVacia()."/app/Http/Controllers/App/{$nombre}.php");
}

/**
 * El cuerpo de un método, del `function nombre(` al siguiente método.
 *
 * Hace falta porque un controlador acota en varios sitios y no todos son la
 * lista: buscar en el fichero entero da por buena una bandeja cuya consulta de
 * LA LISTA dejó de acotar mientras otro método sigue acotando.
 */
function cuerpoDelMetodo(string $fuente, string $metodo): string
{
    $inicio = strpos($fuente, "function {$metodo}(");

    if ($inicio === false) {
        return '';
    }

    $siguiente = preg_match(
        '/\n    (?:public|private|protected)(?: static)? function /',
        $fuente,
        $m,
        PREG_OFFSET_CAPTURE,
        $inicio + 10,
    ) === 1 ? $m[0][1] : strlen($fuente);

    return substr($fuente, $inicio, $siguiente - $inicio);
}

/** La carpeta de la pantalla que pinta, sacada del propio render. */
function carpetaDelListado(string $nombre): string
{
    preg_match("/Inertia::render\('App\/(\w+)\/Index'/", fuenteDelListado($nombre), $m);

    return $m[1] ?? '';
}

it('todo listado que PUEDE venir acotado lo dice, o está declarado', function (): void {
    $sinDeclarar = [];

    foreach (listadosConIndex() as $nombre) {
        $fuente = fuenteDelListado($nombre);

        // Quien exige alcance de empresa no puede recibir a nadie recortado:
        // la pantalla contesta 403 antes de consultar nada.
        if (str_contains($fuente, 'requireTenantScope(')) {
            continue;
        }

        if (array_key_exists($nombre, PERSONALES)) {
            continue;
        }

        $quien = quienLoVeAcotado($fuente);

        if ($quien === []) {
            continue;
        }

        if (array_key_exists($nombre, DICEN_EL_ALCANCE) || array_key_exists($nombre, ACOTAN_SIN_DECIRLO)) {
            continue;
        }

        $sinDeclarar[] = "{$nombre} — lo ve acotado ".implode(', ', array_slice($quien, 0, 3));
    }

    expect($sinDeclarar)->toBe(
        [],
        'Estos listados los ve alguien con la lista recortada y no le dicen a la vista con qué alcance, '.
        "así que su estado vacío no puede saber si la lista está vacía o solo recortada:\n  ".
        implode("\n  ", $sinDeclarar),
    );
});

it('el detector ve acotado un listado que acota a mano', function (): void {
    // Esta es la prueba del lote. Cobros no usa ninguna de las cuatro formas
    // que el detector anterior buscaba —`scopeFilter(`, `LoadScope::apply`,
    // `DocumentScope::`, `MessageScope::`—: acota con un `whereExists` escrito
    // a mano porque `payments` no lleva `carrier_id` y se llega al
    // transportista por la factura. El guardián reportaba verde sobre
    // exactamente el defecto para el que se escribió.
    $fuente = fuenteDelListado('PaymentController');

    expect(preg_match('/scopeFilter\(|LoadScope::apply|DocumentScope::|MessageScope::/', $fuente))->toBe(
        0,
        'Cobros ya acota con una de las formas conocidas: este guardián perdió su ejemplo, busca otro.',
    );

    expect(quienLoVeAcotado($fuente))->not->toBe(
        [],
        'El detector no ve que a cobros lo mira un transportista con la lista recortada.',
    );
});

it('el detector no depende de cómo esté escrita la consulta', function (): void {
    // Dicho de otro modo: lo que decide es el permiso, y el permiso está en la
    // matriz. Facturas y cobros se leen con el MISMO permiso y acotan de dos
    // maneras distintas; el detector tiene que ver las dos igual.
    expect(quienLoVeAcotado(fuenteDelListado('InvoiceController')))->not->toBe([]);
    expect(quienLoVeAcotado(fuenteDelListado('PaymentController')))->not->toBe([]);

    // Y uno que nadie ve acotado tiene que salir vacío: un detector que
    // dijera «acotado» de todo también reportaría verde, por el otro lado.
    expect(quienLoVeAcotado(fuenteDelListado('AuditController')))->toBe([]);
});

it('lo que un listado dice que manda, lo manda de verdad', function (): void {
    foreach (DICEN_EL_ALCANCE as $nombre => $prop) {
        $fuente = fuenteDelListado($nombre);

        expect(str_contains($fuente, "'{$prop}' =>"))->toBeTrue(
            "{$nombre} está declarado como que manda «{$prop}» y no lo manda.",
        );

        // Y que a alguien le sirva: una prop que la pantalla no lee es lo
        // mismo que no mandarla.
        $carpeta = carpetaDelListado($nombre);
        $pagina = raizVacia()."/resources/js/pages/App/{$carpeta}/Index.tsx";

        test()->assertFileExists($pagina, "{$nombre} pinta App/{$carpeta}/Index y ese fichero no está.");

        // En el CUERPO, no en la declaración: `onlyMine: boolean` y el
        // desestructurado la nombran igual aunque nadie la mire después, así
        // que buscarla en el fichero entero daba por bueno tirarla.
        $tsx = (string) file_get_contents($pagina);
        $cuerpo = substr($tsx, (int) strpos($tsx, 'return ('));

        expect(str_contains($cuerpo, $prop))->toBeTrue(
            "{$carpeta}/Index.tsx no usa «{$prop}» para pintar nada: el servidor lo manda y la pantalla lo tira.",
        );
    }
});

it('la lista no reclama deuda ya pagada', function (): void {
    foreach (array_keys(ACOTAN_SIN_DECIRLO) as $nombre) {
        $fichero = raizVacia()."/app/Http/Controllers/App/{$nombre}.php";

        test()->assertFileExists($fichero, "{$nombre} ya no existe: quítalo de ACOTAN_SIN_DECIRLO.");

        expect(array_key_exists($nombre, DICEN_EL_ALCANCE))->toBeFalse(
            "{$nombre} ya le dice el alcance a la vista: bórralo de ACOTAN_SIN_DECIRLO.",
        );

        // Y al revés: si la matriz cambia y ya nadie lo ve acotado, la deuda
        // dejó de existir y la entrada se queda contando algo que no pasa.
        expect(quienLoVeAcotado(fuenteDelListado($nombre)))->not->toBe(
            [],
            "{$nombre} ya no lo ve nadie acotado según la matriz: la deuda se pagó sola, quítala.",
        );
    }
});

it('una bandeja personal acota de verdad por su persona', function (): void {
    foreach (array_keys(PERSONALES) as $nombre) {
        $fuente = fuenteDelListado($nombre);

        // La consulta que pinta la lista, que es la que puede mentir. Con el
        // fichero entero bastaba con que CUALQUIER método acotara: quitarlo
        // del listado y dejarlo en el contador de la campana pasaba por bueno.
        $consulta = cuerpoDelMetodo($fuente, 'scoped').cuerpoDelMetodo($fuente, 'index');

        expect(preg_match("/'user_id', \\\$actor->userId/", $consulta))->toBe(
            1,
            "{$nombre} está declarado como bandeja personal y su consulta de la lista no acota por el usuario del actor.",
        );
    }
});

it('quien exige empresa la exige de verdad', function (): void {
    foreach (listadosConIndex() as $nombre) {
        $fuente = fuenteDelListado($nombre);

        if (! str_contains($fuente, 'requireTenantScope(')) {
            continue;
        }

        // La excusa vale por lo que hace el ayudante, no por su nombre.
        expect(preg_match('/atLeast\(Scope::Tenant\)/', $fuente))->toBe(
            1,
            "{$nombre} usa requireTenantScope y ese ayudante ya no compara contra Scope::Tenant.",
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
