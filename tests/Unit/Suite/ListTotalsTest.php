<?php

declare(strict_types=1);

use Tests\Support\Source;

/**
 * Ninguna pantalla de dinero suma por un camino distinto del que lista.
 *
 * ## El defecto
 *
 * Cuatro pantallas enseñan una fila de totales encima de la lista. Los filtros
 * vivían EN LÍNEA dentro de `index()`, así que la suma —que se construía desde
 * `scoped()` por su cuenta— no tenía forma de reutilizarlos:
 *
 *  - gastos y cobros no aplicaban NINGUNO;
 *  - facturas y liquidaciones llevaban su propia COPIA del de estado e
 *    ignoraban la búsqueda y «solo vencidas».
 *
 * Medido en la demostración: filtrar cobros por «en disputa» dejaba la lista
 * vacía y encima seguía poniendo «En casa 1.721,74 $».
 *
 * Y el comentario que hay encima de la llamada en facturas decía, con esas
 * palabras, «los totales se calculan sobre TODO el filtro, no sobre la
 * página» — cierto para uno de sus tres filtros.
 *
 * ## Lo que vigila este fichero
 *
 * Que los filtros de cada pantalla vivan en UN método, que la suma pase por él,
 * y que no quede ninguna copia suelta de un filtro dentro de `totals()`.
 */
function raizSumas(): string
{
    return Source::root();
}

/**
 * Las cuatro pantallas de dinero con fila de totales.
 *
 * @return array<string, string>
 */
function pantallasConSumas(): array
{
    return [
        'gastos' => 'app/Http/Controllers/App/ExpenseController.php',
        'cobros' => 'app/Http/Controllers/App/PaymentController.php',
        'facturas' => 'app/Http/Controllers/App/InvoiceController.php',
        'liquidaciones' => 'app/Http/Controllers/App/SettlementController.php',
    ];
}

it('las cuatro tienen sus filtros en un método, no sueltos en index()', function (): void {
    // Sueltos en `index()` no hay nada que reutilizar, y esa es la razón de que
    // la suma no los aplicara: no es que a alguien se le olvidara, es que no
    // podía.
    foreach (pantallasConSumas() as $nombre => $ruta) {
        $fuente = Source::compacta(raizSumas().'/'.$ruta);

        test()->assertStringContainsString(
            'privatefunctionapplyFilters(',
            $fuente,
            "La pantalla de {$nombre} no tiene sus filtros en un método.",
        );
        test()->assertStringContainsString(
            '$this->applyFilters($query,$filters)',
            $fuente,
            "La lista de {$nombre} no pasa por su propio applyFilters().",
        );
    }
});

it('la suma de las cuatro pasa por los mismos filtros que la lista', function (): void {
    foreach (pantallasConSumas() as $nombre => $ruta) {
        $fuente = Source::compacta(raizSumas().'/'.$ruta);

        test()->assertStringContainsString(
            '$this->totals(tap($this->scoped(',
            $fuente,
            "La suma de {$nombre} no se construye sobre la consulta filtrada.",
        );
        test()->assertStringContainsString(
            'fn(Builder$q)=>$this->applyFilters($q,$filters)',
            $fuente,
            "La suma de {$nombre} no aplica los filtros de la pantalla.",
        );
    }
});

it('ningún totals() se queda con su propia copia de un filtro', function (): void {
    // Facturas y liquidaciones la tenían: `totals()` recibía `$filters` y
    // aplicaba SOLO el de estado. Media suma filtrada es peor que ninguna,
    // porque la parte que responde al filtro hace creer que la otra también.
    foreach (pantallasConSumas() as $nombre => $ruta) {
        $fuente = Source::sinComentarios(raizSumas().'/'.$ruta);

        preg_match('/private function totals\(([^)]*)\)/', $fuente, $m);

        test()->assertNotEmpty($m, "No se encuentra el totals() de {$nombre}.");
        test()->assertStringNotContainsString(
            '$filters',
            $m[1],
            "El totals() de {$nombre} vuelve a recibir los filtros: si los recibe, puede aplicar solo algunos.",
        );
    }
});

it('el comentario de facturas ya no promete lo que no hacía', function (): void {
    // Decía «los totales se calculan sobre TODO el filtro» cuando aplicaba uno
    // de tres. Ahora es verdad, y se dice que antes no lo era.
    $facturas = Source::sinComentarios(raizSumas().'/app/Http/Controllers/App/InvoiceController.php');

    // La copia del filtro de estado dentro de totals() ha desaparecido.
    $cuerpo = cuerpoDeSumas($facturas, 'private function totals(', 'private function lines(');

    expect($cuerpo)->not->toContain('invoices.status');
    expect($cuerpo)->toContain('sum(total_cents)');
});

it('la suma se reordena antes de agregar', function (): void {
    // Sin `reorder()`, el `order by` de la lista viaja a una consulta de
    // agregado y MySQL se queja o hace trabajo de más. Estaba bien en las
    // cuatro y se fija para no perderlo al mover el código.
    foreach (pantallasConSumas() as $nombre => $ruta) {
        $fuente = Source::compacta(raizSumas().'/'.$ruta);

        test()->assertStringContainsString(
            '->reorder()',
            $fuente,
            "La suma de {$nombre} no reordena antes de agregar.",
        );
    }
});

/**
 * El cuerpo de un método, con sus DOS fronteras.
 *
 * Cortar hasta el final del fichero se traga los métodos de abajo. Ver
 * `docs/testing.md`.
 */
function cuerpoDeSumas(string $fuente, string $desde, string $hasta): string
{
    $i = strpos($fuente, $desde);
    $f = strpos($fuente, $hasta);

    expect($i)->not->toBeFalse();
    expect($f)->not->toBeFalse();
    expect($i)->toBeLessThan($f);

    return substr($fuente, $i, $f - $i);
}
