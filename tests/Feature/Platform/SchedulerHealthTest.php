<?php

declare(strict_types=1);

use App\Support\Platform\ScheduledRuns;
use App\Support\Platform\ScheduledTasks;
use App\Support\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

uses(DatabaseTransactions::class);

beforeEach(fn () => app(TenantContext::class)->forget());
afterEach(fn () => app(TenantContext::class)->forget());

/** Escribe una ejecución del barrido con la antigüedad y el estado que se pidan. */
function ejecucionDeBarrido(string $comando, string $estado, string $empezo, ?string $termino = null): void
{
    DB::table('job_queue')->insert([
        'id' => (string) Str::uuid(),
        'tenant_id' => null,
        'job_type' => ScheduledRuns::PREFIJO.$comando,
        'payload' => json_encode(['avisos' => 3]),
        'status' => $estado,
        'started_at' => $empezo,
        'completed_at' => $termino,
        'created_at' => $empezo,
        'updated_at' => $empezo,
    ]);
}

/** @return array<string, mixed> */
function resumenDeBarrido(string $comando, string $cron = '0 6 * * *'): array
{
    return ScheduledRuns::summary([['command' => $comando, 'expression' => $cron]])[0];
}

/* ── La lista sale del planificador ──────────────────────────────────────── */

it('lee del planificador las tareas que hay programadas', function () {
    $tareas = collect(ScheduledTasks::all());

    // Si mañana se programa un tercer comando, la pantalla lo enseña sin que
    // nadie toque una lista.
    expect(in_array('notifications:sweep', $tareas->pluck('command')->all(), true))->toBeTrue()
        ->and(in_array('retention:sweep', $tareas->pluck('command')->all(), true))->toBeTrue();

    expect($tareas->firstWhere('command', 'notifications:sweep')['expression'])->toBe('0 6 * * *')
        ->and($tareas->firstWhere('command', 'retention:sweep')['expression'])->toBe('0 4 * * 0');
});

it('nombra la cadencia de cada expresión', function () {
    expect(ScheduledTasks::cadence('0 6 * * *'))->toBe('daily')
        ->and(ScheduledTasks::cadence('0 4 * * 0'))->toBe('weekly')
        ->and(ScheduledTasks::cadence('0 4 1 * *'))->toBe('monthly')
        ->and(ScheduledTasks::cadence('*/7 3 * * *'))->toBe('daily')
        // `0 * * * *` es CADA HORA. La primera versión de `cadence()` apilaba
        // cuatro expresiones regulares y esta salía «diaria», porque el `*` de
        // la hora satisface un `\S+` igual que un número.
        ->and(ScheduledTasks::cadence('0 * * * *'))->toBe('hourly')
        // Y lo que no encaja en ninguna se dice, no se aproxima: llamar
        // «cada hora» a un cada-cinco-minutos sería inventar la cadencia.
        ->and(ScheduledTasks::cadence('*/5 * * * *'))->toBe('custom')
        ->and(ScheduledTasks::cadence('raro'))->toBe('custom');
});

/* ── «Con retraso» es un estado ──────────────────────────────────────────── */

it('una tarea diaria que corrió bien hace tres semanas sale CON RETRASO', function () {
    // El caso exacto: corrió bien, la insignia guardada dice «succeeded», y la
    // pantalla la enseñaba en verde con la fecha vieja al lado.
    ejecucionDeBarrido(
        'notifications:sweep', 'succeeded',
        now()->subWeeks(3)->toDateTimeString(),
        now()->subWeeks(3)->addMinutes(2)->toDateTimeString(),
    );

    $r = resumenDeBarrido('notifications:sweep');

    expect($r['state'])->toBe('late')
        ->and($r['status'])->toBe('succeeded')
        ->and($r['dueSince'])->not->toBeNull();
});

it('una tarea diaria que corrió esta mañana está bien', function () {
    ejecucionDeBarrido(
        'notifications:sweep', 'succeeded',
        now()->subMinutes(30)->toDateTimeString(),
        now()->subMinutes(29)->toDateTimeString(),
    );

    expect(resumenDeBarrido('notifications:sweep')['state'])->toBe('ok');
});

it('una tarea semanal no sale con retraso al día siguiente', function () {
    // El plazo sale del cron de CADA tarea. Con un plazo fijo, la semanal
    // saldría con retraso cada martes.
    ejecucionDeBarrido(
        'retention:sweep', 'succeeded',
        now()->subDays(2)->toDateTimeString(),
        now()->subDays(2)->toDateTimeString(),
    );

    expect(resumenDeBarrido('retention:sweep', '0 4 * * 0')['state'])->toBe('ok');
});

it('el margen de gracia evita la falsa alarma de cada mañana', function () {
    // Una tarea de cada cinco minutos que corrió hace media hora SÍ va con
    // retraso; una diaria mirada dos minutos después de su hora, no. El margen
    // existe para lo segundo, no para tapar lo primero.
    ejecucionDeBarrido(
        'notifications:sweep', 'succeeded',
        now()->subMinutes(90)->toDateTimeString(),
        now()->subMinutes(89)->toDateTimeString(),
    );

    expect(resumenDeBarrido('notifications:sweep', '*/5 * * * *')['state'])->toBe('late');
});

/* ── Una ejecución que se murió a mitad ──────────────────────────────────── */

it('una ejecución que empezó y no terminó nunca sale COLGADA', function () {
    // La pantalla la enseñaba en azul, «corriendo», indefinidamente.
    ejecucionDeBarrido('notifications:sweep', 'running', now()->subHours(9)->toDateTimeString());

    expect(resumenDeBarrido('notifications:sweep')['state'])->toBe('stalled');
});

it('una ejecución que empezó hace un minuto sigue corriendo', function () {
    ejecucionDeBarrido('notifications:sweep', 'running', now()->subMinute()->toDateTimeString());

    expect(resumenDeBarrido('notifications:sweep')['state'])->toBe('running');
});

/* ── El orden de los estados ─────────────────────────────────────────────── */

it('un fallo pesa más que el retraso', function () {
    ejecucionDeBarrido('notifications:sweep', 'failed', now()->subWeeks(2)->toDateTimeString());

    // Va con retraso Y falló. Lo que hay que arreglar es el fallo.
    expect(resumenDeBarrido('notifications:sweep')['state'])->toBe('failed');
});

it('la que no ha corrido nunca lo dice, y no sale con retraso', function () {
    $r = resumenDeBarrido('notifications:sweep');

    expect($r['state'])->toBe('neverRan')
        ->and($r['hasEverRun'])->toBeFalse()
        // Sin una ejecución no hay desde dónde contar el retraso. Inventarlo
        // sería dar una alarma a partir de no saber.
        ->and($r['dueSince'])->toBeNull();
});
