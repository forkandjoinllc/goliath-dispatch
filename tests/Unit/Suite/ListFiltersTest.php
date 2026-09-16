<?php

declare(strict_types=1);

use Tests\Support\Source;

use function PHPUnit\Framework\assertStringContainsString;
use function PHPUnit\Framework\assertStringNotContainsString;

/**
 * Cambiar un filtro no puede perder los demás.
 *
 * ## El defecto
 *
 * Cada listado escribía su navegación a mano, con la lista de filtros que su
 * autor tenía delante:
 *
 * ```tsx
 * router.get('/invoices', { search, status: e.target.value }, …)
 * ```
 *
 * `overdue` no está ahí. Se llega a él desde la tarjeta «Facturas vencidas» del
 * panel: la lista sale con siete filas y **dos sumas de dinero calculadas sobre
 * ese filtro**, y en cuanto alguien teclea una letra el filtro desaparece en
 * silencio — la lista pasa a todas las facturas y los totales saltan. El
 * paginador de esa misma pantalla sí lo conservaba, así que se contradecía
 * consigo misma.
 *
 * Liquidaciones tiraba la búsqueda al tocar el estado. Gastos arrastraba un
 * `load` que ningún control podía limpiar.
 *
 * ## La regla, que ya estaba escrita en la pantalla de al lado
 *
 * El listado de cargas tiene el MISMO caso —`?uninvoiced=1` desde el panel— y lo
 * resuelve, con el motivo escrito al lado: «quien aterriza aquí ve una lista
 * corta y no sabe que está recortada — que es la otra forma de que un número y
 * una lista se contradigan».
 */
function raizFiltros(): string
{
    return Source::root();
}

function pantallaDeLista(string $ruta): string
{
    $texto = (string) file_get_contents(raizFiltros().'/'.$ruta);
    $texto = (string) preg_replace('#/\*.*?\*/#s', '', $texto);

    return (string) preg_replace('#^\s*//.*$#m', '', $texto);
}

/** Los cuatro listados que reconstruían la consulta a mano. */
const LISTADOS = [
    'resources/js/pages/App/Invoices/Index.tsx' => '/invoices',
    'resources/js/pages/App/Settlements/Index.tsx' => '/settlements',
    'resources/js/pages/App/Expenses/Index.tsx' => '/expenses',
];

it('ninguna pantalla reconstruye la consulta con una lista escrita a mano', function (): void {
    foreach (LISTADOS as $ruta => $url) {
        $pantalla = pantallaDeLista($ruta);

        // La forma del defecto: `router.get('/x', { … }` con un objeto literal
        // que enumera filtros. Se permite `{}`, que es el botón de limpiar.
        expect(preg_match("#router\.get\('{$url}', \{ [a-z]#", $pantalla))
            ->toBe(0, "{$ruta} vuelve a enumerar los filtros a mano");

        assertStringContainsString("navegar('{$url}', filters,", $pantalla, "{$ruta} no usa el ayudante");
    }
});

it('el ayudante parte de TODOS los filtros y limpia los vacíos', function (): void {
    $fuente = pantallaDeLista('resources/js/lib/filters.ts');

    // Lo que no se toca, no se pierde.
    assertStringContainsString('{ ...filtros, ...cambios }', $fuente);

    // Y una dirección con `?status=&search=` se comparte mal y se lee peor.
    assertStringContainsString("if (siguiente[clave] === '') {", $fuente);
    assertStringContainsString('delete siguiente[clave]', $fuente);
});

it('los filtros sin control propio se dicen en pantalla', function (): void {
    $facturas = pantallaDeLista('resources/js/pages/App/Invoices/Index.tsx');
    $gastos = pantallaDeLista('resources/js/pages/App/Expenses/Index.tsx');

    // Un filtro invisible con una suma de dinero encima es la versión cara del
    // problema: un recuento desconcierta, una suma se apunta.
    assertStringContainsString("{filters.overdue === '1' ? (", $facturas);
    assertStringContainsString("{t('invoices.index.overdue')}", $facturas);

    assertStringContainsString("{filters.load !== '' ? (", $gastos);
    assertStringContainsString("{t('expenses.index.filtered')}", $gastos);
});

it('las tres ofrecen quitar los filtros', function (): void {
    foreach (LISTADOS as $ruta => $url) {
        $pantalla = pantallaDeLista($ruta);

        assertStringContainsString('hayFiltros(filters)', $pantalla, "{$ruta} no ofrece limpiar");
        assertStringContainsString("router.get('{$url}', {}", $pantalla);
    }
});

it('la pantalla declara los filtros que el servidor le manda', function (): void {
    $facturas = pantallaDeLista('resources/js/pages/App/Invoices/Index.tsx');
    $controlador = Source::compacta(raizFiltros().'/app/Http/Controllers/App/InvoiceController.php');

    // El tipo no declaraba `overdue`, y un filtro que el tipo no nombra es un
    // filtro que nadie recuerda al escribir la siguiente navegación.
    assertStringContainsString('overdue: string', $facturas);
    assertStringContainsString("'overdue'=>\$request->query('overdue')==='1'?'1':''", $controlador);
});

it('el paginador y los controles usan los mismos filtros', function (): void {
    $facturas = pantallaDeLista('resources/js/pages/App/Invoices/Index.tsx');

    // El paginador SIEMPRE conservó `overdue` —`params={{ ...filters }}`— y los
    // controles no: la pantalla se contradecía consigo misma según por dónde se
    // tocara.
    assertStringContainsString('params={{ ...filters }}', $facturas);
    assertStringNotContainsString('status: filters.status }', $facturas);
});
