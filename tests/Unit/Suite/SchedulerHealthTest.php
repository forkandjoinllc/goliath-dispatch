<?php

declare(strict_types=1);

use Tests\Support\Source;

/**
 * Un barrido que dejó de correr tiene que decirlo.
 *
 * ## El defecto
 *
 * La pantalla de salud enseñaba la última ejecución de cada tarea con la
 * insignia del `status` GUARDADO. Una tarea que corrió bien el 14 de agosto y a
 * la que se le rompió el cron seguía saliendo en VERDE, con «correcta» y una
 * fecha vieja al lado: las dos piezas del problema, sin juntar. Casi nadie las
 * junta.
 *
 * Mientras tanto no salen los avisos de documentos por vencer, ni los de
 * facturas vencidas, ni la revalidación de FMCSA, ni el fin de la prueba de la
 * suscripción — todo eso lo escribe `notifications:sweep`.
 *
 * Y había un segundo agujero encima: la lista de tareas vigiladas era una COPIA
 * a mano de `routes/console.php`.
 *
 *     private const TAREAS = ['notifications:sweep', 'retention:sweep'];
 *
 * Un `Schedule::command()` nuevo corría en el servidor y no aparecía en ninguna
 * pantalla. La pantalla que existe para vigilar lo que corre solo no vigilaba
 * lo que no le hubieran contado.
 *
 * `tests/Unit` no arranca la aplicación: se lee el código.
 */
function raizPlanificador(): string
{
    return Source::root();
}

/* ── La lista sale del planificador ──────────────────────────────────────── */

it('la pantalla de salud no lleva su propia lista de tareas', function (): void {
    $codigo = Source::compacta(raizPlanificador().'/app/Http/Controllers/Platform/HealthController.php');

    expect(str_contains($codigo, 'constTAREAS='))->toBeFalse(
        'Volvió la lista escrita a mano. Un Schedule::command() nuevo corre en el servidor y no aparece en '
        .'ninguna pantalla: si se le rompe el cron, nadie se entera.'
    );

    expect(str_contains($codigo, 'ScheduledTasks::all()'))->toBeTrue(
        'La pantalla dejó de preguntarle al planificador qué hay programado.'
    );
});

it('las tareas se leen del planificador de Laravel, no de un fichero', function (): void {
    $codigo = Source::compacta(raizPlanificador().'/app/Support/Platform/ScheduledTasks.php');

    expect(str_contains($codigo, 'app(Schedule::class)->events()'))->toBeTrue(
        'ScheduledTasks dejó de leer del planificador. Cualquier otra fuente es una segunda lista.'
    );

    // El nombre se cruza con los comandos REGISTRADOS: `Event::$command` es la
    // línea entera —binario, artisan, nombre— y sacarlo con una expresión
    // regular funciona hasta que cambia el formato.
    expect(str_contains($codigo, 'Artisan::all()'))->toBeTrue();
});

/* ── «Con retraso» es un estado, no una fecha que hay que interpretar ────── */

it('el estado que se pinta se calcula, no se lee de la fila', function (): void {
    $codigo = Source::compacta(raizPlanificador().'/app/Support/Platform/ScheduledRuns.php');

    foreach (["'late'", "'stalled'", "'neverRan'", "'ok'"] as $estado) {
        expect(str_contains($codigo, $estado))->toBeTrue(
            "Desapareció el estado {$estado}. Sin él la pantalla vuelve a enseñar la insignia guardada, y "
            .'un cron muerto sale en verde con una fecha vieja al lado.'
        );
    }

    expect(str_contains($codigo, 'ScheduledTasks::nextAfter('))->toBeTrue(
        'El retraso dejó de calcularse con la expresión de cron de cada tarea. Con un plazo fijo, la '
        .'semanal saldría con retraso cada martes.'
    );
});

it('una expresión de cron que no se entiende no inventa una alarma', function (): void {
    $codigo = Source::compacta(raizPlanificador().'/app/Support/Platform/ScheduledTasks.php');

    // `nextAfter()` devuelve nulo si no puede leer la expresión, y `estado()`
    // solo dice «late» cuando SÍ hay fecha. Convertir «no sé» en «va con
    // retraso» es dar una alarma a partir de no saber.
    expect(str_contains($codigo, 'catch(Throwable){returnnull;}'))->toBeTrue(
        'nextAfter() dejó de devolver nulo ante una expresión que no entiende.'
    );
});

it('la pantalla pinta en verde solo lo que está bien', function (): void {
    $pantalla = Source::compacta(raizPlanificador().'/resources/js/pages/Platform/Health.tsx');

    expect(str_contains($pantalla, 'platform.health.state.'))->toBeTrue(
        'La pantalla volvió a pintar el status guardado en vez del estado calculado.'
    );

    // POR ENTRADA, no contando apariciones en el bloque entero.
    //
    // La primera versión de esta comprobación recortaba el mapa con una
    // expresión regular y contaba cuántas veces salía `success-`. La regla
    // perezosa cerraba en la PRIMERA llave —la de `ok`— así que medía una
    // entrada creyendo medir seis: se pintó «con retraso» en verde y la
    // comprobación siguió pasando. La destapó el sabotaje.
    foreach (['late', 'stalled', 'failed', 'neverRan'] as $estado) {
        preg_match("/{$estado}:\{caja:'([^']*)',marca:'([^']*)'\}/", $pantalla, $entrada);

        expect($entrada)->not->toBeEmpty("No se encontró el tono de «{$estado}» en el mapa.");

        expect(str_contains($entrada[1].$entrada[2], 'success-'))->toBeFalse(
            "«{$estado}» se pinta en verde. Solo «correcta» puede serlo: en cuanto un cron muerto tiene "
            .'aspecto de cron sano, vuelve el problema entero.'
        );
    }

    preg_match("/ok:\{caja:'([^']*)',marca:'([^']*)'\}/", $pantalla, $bien);

    expect($bien)->not->toBeEmpty();
    expect(str_contains($bien[2], 'success-'))->toBeTrue(
        'Ni «correcta» sale en verde. Si nada se distingue, la pantalla deja de decir algo.'
    );
});

it('cada estado y cada cadencia tienen rótulo en los dos idiomas', function (): void {
    foreach (['en', 'es'] as $idioma) {
        $d = json_decode(
            (string) file_get_contents(raizPlanificador()."/lang/{$idioma}/platform.json"), true
        );

        foreach (['ok', 'running', 'late', 'stalled', 'failed', 'neverRan'] as $estado) {
            expect($d['health']['state'][$estado] ?? null)->not->toBeNull(
                "Falta el rótulo del estado «{$estado}» en {$idioma}/platform.json."
            );
        }

        foreach (['daily', 'weekly', 'monthly', 'hourly', 'custom'] as $cadencia) {
            expect($d['health']['cadence'][$cadencia] ?? null)->not->toBeNull(
                "Falta la cadencia «{$cadencia}» en {$idioma}/platform.json."
            );
        }
    }
});
