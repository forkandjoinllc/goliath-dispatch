<?php

declare(strict_types=1);

use App\Support\Loads\LoadClock;
use App\Support\Loads\StopClock;
use Tests\Support\Source;

use function PHPUnit\Framework\assertSame;
use function PHPUnit\Framework\assertStringContainsString;
use function PHPUnit\Framework\assertStringNotContainsString;

/**
 * Las horas de una carga, cada una en su reloj.
 *
 * ## El defecto
 *
 * El mismo que `StopClock` arregló para las paradas, un nivel más arriba y sin
 * arreglar. En la ficha de la carga, cuatro filas seguidas sin una sola etiqueta
 * de huso: `planned_*` es hora de pared —la teclea el despachador en un
 * `datetime-local` y el propio formulario la devuelve con `slice(0, 16)`— y
 * `actual_*` lo escribe el servidor con `now()` sobre `app.timezone = UTC`.
 *
 * La pantalla les aplicaba a las cuatro la misma conversión de navegador:
 *
 * ```
 * Recogida prevista   16 sep, 1:00     (se guardó 06:00)
 * Recogida real       16 sep, 6:05     (se guardó 11:05 UTC)
 * ```
 *
 * Cinco minutos de retraso, leídos como cinco horas, en la pantalla más usada.
 *
 * Y en el listado, `day()` sobre el instante: una recogida planificada a las
 * 02:00 salía con la fecha del día ANTERIOR.
 *
 * ## Lo que vigila este fichero
 *
 * Que cada hora pase por la pieza que decide su reloj, que la pantalla no vuelva
 * a construir una fecha, y que el valor crudo siga saliendo para el formulario
 * —que es lo que impide que abrir la pantalla de edición mueva la hora—.
 */
function raizRelojCarga(): string
{
    return Source::root();
}

it('lo previsto no se convierte y lo real sí', function (): void {
    // La ventana del muelle se recorta, no se mueve: son las 06:00 del sitio
    // donde ocurre la cosa.
    $previsto = LoadClock::previsto('2026-09-16 06:00:00.000', 'America/Chicago');
    assertSame('2026-09-16 06:00', $previsto['at']);
    assertSame('CDT', $previsto['zone']);

    // Y el instante UTC se lleva a ESE muelle, para que la comparación entre
    // las dos filas sea la que el ojo espera: 06:05, no 11:05.
    $real = LoadClock::real('2026-09-16 11:05:00.000', 'America/Chicago');
    assertSame('2026-09-16 06:05', $real['at']);
    assertSame('CDT', $real['zone']);

    // Cinco minutos. Antes de este lote la ficha enseñaba 1:00 y 6:05.
    expect(substr((string) $real['at'], 11))->toBe('06:05');
});

it('la maquinaria es la de las paradas, no una copia', function (): void {
    $fuente = Source::compacta(raizRelojCarga().'/app/Support/Loads/LoadClock.php');

    // Dos piezas contestando «¿en qué reloj está esta hora?» acaban
    // contestando distinto, y el día que pase las paradas y la carga dirán
    // horas diferentes de la misma recogida.
    expect($fuente)->toContain('StopClock::window($valor)');
    expect($fuente)->toContain('StopClock::moment($utc,$timezone)');
    expect($fuente)->toContain('StopClock::label($timezone');

    // El comprobante es de oficina y va en el reloj de quien mira.
    expect($fuente)->toContain('Clock::at($utc,$timezone)');
});

it('el huso sale de la parada que corresponde', function (): void {
    $fuente = Source::compacta(raizRelojCarga().'/app/Support/Loads/LoadClock.php');

    // La recogida toma el huso de la primera parada de RECOGIDA y la entrega el
    // de la primera de ENTREGA. Con un solo huso para las dos, una carga de
    // Laredo a Nueva York enseñaría la entrega en hora de Texas.
    expect($fuente)->toContain("'pickup'=>self::primera(\$filas,'pickup')");
    expect($fuente)->toContain("'delivery'=>self::primera(\$filas,'delivery')");
    expect($fuente)->toContain("->orderBy('sequence')");

    // Sin huso en la fila cae al de `StopClock`, que es el de las paradas y no
    // el del reloj general. Son dos valores distintos a propósito.
    expect(StopClock::POR_OMISION)->toBe('America/Chicago');
});

it('el listado pide los husos de toda la página de una vez', function (): void {
    $fuente = Source::compacta(raizRelojCarga().'/app/Http/Controllers/App/LoadController.php');

    // Una consulta por fila sería veinticinco consultas por página. La forma en
    // plural existe para eso y el listado tiene que usarla.
    expect($fuente)->toContain('LoadClock::muellesDe(');
    expect($fuente)->toContain('LoadClock::muelles((string)$l->id)');
});

it('la ficha manda las cinco horas resueltas, y el crudo para el formulario', function (): void {
    $fuente = Source::compacta(raizRelojCarga().'/app/Http/Controllers/App/LoadController.php');

    foreach ([
        "'plannedPickup'=>LoadClock::previsto(\$l->planned_pickup_at,\$muelles['pickup'])",
        "'actualPickup'=>LoadClock::real(\$l->actual_pickup_at,\$muelles['pickup'])",
        "'plannedDelivery'=>LoadClock::previsto(\$l->planned_delivery_at,\$muelles['delivery'])",
        "'actualDelivery'=>LoadClock::real(\$l->actual_delivery_at,\$muelles['delivery'])",
        "'podReceived'=>LoadClock::oficina(\$l->pod_received_at,\$actor->timezone)",
    ] as $aguja) {
        assertStringContainsString($aguja, $fuente);
    }

    // Y el valor crudo SIGUE saliendo: este payload alimenta el formulario de
    // edición, y ahí la hora tiene que volver tal cual salió. Es la misma razón
    // por la que `windowStart` de las paradas va sin recortar.
    assertStringContainsString("'plannedPickupAt'=>\$l->planned_pickup_at?->toIso8601String()", $fuente);
});

it('las dos pantallas ya no construyen la hora', function (): void {
    $ficha = (string) file_get_contents(raizRelojCarga().'/resources/js/pages/App/Loads/Show.tsx');
    $lista = (string) file_get_contents(raizRelojCarga().'/resources/js/pages/App/Loads/Index.tsx');

    // La ficha pinta lo que el servidor ya resolvió, con la etiqueta al lado.
    assertStringContainsString('{reloj(load.clock.plannedPickup)}', $ficha);
    assertStringContainsString('{reloj(load.clock.actualPickup)}', $ficha);
    assertStringContainsString('`${v.at} ${v.zone}`', $ficha);

    // Y ninguna de las dos vuelve a pasar esas columnas por `dt()` / `day()`,
    // que es lo que las movía.
    assertStringNotContainsString('dt(load.plannedPickupAt)', $ficha);
    assertStringNotContainsString('dt(load.actualPickupAt)', $ficha);
    assertStringNotContainsString('dt(load.podReceivedAt)', $ficha);

    // En el listado, medianoche LOCAL sobre un valor que ya viene en el reloj
    // correcto. Sin el `T00:00:00` la fecha se vuelve a mover.
    assertStringContainsString('new Date(`${v.at.slice(0, 10)}T00:00:00`)', $lista);
});
