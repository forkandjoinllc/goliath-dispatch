<?php

declare(strict_types=1);

use Tests\Support\Source;

/**
 * Ninguna pantalla cuenta sus atajos por su cuenta.
 *
 * ## El defecto
 *
 * Cinco pantallas —cargas, documentos, transportistas, conductores y equipo—
 * escribían su propio `facets()`, y las cinco cometían el mismo error: contar
 * con el ámbito del actor y SIN los demás filtros activos, mientras que pulsar
 * el atajo los conserva.
 *
 * Medido en la demostración, con un cliente elegido en cargas: la lista
 * enseñaba tres filas, encima ponía «Todas (11)», y «Pagadas (3)» llevaba a
 * cero filas.
 *
 * Cinco copias del mismo error no es mala suerte: es lo que pasa cuando la
 * regla no vive en ningún sitio. Por eso el arreglo no es corregir cinco
 * métodos sino que no haya cinco.
 *
 * ## Lo que vigila este fichero
 *
 * Que las cinco pasen por `FacetCounts`, que ninguna se guarde una consulta
 * agrupada propia, y que el vaciado de la fila —la mitad que se olvida— siga
 * viviendo dentro del ayudante y no en quien llama.
 */
function raizAtajos(): string
{
    return Source::root();
}

/**
 * Las cinco pantallas con fila de atajos.
 *
 * @return array<string, string>
 */
function pantallasConAtajos(): array
{
    return [
        'cargas' => 'app/Http/Controllers/App/LoadController.php',
        'documentos' => 'app/Http/Controllers/App/DocumentController.php',
        'transportistas' => 'app/Http/Controllers/App/CarrierController.php',
        'conductores' => 'app/Http/Controllers/App/DriverController.php',
        'equipo' => 'app/Http/Controllers/App/EquipmentController.php',
    ];
}

it('las cinco pantallas cuentan sus atajos con el ayudante', function (): void {
    foreach (pantallasConAtajos() as $nombre => $ruta) {
        $fuente = Source::compacta(raizAtajos().'/'.$ruta);

        test()->assertStringContainsString(
            'FacetCounts::fila(',
            $fuente,
            "La pantalla de {$nombre} cuenta sus atajos por su cuenta.",
        );
    }
});

it('ninguna se guarda su propia consulta agrupada', function (): void {
    // Era la forma exacta del defecto: `groupBy` sobre el ámbito pelado, sin
    // los filtros de la pantalla. Si vuelve a aparecer en un controlador, ha
    // vuelto el defecto.
    foreach (pantallasConAtajos() as $nombre => $ruta) {
        $fuente = Source::compacta(raizAtajos().'/'.$ruta);

        test()->assertStringNotContainsString(
            "->groupBy('status')",
            $fuente,
            "La pantalla de {$nombre} vuelve a agrupar por su cuenta.",
        );
        test()->assertStringNotContainsString(
            "->groupBy('review_status')",
            $fuente,
            "La pantalla de {$nombre} vuelve a agrupar por su cuenta.",
        );
        test()->assertStringNotContainsString(
            "->groupBy('onboarding_status')",
            $fuente,
            "La pantalla de {$nombre} vuelve a agrupar por su cuenta.",
        );
    }
});

it('cada pantalla le pasa sus filtros al ayudante', function (): void {
    // Un `facets()` que no recibe los filtros no puede aplicarlos, y esa era
    // la firma anterior en las cinco.
    foreach (pantallasConAtajos() as $nombre => $ruta) {
        $fuente = Source::compacta(raizAtajos().'/'.$ruta);

        test()->assertStringContainsString(
            '$this->facets($checker,$actor,$scope,',
            $fuente,
            "La pantalla de {$nombre} no llama a su facets() como se espera.",
        );
        test()->assertStringContainsString(
            '$filters)',
            $fuente,
            "La pantalla de {$nombre} llama a facets() sin pasarle los filtros.",
        );
        test()->assertStringContainsString(
            'array$filters):array',
            $fuente,
            "El facets() de {$nombre} no recibe los filtros.",
        );
    }
});

it('el vaciado de la fila vive dentro del ayudante', function (): void {
    // La mitad que se olvida. Si el vaciado se hiciera fuera, bastaría con que
    // una de las cinco lo hiciera distinto para que volviera el defecto sin
    // que nada se pusiera rojo.
    $ayudante = Source::compacta(raizAtajos().'/app/Support/Lists/FacetCounts.php');

    expect($ayudante)->toContain('foreach($controlaas$clave){$base[$clave]=\'\';}');

    // Y se hace ANTES de contar nada.
    $vaciado = strpos($ayudante, '$base[$clave]=\'\';');
    $agrupado = strpos($ayudante, '$consulta($base)');

    expect($vaciado)->not->toBeFalse();
    expect($agrupado)->not->toBeFalse();
    expect($vaciado)->toBeLessThan($agrupado);
});

it('«todas» suma todos los grupos, no solo los que tienen atajo', function (): void {
    // Un estado sin atajo sigue estando en la lista. Sumar solo los valores
    // enseñados dejaría «Todas» por debajo de lo que la lista devuelve.
    $ayudante = Source::compacta(raizAtajos().'/app/Support/Lists/FacetCounts.php');

    expect($ayudante)->toContain("'all'=>(int)array_sum(\$agrupado)");
    expect($ayudante)->not->toContain('array_sum($salida)');
});

it('los atajos que encienden otro filtro se cuentan sobre la base vaciada', function (): void {
    // «Vence pronto» apaga el estado al pulsarlo. Contarlo sin vaciar daría la
    // intersección con el estado activo, que no es lo que sale.
    $ayudante = Source::compacta(raizAtajos().'/app/Support/Lists/FacetCounts.php');

    expect($ayudante)->toContain('$consulta([...$base,...$parche])->count()');
    expect($ayudante)->not->toContain('$consulta([...$filtros,...$parche])');
});

it('las dos pantallas de dos claves declaran las dos', function (): void {
    // En documentos, conductores y equipo la fila controla `status` Y
    // `expiring`: pulsar uno apaga el otro. Declarar solo `status` haría que
    // «Aprobados» se contara sobre los que vencen pronto.
    foreach (['documentos' => 'DocumentController', 'conductores' => 'DriverController', 'equipo' => 'EquipmentController'] as $nombre => $clase) {
        $fuente = Source::compacta(raizAtajos()."/app/Http/Controllers/App/{$clase}.php");

        test()->assertStringContainsString(
            "['status','expiring'],",
            $fuente,
            "La fila de {$nombre} no declara las dos claves que controla.",
        );
    }
});
