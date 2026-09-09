<?php

declare(strict_types=1);

use App\Support\Deletion\OpenWork;
use Tests\Support\Source;

/**
 * Nada con trabajo abierto se borra, y la pantalla lo dice antes de ofrecerlo.
 *
 * ## El defecto
 *
 * La regla existía, con su motivo, dentro de `CustomerController::destroy`:
 *
 * > Un cliente con cargas vivas no se borra. No es una regla de conveniencia:
 * > la carga necesita saber a quién facturar, y un cliente borrado en mitad de
 * > un viaje deja una factura sin destinatario.
 *
 * Al TRANSPORTISTA no se le aplicó nunca. Y de las dos fichas que se pueden
 * borrar, el transportista es el que pone el camión.
 *
 * Medido sobre los datos de demostración antes de arreglarlo: se borró un
 * transportista con una carga en `in_transit`, sin ninguna negativa, y la ficha
 * de esa carga pasó a enseñar «—» donde va quién la lleva mientras la pantalla
 * de rastreo seguía nombrándolo. La aplicación decía dos cosas distintas sobre
 * la misma carga viva.
 *
 * Y su diálogo de confirmación era casi la misma frase que el del cliente —«Las
 * cargas y facturas históricas siguen nombrándolo»—, así que prometía la
 * garantía que el código del cliente sí da y el suyo no.
 *
 * ## Qué vigila este guardián
 *
 * 1. Que la regla esté en UN sitio y que las dos fichas pasen por él. Escrita
 *    dos veces se separa, que es exactamente cómo llegó a estar en una sola.
 * 2. Que los estados terminales sean los del esquema y no una lista a mano.
 * 3. Que las dos pantallas reciban qué bloquea y lo digan ANTES de ofrecer el
 *    botón — el patrón de `Guards::blocking` en las cargas.
 * 4. Que todo `destroy()` de una FICHA compruebe sus dependencias, por
 *    `OpenWork` o por una cuenta propia, y esté declarado abajo con cuál y por
 *    qué. Es lo que impide que entre la tercera ficha sin regla.
 */
function raizBorrado(): string
{
    return Source::root();
}

/**
 * Los `destroy()` de FICHA y qué comprueban.
 *
 * No todos hacen la misma pregunta, y forzarlos a una sola sería falsa
 * uniformidad:
 *
 *  - `OpenWork` responde «¿queda trabajo sin terminar?». Una carga cerrada hace
 *    años no impide borrar a su transportista.
 *  - La cuenta propia responde «¿lo referencia algo, lo que sea?». Una empresa
 *    de factoring con una asignación antigua no se puede borrar aunque esa
 *    asignación esté cerrada: la fila la nombra.
 *
 * Lo que el guardián exige es que cada una compruebe ALGO y lo diga aquí.
 *
 * @var array<string, string>
 */
const BORRADOS_DE_FICHA = [
    'CarrierController' => 'OpenWork::forCarrier — cargas sin cerrar, liquidaciones sin pagar y facturas con saldo.',
    'CustomerController' => 'OpenWork::forCustomer — cargas sin cerrar. No tiene liquidaciones y sus facturas cuelgan de la carga.',
    'FactoringController' => 'Cuenta propia sobre factoring_assignments: aquí la pregunta no es si queda trabajo abierto sino si algo la nombra, y una asignación cerrada la nombra igual.',
];

/* ── La regla vive en un sitio y las dos fichas pasan por él ─────────────── */

it('las dos fichas que se pueden borrar consultan la misma pieza', function (): void {
    foreach (['Carrier' => 'forCarrier', 'Customer' => 'forCustomer'] as $ficha => $metodo) {
        $fuente = Source::compacta(raizBorrado()."/app/Http/Controllers/App/{$ficha}Controller.php");

        test()->assertStringContainsString(
            "OpenWork::{$metodo}(",
            $fuente,
            "{$ficha}Controller::destroy no consulta el trabajo abierto: se puede borrar con una carga en marcha.",
        );

        test()->assertStringContainsString(
            'OpenWork::message(',
            $fuente,
            "{$ficha}Controller no dice QUÉ está abierto. Un «no se puede» a secas manda a buscar.",
        );
    }
});

it('la consulta ya no está suelta en el controlador del cliente', function (): void {
    // Era la única copia de la regla en toda la aplicación, y por eso el
    // transportista se quedó sin ella.
    $fuente = Source::compacta(raizBorrado().'/app/Http/Controllers/App/CustomerController.php');

    expect($fuente)->not->toContain(
        "whereNotIn('status',['paid','cancelled'])",
        'La regla volvió a escribirse en línea: dos copias se separan.',
    );
});

it('los estados terminales son los que dice el esquema', function (): void {
    // `paid` y `cancelled` tienen que existir en el CHECK de loads.status: si
    // alguien renombra un estado, esta lista dejaría pasar cargas vivas en
    // silencio — la comparación sería siempre falsa y nada bloquearía.
    $ddl = (string) file_get_contents(raizBorrado().'/database/schema/04_loads_routes_permits_tables.sql');

    preg_match('/constraint\s+\w*loads?_status\w*\s+check\s*\(\s*`?status`?\s+in\s*\(([^)]*)\)/is', $ddl, $m);

    if (($m[1] ?? '') === '') {
        // El CHECK vive en otro fichero o con otro nombre: se busca en todos.
        $todos = '';
        foreach (glob(raizBorrado().'/database/schema/*.sql') ?: [] as $f) {
            $todos .= (string) file_get_contents($f);
        }
        preg_match_all("/check\s*\(\s*`?status`?\s+in\s*\(([^)]*)\)/is", $todos, $todosM);
        $m[1] = implode(',', $todosM[1] ?? []);
    }

    preg_match_all("/'([^']+)'/", (string) ($m[1] ?? ''), $valores);

    // Los DOS, y solo esos dos.
    //
    // El sabotaje que añadía `delivered` a la lista pasó en verde: nada la
    // fijaba, solo se comprobaba que sus valores existieran en el esquema. Una
    // carga entregada y sin facturar sigue debiendo dinero al transportista, y
    // con `delivered` dentro se podía borrar a quien acaba de entregar.
    expect(OpenWork::CARGAS_CERRADAS)->toBe(['paid', 'cancelled']);

    foreach (OpenWork::CARGAS_CERRADAS as $estado) {
        // assertContains y NO expect()->toContain($valor, $mensaje): toContain
        // toma TODOS sus argumentos como agujas, así que el mensaje se
        // convierte en un valor más que buscar y la prueba falla por lo que no
        // es. Va por la quinta vez en este repositorio.
        test()->assertContains(
            $estado,
            $valores[1] ?? [],
            "«{$estado}» no está en ningún CHECK de status: la comparación no casaría con nada y no bloquearía nada.",
        );
    }
});

it('las liquidaciones abiertas no incluyen las pagadas ni las anuladas', function (): void {
    expect(OpenWork::LIQUIDACIONES_ABIERTAS)->toBe(['draft', 'issued'])
        ->and(OpenWork::LIQUIDACIONES_ABIERTAS)->not->toContain('paid')
        ->and(OpenWork::LIQUIDACIONES_ABIERTAS)->not->toContain('voided');
});

it('las facturas se miran por saldo y no por estado', function (): void {
    // Una `sent` con saldo cero está cobrada y una `disputed` con saldo sigue
    // viva: el estado no contesta la pregunta, el saldo sí.
    $fuente = Source::compacta(raizBorrado().'/app/Support/Deletion/OpenWork.php');

    test()->assertStringContainsString("where('balance_cents','>',0)", $fuente);
});

/* ── Las pantallas lo dicen antes de ofrecer el botón ────────────────────── */

it('las dos pantallas reciben qué bloquea', function (): void {
    foreach (['Carrier' => 'forCarrier', 'Customer' => 'forCustomer'] as $ficha => $metodo) {
        $fuente = Source::compacta(raizBorrado()."/app/Http/Controllers/App/{$ficha}Controller.php");

        test()->assertStringContainsString(
            "'blocking'=>OpenWork::{$metodo}(",
            $fuente,
            "{$ficha}Controller no manda lo que bloquea, así que su pantalla no puede avisar antes.",
        );
    }
});

it('las dos pantallas avisan en vez de ofrecer un borrado que no va a ocurrir', function (): void {
    foreach (['Carriers' => 'carriers', 'Customers' => 'customers'] as $carpeta => $ns) {
        $fuente = (string) file_get_contents(raizBorrado()."/resources/js/pages/App/{$carpeta}/Show.tsx");

        test()->assertStringContainsString(
            'blocking: Record<string, number>',
            $fuente,
            "{$carpeta}/Show.tsx no recibe lo que bloquea.",
        );

        test()->assertStringContainsString(
            "t('{$ns}.openWork.blockedTitle')",
            $fuente,
            "{$carpeta}/Show.tsx no dice por qué no se puede borrar.",
        );

        // La CONDICIÓN, no solo el texto.
        //
        // La primera versión comparaba posiciones y el sabotaje `if (false &&
        // abierto.length > 0)` pasó en verde: el texto seguía donde estaba y la
        // rama ya no se alcanzaba nunca. Se fija la condición exacta.
        test()->assertStringContainsString(
            'if (abierto.length > 0) {',
            $fuente,
            "{$carpeta}: la rama que corta antes del botón tiene que depender de que HAYA trabajo abierto.",
        );

        // Y va antes del botón: después, no se vería nunca.
        $posAviso = strpos($fuente, 'if (abierto.length > 0) {');
        $posBoton = strpos($fuente, 'if (!armed) {');

        expect($posAviso)->toBeInt()->and($posBoton)->toBeInt();
        expect($posAviso)->toBeLessThan($posBoton, "{$carpeta}: el aviso tiene que cortar antes de ofrecer el botón.");
    }
});

it('cada clase de trabajo abierto tiene texto en los dos idiomas', function (): void {
    $clases = [
        'carriers' => ['loads', 'settlements', 'invoices'],
        'customers' => ['loads'],
    ];

    foreach ($clases as $ns => $suyas) {
        foreach (['es', 'en'] as $idioma) {
            $d = json_decode((string) file_get_contents(raizBorrado()."/lang/{$idioma}/{$ns}.json"), true);

            foreach (['cannotDelete', 'blockedTitle', 'blockedHint'] as $clave) {
                expect($d['openWork'][$clave] ?? null)->toBeString("Falta {$ns}.openWork.{$clave} en {$idioma}.");
            }

            foreach ($suyas as $clase) {
                // La base y su hermana `One`: la concordancia de número la
                // aplican el servidor y el cliente sobre el mismo diccionario.
                expect($d['openWork'][$clase] ?? null)->toBeString("Falta {$ns}.openWork.{$clase} en {$idioma}.");
                expect($d['openWork'][$clase.'One'] ?? null)->toBeString("Falta el singular {$ns}.openWork.{$clase}One en {$idioma}.");
            }
        }
    }
});

/* ── Ninguna ficha nueva se borra sin comprobar nada ─────────────────────── */

it('todo borrado de ficha comprueba sus dependencias y está declarado', function (): void {
    $sinDeclarar = [];

    foreach (glob(raizBorrado().'/app/Http/Controllers/App/*Controller.php') ?: [] as $fichero) {
        $fuente = Source::sinComentarios($fichero);
        $nombre = basename($fichero, '.php');

        // Solo el borrado de una FICHA: `destroy()` a secas. `destroyMedia`,
        // `destroyReceipt` y `destroyPaper` descuelgan un papel de una fila que
        // sigue viva, y eso es otra pregunta.
        if (preg_match('/public function destroy\(/', $fuente) !== 1) {
            continue;
        }

        // UserController::destroy retira una invitación pendiente: no borra una
        // ficha, borra una pertenencia sin aceptar. LoadDocumentController
        // descuelga un enlace de rastreo.
        if (in_array($nombre, ['UserController', 'LoadDocumentController'], true)) {
            continue;
        }

        if (! array_key_exists($nombre, BORRADOS_DE_FICHA)) {
            $sinDeclarar[] = $nombre;
        }
    }

    expect($sinDeclarar)->toBe(
        [],
        "Estos controladores borran una ficha y no declaran qué comprueban antes:\n  ".
        implode("\n  ", $sinDeclarar).
        "\nBorrar algo con trabajo abierto colgando deja la aplicación diciendo dos cosas distintas ".
        'sobre lo mismo — ver docs/open-work.md.',
    );
});

it('cada declarado comprueba de verdad algo antes de borrar', function (): void {
    foreach (array_keys(BORRADOS_DE_FICHA) as $nombre) {
        $fichero = raizBorrado()."/app/Http/Controllers/App/{$nombre}.php";

        test()->assertFileExists($fichero, "{$nombre} ya no existe: quítalo de BORRADOS_DE_FICHA.");

        $fuente = Source::compacta($fichero);

        // O pasa por la pieza, o cuenta por su cuenta y SE NIEGA POR LO QUE
        // CONTÓ. La retrorreferencia es lo que hace falta: la primera versión
        // aceptaba `exists();if(` y el sabotaje `if (false)` pasó en verde
        // —seguía contando y ya no miraba el resultado—.
        $comprueba = str_contains($fuente, 'OpenWork::for')
            || preg_match('/\$(\w+)=DB::table\([^;]+;if\(\$\1\)/', $fuente) === 1
            || preg_match('/\$(\w+)=DB::table\([^;]+;if\(\$\1>0\)/', $fuente) === 1;

        expect($comprueba)->toBeTrue(
            "{$nombre} borra sin comprobar dependencias, y su motivo declarado dice que sí lo hace.",
        );
    }
});

it('cada motivo dice qué comprueba', function (): void {
    foreach (BORRADOS_DE_FICHA as $nombre => $motivo) {
        expect(strlen($motivo))->toBeGreaterThan(
            50,
            "{$nombre}: el motivo tiene que decir QUÉ se comprueba y por qué esa pregunta y no otra.",
        );
    }
});
