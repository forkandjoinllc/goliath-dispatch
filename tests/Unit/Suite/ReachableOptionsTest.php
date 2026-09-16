<?php

declare(strict_types=1);

use App\Support\Screens\Reachable;
use Tests\Support\Source;

use function PHPUnit\Framework\assertArrayHasKey;
use function PHPUnit\Framework\assertMatchesRegularExpression;
use function PHPUnit\Framework\assertSame;
use function PHPUnit\Framework\assertStringContainsString;
use function PHPUnit\Framework\assertStringNotContainsString;

/**
 * Un desplegable no ofrece estados que el sistema no puede producir.
 *
 * ## El defecto
 *
 * La pantalla de comisiones ofrecía «Debido · Aprobado · Pagado · Anulado» y la
 * aplicación solo escribe dos de los cuatro. No hay paso de aprobación de
 * comisiones, y no hay forma de anular una. La de mensajes ofrecía «Directo» y
 * «Aviso general», y `Threads` —el único sitio que crea conversaciones— solo
 * crea hilos de carga.
 *
 * Elegir cualquiera de esos cuatro devolvía siempre cero filas, con el texto
 * «Ningún hilo cuadra con lo que buscas» o un total de cero bajo el nombre del
 * estado. Es decir: culpaba al filtro de algo imposible. Quien lo lee concluye
 * que hoy no hay nada en ese estado, no que ese estado no existe.
 *
 * Buscando la misma forma aparecieron dos pantallas más —facturas con `due` e
 * `uncollectable`, cobros con `processing` y `cancelled`— y dos que estaban
 * enteras, gastos y liquidaciones. Ocho opciones imposibles de veinticuatro.
 *
 * ## Lo que vigila
 *
 * Que cada valor declarado como alcanzable lo escriba de verdad la clase que
 * dice producirlo, que cada valor declarado como imposible siga sin escribirse,
 * y que entre las dos listas esté TODO lo que el catálogo admite. Lo tercero es
 * lo que caza el estado número veinticinco.
 */
function raizOpciones(): string
{
    return Source::root();
}

/** El `create table` de una tabla, del DDL. */
function ddlDeLaTabla(string $tabla): string
{
    $ddl = '';

    foreach (glob(raizOpciones().'/database/schema/0*.sql') ?: [] as $fichero) {
        $ddl .= (string) file_get_contents($fichero);
    }

    return preg_match('/^create table `?'.preg_quote($tabla, '/').'`?\s*\((.*?)^\) engine=/ms', $ddl, $m) === 1
        ? $m[1]
        : '';
}

/** El fichero de una clase declarada como productora. */
function fuenteDe(string $clase): string
{
    $relativa = 'app/'.str_replace('\\', '/', substr($clase, strlen('App\\')));

    return Source::compacta(raizOpciones().'/'.$relativa.'.php');
}

/**
 * El código de los ficheros que tocan una tabla, compactado.
 *
 * Acotado a la tabla y no a toda la aplicación: buscar `'status'=>'voided'` por
 * todas partes encuentra el de las liquidaciones y concluye que las comisiones
 * se pueden anular.
 */
function codigoQueToca(string $tabla): string
{
    static $cache = [];

    if (! isset($cache[$tabla])) {
        $todo = '';

        $ficheros = new RecursiveIteratorIterator(
            new RecursiveDirectoryIterator(raizOpciones().'/app', FilesystemIterator::SKIP_DOTS),
        );

        foreach ($ficheros as $fichero) {
            if ($fichero->getExtension() !== 'php') {
                continue;
            }

            $fuente = (string) file_get_contents($fichero->getPathname());

            if (str_contains($fuente, "'{$tabla}'")) {
                $todo .= Source::compacta($fichero->getPathname());
            }
        }

        $cache[$tabla] = $todo;
    }

    return $cache[$tabla];
}

it('quien dice producir un valor lo escribe de verdad', function (): void {
    // Declarar un productor sin comprobarlo sería una lista de buenas
    // intenciones: el registro vale lo que valen sus declaraciones.
    foreach (Reachable::PRODUCEN as $lista => $valores) {
        expect($valores)->not->toBe([], "la lista «{$lista}» no ofrece nada");

        foreach ($valores as $valor => $clase) {
            if ($clase === Reachable::POR_OMISION) {
                [$tabla, $campo] = Reachable::TABLAS[$lista];

                assertMatchesRegularExpression(
                    '/`?'.preg_quote($campo, '/').'`?\s+varchar\(\d+\)\s+not null default \''.preg_quote($valor, '/').'\'/',
                    ddlDeLaTabla($tabla),
                    "«{$lista}.{$valor}» dice venir del valor por omisión de `{$tabla}.{$campo}`, y el esquema dice otra cosa",
                );

                continue;
            }

            if (str_starts_with($clase, Reachable::FORMULARIO)) {
                $fuente = fuenteDe(substr($clase, strlen(Reachable::FORMULARIO)));

                assertStringContainsString(
                    "Rule::in(Reachable::valores('{$lista}'))",
                    $fuente,
                    "«{$lista}.{$valor}» dice elegirse en un formulario que no valida contra este registro",
                );

                continue;
            }

            $fuente = fuenteDe($clase);

            assertStringContainsString(
                "'{$valor}'",
                $fuente,
                "«{$lista}.{$valor}» dice producirse en {$clase}, y ese fichero no lo nombra",
            );
        }
    }
});

it('lo declarado imposible sigue sin escribirse', function (): void {
    // La otra dirección, y la que hace que este registro no sea un sitio donde
    // aparcar deuda: el día que alguien construya la aprobación de comisiones o
    // los hilos directos, esto se pone rojo y manda a devolver la opción al
    // desplegable.
    foreach (Reachable::NO_SE_PRODUCEN as $lista => $valores) {
        [$tabla, $campo] = Reachable::TABLAS[$lista];

        foreach ($valores as $valor => $motivo) {
            expect(strlen($motivo))->toBeGreaterThan(80, "«{$lista}.{$valor}» no explica por qué no puede pasar");

            expect(str_contains(codigoQueToca($tabla), "'{$campo}'=>'{$valor}'"))->toBeFalse(
                "«{$lista}.{$valor}» ya se escribe: hay que devolverlo al desplegable.",
            );
        }
    }
});

it('las dos listas cubren el catálogo entero', function (): void {
    // EL ESTADO NÚMERO VEINTICINCO. Un valor nuevo en el enum o en el
    // diccionario que no esté declarado se queda fuera del desplegable sin que
    // nadie lo note — o peor, alguien lo añade a mano y vuelve el defecto.
    foreach (Reachable::CATALOGO as $lista => $origen) {
        $declarados = Reachable::declarados($lista);
        sort($declarados);

        if ($origen === Reachable::DEL_DICCIONARIO) {
            [$fichero, $seccion] = Reachable::DICCIONARIOS[$lista];

            foreach (['es', 'en'] as $idioma) {
                $d = json_decode(
                    (string) file_get_contents(raizOpciones()."/lang/{$idioma}/{$fichero}.json"),
                    true,
                );

                $delDiccionario = array_keys($d[$seccion] ?? []);
                sort($delDiccionario);

                assertSame(
                    $delDiccionario,
                    $declarados,
                    "«{$lista}» no coincide con su diccionario en {$idioma}",
                );
            }

            continue;
        }

        $delEnum = array_map(static fn ($c): string => (string) $c->value, $origen::cases());
        sort($delEnum);

        assertSame($delEnum, $declarados, "«{$lista}» no coincide con {$origen}");
    }
});

it('ningún valor está en las dos listas a la vez', function (): void {
    foreach (Reachable::CATALOGO as $lista => $origen) {
        $enLasDos = array_intersect(
            array_keys(Reachable::PRODUCEN[$lista] ?? []),
            array_keys(Reachable::NO_SE_PRODUCEN[$lista] ?? []),
        );

        assertSame([], array_values($enLasDos), "«{$lista}» declara un valor como posible e imposible a la vez");
    }
});

it('ninguna pantalla se guarda su propia lista de estados', function (): void {
    // Es la forma en que volvería: alguien escribe otra vez
    // `private const STATUSES = [...]` y la copia se queda sin enterarse de lo
    // que el registro sabe. Las siete que había decían los estados del esquema,
    // no los que pueden pasar.
    $sueltas = [];

    foreach (glob(raizOpciones().'/app/Http/Controllers/App/*Controller.php') ?: [] as $fichero) {
        $fuente = Source::compacta($fichero);

        if (preg_match('/privateconst(STATUSES|ESTADOS|KINDS)=\[/', $fuente) === 1) {
            $sueltas[] = basename($fichero, '.php');
        }
    }

    assertSame([], $sueltas, 'Estas pantallas se guardan su propia lista: '.implode(', ', $sueltas));
});

it('las pantallas piden sus opciones al registro', function (): void {
    $esperado = [
        'CommissionController' => 'commissions.status',
        'InvoiceController' => 'invoices.status',
        'PaymentController' => 'payments.status',
        'ExpenseController' => 'expenses.status',
        'SettlementController' => 'settlements.status',
        'LeadController' => 'leads.status',
        'MessageController' => 'messages.kind',
        'SignatureController' => 'signatures.status',
    ];

    foreach ($esperado as $controlador => $lista) {
        $fuente = Source::compacta(raizOpciones()."/app/Http/Controllers/App/{$controlador}.php");

        assertStringContainsString(
            "Reachable::valores('{$lista}')",
            $fuente,
            "«{$controlador}» no pide sus opciones al registro",
        );
    }
});

it('lo que se filtra y lo que se valida salen del mismo sitio', function (): void {
    // `pay()` validaba contra los cuatro estados: se podía pedir pagar las
    // comisiones «aprobadas» —imposible—, no se pagaba ninguna, y el mensaje de
    // éxito decía «0 comisiones marcadas como pagadas».
    $comisiones = Source::compacta(raizOpciones().'/app/Http/Controllers/App/CommissionController.php');

    assertStringContainsString("Rule::in(Reachable::valores('commissions.status'))", $comisiones);
    assertStringContainsString("Reachable::admite('commissions.status',", $comisiones);
});

it('nadie lee un estado que nada puede escribir para decidir algo', function (): void {
    // `markPaid()` filtraba `whereIn('status', ['accrued', 'approved'])`. Una
    // cláusula que lee un estado imposible no hace daño, pero DICE que existe —
    // y la pantalla la creía.
    $libro = Source::compacta(raizOpciones().'/app/Support/Finance/CommissionLedger.php');

    assertStringContainsString("->where('status','accrued')", $libro);
    assertStringNotContainsString("'accrued','approved'", $libro);
});

it('la pantalla de mensajes no pinta un filtro de una sola opción', function (): void {
    $pantalla = (string) file_get_contents(raizOpciones().'/resources/js/pages/App/Messages/Index.tsx');
    $pantalla = (string) preg_replace('#\{/\*.*?\*/\}#s', '', $pantalla);
    $compacta = (string) preg_replace('/\s+/', '', $pantalla);

    assertStringContainsString('{kinds.length>1?(', $compacta);
});

it('cada lista declarada tiene su etiqueta en los dos idiomas', function (): void {
    // Ofrecer una opción sin texto enseñaría la clave cruda. Se comprueba sobre
    // lo ALCANZABLE, que es lo único que la pantalla pinta.
    $ficheros = [
        'commissions.status' => ['commissions', 'status'],
        'messages.kind' => ['messages', 'kind'],
        'invoices.status' => ['invoices', 'status'],
        'payments.status' => ['payments', 'status'],
        'expenses.status' => ['expenses', 'status'],
        'settlements.status' => ['settlements', 'status'],
        'leads.status' => ['leads', 'status'],
        'signatures.status' => ['signature', 'statuses'],
    ];

    foreach ($ficheros as $lista => [$fichero, $seccion]) {
        foreach (['es', 'en'] as $idioma) {
            $d = json_decode(
                (string) file_get_contents(raizOpciones()."/lang/{$idioma}/{$fichero}.json"),
                true,
            );

            foreach (Reachable::valores($lista) as $valor) {
                assertArrayHasKey($valor, $d[$seccion] ?? [], "falta {$fichero}.{$seccion}.{$valor} en {$idioma}");
            }
        }
    }
});
