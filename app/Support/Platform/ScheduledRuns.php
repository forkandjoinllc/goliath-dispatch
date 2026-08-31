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
     * La última ejecución de cada tarea programada conocida.
     *
     * Devuelve una entrada por tarea ESPERADA, no por tarea que haya corrido:
     * una que no ha corrido nunca es precisamente la que hay que enseñar, y una
     * consulta que agrupa lo que existe la dejaría fuera de la lista.
     *
     * @param  list<string>  $esperadas
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

        foreach ($esperadas as $tarea) {
            $clave = self::PREFIJO.$tarea;
            $fila = $ultimas->firstWhere('job_type', $clave);

            $resumen[] = [
                'task' => $tarea,
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
