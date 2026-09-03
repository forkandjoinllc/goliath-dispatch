<?php

declare(strict_types=1);

namespace App\Support\Platform;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Throwable;

/**
 * El rastro de que una tarea programada corrió.
 *
 * POR QUÉ HACE FALTA. `routes/console.php` lleva desde el lote de avisos con un
 * comentario que dice, literalmente, que sin una línea de cron en el servidor
 * este fichero no se ejecuta nunca «y no lo dice nadie». Eso sigue siendo verdad
 * en producción hoy. Y el problema no es solo que no corra: es que **no corrió
 * nunca** y **corrió y no encontró nada que avisar** producen exactamente el
 * mismo silencio. Sin una fila por ejecución, la campana vacía no distingue una
 * casa tranquila de un cron muerto.
 *
 * DÓNDE SE GUARDA, Y POR QUÉ AHÍ. En `job_queue`, que ya existía en el esquema y
 * cuyas columnas describen exactamente esto: `job_type`, `status` con
 * `succeeded`/`failed` en su CHECK, `started_at`, `completed_at`, `attempts`,
 * `last_error` y un `payload` JSON para lo que la tarea quiera contar. Es una
 * tabla de cola y aquí se escribe trabajo ya hecho, sí — pero un trabajador de
 * cola escribiría estas mismas columnas al terminar, y la diferencia es
 * únicamente que aquí el despachador es el planificador y no hay fase
 * `queued`. Inventar una séptima tabla de «ejecuciones» para repetir estas
 * columnas habría sido peor.
 *
 * `tenant_id` va NULL porque estas tareas son de la plataforma, no de una
 * empresa: el barrido recorre todas. La columna lo admite.
 *
 * `dedupe_key` se deja NULL a propósito. Es única a nivel global, así que
 * ponerle «barrido del día X» impediría registrar una segunda ejecución del
 * mismo día — y una ejecución a mano después de arreglar algo es justo lo que
 * más interesa ver.
 */
final class ScheduledRuns
{
    /** El prefijo distingue una ejecución programada de un trabajo de cola de verdad. */
    public const PREFIJO = 'schedule:';

    /**
     * Envuelve una tarea: anota que empezó, y al terminar cómo acabó.
     *
     * Si la tarea LANZA, se anota `failed` con el mensaje y se vuelve a lanzar.
     * Tragarse la excepción dejaría una fila que dice «falló» y un comando que
     * devuelve éxito, que es la peor de las dos mentiras posibles.
     *
     * @template T
     *
     * @param  callable(): array{0: T, 1: array<string, mixed>}  $tarea  Devuelve [resultado, resumen]
     * @return T
     */
    public static function wrap(string $jobType, callable $tarea): mixed
    {
        $id = (string) Str::uuid();
        $inicio = CarbonImmutable::now();

        DB::table('job_queue')->insert([
            'id' => $id,
            'tenant_id' => null,
            'job_type' => self::PREFIJO.$jobType,
            'payload' => json_encode([]),
            'status' => 'running',
            'run_at' => $inicio,
            'started_at' => $inicio,
            'attempts' => 1,
            'created_at' => $inicio,
            'updated_at' => $inicio,
        ]);

        try {
            [$resultado, $resumen] = $tarea();
        } catch (Throwable $e) {
            DB::table('job_queue')->where('id', $id)->update([
                'status' => 'failed',
                'completed_at' => CarbonImmutable::now(),
                'last_error' => Str::limit($e->getMessage(), 2000),
                'updated_at' => CarbonImmutable::now(),
            ]);

            throw $e;
        }

        DB::table('job_queue')->where('id', $id)->update([
            'status' => 'succeeded',
            'completed_at' => CarbonImmutable::now(),
            'payload' => json_encode($resumen, JSON_UNESCAPED_UNICODE),
            'updated_at' => CarbonImmutable::now(),
        ]);

        return $resultado;
    }

    /**
     * Cuánto se le perdona a una tarea antes de llamarla atrasada.
     *
     * Una hora. Un barrido diario de las 06:00 mirado a las 06:02 puede estar
     * todavía corriendo, y llamarlo «con retraso» sería una falsa alarma cada
     * mañana — que es como se aprende a no mirar una pantalla.
     */
    private const GRACIA_MINUTOS = 60;

    /**
     * Cuánto puede llevar una ejecución «corriendo» antes de darla por colgada.
     *
     * Seis horas. Una fila en `running` con `completed_at` nulo es un proceso
     * que se murió a mitad: nadie la va a cerrar nunca, y la pantalla la
     * enseñaba en azul —«corriendo»— indefinidamente.
     */
    private const COLGADA_HORAS = 6;

    /**
     * La última ejecución de cada tarea programada, y si va con retraso.
     *
     * Devuelve una entrada por tarea ESPERADA, no por tarea que haya corrido:
     * una que no ha corrido nunca es precisamente la que hay que enseñar, y una
     * consulta que agrupa lo que existe la dejaría fuera de la lista.
     *
     * EL ESTADO NO ES EL DE LA FILA. Una tarea que corrió bien el 14 de agosto
     * y a la que se le rompió el cron seguía saliendo con la insignia verde de
     * «correcta» y una fecha vieja al lado: la pantalla enseñaba las dos piezas
     * del problema y dejaba que el lector las juntara. Casi nadie las junta.
     * Por eso `state` es una cosa calculada —`neverRan`, `failed`, `stalled`,
     * `late`, `running`, `ok`— y no el `status` guardado.
     *
     * @param  list<array{command: string, expression: string}>  $esperadas
     * @return list<array<string, mixed>>
     */
    public static function summary(array $esperadas): array
    {
        $ultimas = DB::table('job_queue')
            ->whereNull('tenant_id')
            ->where('job_type', 'like', self::PREFIJO.'%')
            ->orderByDesc('started_at')
            ->limit(500)
            ->get(['job_type', 'status', 'started_at', 'completed_at', 'payload', 'last_error']);

        $resumen = [];

        $ahora = CarbonImmutable::now();

        foreach ($esperadas as $tarea) {
            $clave = self::PREFIJO.$tarea['command'];
            $fila = $ultimas->firstWhere('job_type', $clave);
            $tocaba = self::tocaba($tarea['expression'], $fila);

            $resumen[] = [
                'task' => $tarea['command'],
                'expression' => $tarea['expression'],
                'cadence' => ScheduledTasks::cadence($tarea['expression']),
                'state' => self::estado($fila, $tocaba, $ahora),
                'dueSince' => $tocaba?->format('Y-m-d H:i'),
                'hasEverRun' => $fila !== null,
                'status' => $fila === null ? null : (string) $fila->status,
                'startedAt' => $fila === null ? null : substr((string) $fila->started_at, 0, 16),
                'completedAt' => $fila?->completed_at === null ? null : substr((string) $fila->completed_at, 0, 16),
                'durationSeconds' => self::duracion($fila),
                'summary' => $fila === null ? [] : (json_decode((string) $fila->payload, true) ?: []),
                'lastError' => $fila?->last_error,
                'runCount' => $ultimas->where('job_type', $clave)->count(),
            ];
        }

        return $resumen;
    }

    /**
     * Cuándo tendría que haber vuelto a correr, según su propio cron.
     *
     * Nulo si nunca corrió —no hay desde dónde contar— o si la expresión no se
     * entiende. El plazo sale de la expresión de CADA tarea: con un plazo fijo
     * escrito aquí, la semanal saldría con retraso cada martes.
     */
    private static function tocaba(string $expression, ?object $fila): ?CarbonImmutable
    {
        if ($fila === null || $fila->started_at === null) {
            return null;
        }

        $siguiente = ScheduledTasks::nextAfter(
            $expression,
            CarbonImmutable::parse((string) $fila->started_at)->toDateTime(),
        );

        return $siguiente === null ? null : CarbonImmutable::instance($siguiente);
    }

    /**
     * El estado que se pinta. Calculado, no leído.
     *
     * El orden importa: una tarea que falló Y va con retraso es un fallo, que
     * es lo que hay que arreglar primero. Y una colgada se mira antes que el
     * retraso porque lo explica.
     */
    private static function estado(?object $fila, ?CarbonImmutable $tocaba, CarbonImmutable $ahora): string
    {
        if ($fila === null) {
            return 'neverRan';
        }

        $estado = (string) $fila->status;

        if ($estado === 'failed') {
            return 'failed';
        }

        if ($estado === 'running') {
            $desde = CarbonImmutable::parse((string) $fila->started_at);

            return $desde->addHours(self::COLGADA_HORAS)->isBefore($ahora) ? 'stalled' : 'running';
        }

        if ($tocaba !== null && $tocaba->addMinutes(self::GRACIA_MINUTOS)->isBefore($ahora)) {
            return 'late';
        }

        return 'ok';
    }

    private static function duracion(?object $fila): ?float
    {
        if ($fila === null || $fila->started_at === null || $fila->completed_at === null) {
            return null;
        }

        $inicio = CarbonImmutable::parse((string) $fila->started_at);
        $fin = CarbonImmutable::parse((string) $fila->completed_at);

        return round((float) ($fin->getPreciseTimestamp(3) - $inicio->getPreciseTimestamp(3)) / 1000, 2);
    }
}
