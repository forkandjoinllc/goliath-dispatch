<?php

declare(strict_types=1);

use App\Support\Loads\StopClock;
use Carbon\CarbonImmutable;
use Tests\Support\Source;

/**
 * Dos horas en el mismo renglón tienen que estar en el mismo reloj.
 *
 * ## El defecto
 *
 * En la misma lista, una al lado de la otra y sin etiqueta:
 *
 *  - `window_start` lo escribe el despachador en un `datetime-local` y se
 *    guarda tal cual: es la hora **del muelle**.
 *  - `actual_arrival_at` lo escribe `StopProgress` con `CarbonImmutable::now()`
 *    y `config('app.timezone')` es `UTC`.
 *
 * Comprobado anotando una llegada de verdad sobre una parada de
 * `America/New_York`: ventana 08:00, hora local 09:04 —dentro de la ventana— y
 * se guardó 13:04. En pantalla, cinco horas tarde. En la página PÚBLICA de
 * rastreo, la que abre el cliente sin cuenta.
 *
 * `tests/Unit` no arranca la aplicación para lo que se lee del código; para la
 * conversión sí se llama a la clase, que no necesita base de datos.
 */
function raizReloj(): string
{
    return Source::root();
}

/** Los cuatro sitios que pintan estas horas. */
function superficiesDelReloj(): array
{
    return [
        'Public/TrackingController' => raizReloj().'/app/Http/Controllers/Public/TrackingController.php',
        'App/TrackingController' => raizReloj().'/app/Http/Controllers/App/TrackingController.php',
        'App/LoadController' => raizReloj().'/app/Http/Controllers/App/LoadController.php',
        'RateConfirmation' => raizReloj().'/app/Support/Loads/RateConfirmation.php',
    ];
}

/* ── La conversión hace lo que dice ──────────────────────────────────────── */

it('una llegada en UTC se enseña en la hora del muelle', function (): void {
    // El caso exacto que se midió: 13:04 UTC son las 09:04 en Nueva York.
    expect(StopClock::moment('2026-09-08 13:04:11', 'America/New_York'))->toBe('2026-09-08 09:04');
});

it('la ventana NO se convierte, porque ya es hora del muelle', function (): void {
    // Convertirla también sería el error simétrico: restarle otras cuatro horas
    // a algo que ya estaba bien.
    expect(StopClock::window('2026-09-16 08:00:00.000'))->toBe('2026-09-16 08:00');
});

it('la etiqueta del huso cambia con la estación', function (): void {
    // No basta con guardar «America/Chicago»: la misma parada es CST en enero y
    // CDT en julio, y la diferencia es una hora de verdad.
    expect(StopClock::label('America/Chicago', '2026-01-15 12:00'))->toBe('CST')
        ->and(StopClock::label('America/Chicago', '2026-07-15 12:00'))->toBe('CDT');
});

it('un huso roto en la fila no tumba la pantalla del cliente', function (): void {
    // Esta pantalla la abre alguien sin cuenta, desde un enlace. Un dato malo
    // en una fila no puede dejarle un error 500.
    expect(StopClock::moment('2026-09-08 13:04:11', 'Marte/Olympus'))->toBeString()
        ->and(StopClock::moment('2026-09-08 13:04:11', ''))->toBeString()
        ->and(StopClock::label(null))->toBeString();
});

it('sin huso se usa el mismo que pone el formulario al crear una parada', function (): void {
    // Si el de aquí y el del formulario no coincidieran, una parada creada sin
    // tocar el campo se pintaría en un huso distinto del que se guardó.
    $formulario = file_get_contents(raizReloj().'/resources/js/pages/App/Loads/Form.tsx');

    expect(StopClock::POR_OMISION)->toBe('America/Chicago')
        ->and($formulario)->toContain("timezone: 'America/Chicago'");
});

it('la conversión no pierde el día al cruzar la medianoche', function (): void {
    // 02:00 UTC del día 9 son las 21:00 del día 8 en Chicago. Enseñar el día
    // equivocado en una cita es peor que enseñar la hora equivocada.
    expect(StopClock::moment('2026-09-09 02:00:00', 'America/Chicago'))->toBe('2026-09-08 21:00');
});

/* ── Y ninguna superficie se salta la regla ──────────────────────────────── */

it('ninguna pantalla pinta una llegada sin convertirla', function (): void {
    $malas = [];

    foreach (superficiesDelReloj() as $nombre => $ruta) {
        $codigo = Source::compacta($ruta);

        // El recorte crudo sobre un instante en UTC es exactamente el defecto.
        if (str_contains($codigo, 'substr((string)$s->actual_arrival_at,0,16)')
            || str_contains($codigo, 'substr((string)$s->actual_departure_at,0,16)')) {
            $malas[] = $nombre;
        }
    }

    expect($malas)->toBe([], 'Estas pintan la llegada cruda, que está en UTC: '.implode(', ', $malas));
});

it('las tres pantallas de paradas mandan el huso', function (): void {
    // Sobre la sentencia de LA PARADA, no sobre el fichero: el controlador
    // público tiene otro `StopClock::label(` en el bloque de la última
    // posición, y con la aguja a nivel de fichero el sabotaje que se lo quitaba
    // a las paradas pasaba en verde. Tercera vez que muerde una aguja ancha.
    foreach (['Public/TrackingController', 'App/TrackingController', 'App/LoadController'] as $nombre) {
        $codigo = Source::sinComentarios(superficiesDelReloj()[$nombre]);

        test()->assertStringContainsString(
            "'zone' => StopClock::label(\$s->timezone,",
            $codigo,
            "{$nombre} pinta las horas de las paradas y no dice de qué reloj son."
        );
    }
});

it('el papel de la tarifa también lleva el huso', function (): void {
    // Es el documento que compromete dinero y se le manda a un transportista
    // que puede estar en otro huso.
    $codigo = Source::compacta(superficiesDelReloj()['RateConfirmation']);

    expect($codigo)->toContain("'zone'=>StopClock::label(")
        // Sin el espacio: `compacta()` quita también los espacios, así que
        // `.' '.` queda como `.''.`. Escribir la aguja tal y como se ve en el
        // fichero es lo que la deja sin casar nunca — el motivo por el que
        // existen las dos funciones de Tests\Support\Source.
        ->and($codigo)->toContain(".''.\$s['zone']");
});

it('la cronología tampoco pinta la hora cruda', function (): void {
    // La lista de paradas y la cronología salen de la MISMA página. Arreglar
    // una y dejar la otra convierte una hora mala en dos que se contradicen —
    // que es peor, porque quien lo lee no sabe cuál creerse.
    $codigo = Source::compacta(raizReloj().'/app/Support/Tracking/Timeline.php');

    expect($codigo)->toContain("'at'=>StopClock::moment(\$e->occurred_at,\$huso)")
        ->and($codigo)->toContain("'zone'=>StopClock::label(\$huso,\$e->occurred_at)")
        ->and($codigo)->not->toContain('substr((string)$e->occurred_at,0,16)');
});

it('la última posición del cliente tampoco', function (): void {
    $codigo = Source::compacta(raizReloj().'/app/Http/Controllers/Public/TrackingController.php');

    expect($codigo)->toContain("'at'=>StopClock::moment(\$fila->occurred_at,\$huso)")
        ->and($codigo)->not->toContain('substr((string)$fila->occurred_at,0,16)');
});

/* ── Los rótulos llevan el hueco del huso ────────────────────────────────── */

it('los seis rótulos de hora llevan {zone} en los dos idiomas', function (): void {
    $rotulos = [
        ['publicPage', 'stopWindow'], ['publicPage', 'stopArrived'], ['publicPage', 'stopDeparted'],
        ['stops', 'window'], ['stops', 'arrived'], ['stops', 'departed'],
    ];

    foreach (['en', 'es'] as $idioma) {
        $dic = json_decode((string) file_get_contents(raizReloj()."/lang/{$idioma}/tracking.json"), true);

        foreach ($rotulos as [$seccion, $clave]) {
            $texto = $dic[$seccion][$clave] ?? '';

            // assertStringContainsString y no expect()->toContain(): toContain
            // toma TODOS sus argumentos como agujas y el mensaje se convertía
            // en una segunda que no casa nunca. Cuarta vez que muerde.
            test()->assertStringContainsString(
                '{zone}',
                $texto,
                "falta {zone} en {$seccion}.{$clave} de {$idioma}"
            );
        }
    }
});

it('la ficha de la carga enseña el huso junto a la hora', function (): void {
    $pantalla = file_get_contents(raizReloj().'/resources/js/pages/App/Loads/Show.tsx');

    // `dt()` formatea con Intl en la hora local de QUIEN MIRA, así que sin la
    // etiqueta un despachador en otro huso no sabe de qué reloj habla.
    expect($pantalla)->toContain('{dt(s.actualArrivalAt)} {s.zone}');
});
