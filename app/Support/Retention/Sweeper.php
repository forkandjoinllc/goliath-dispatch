<?php

declare(strict_types=1);

namespace App\Support\Retention;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * El barrido: archivar lo viejo y purgar lo archivado hace mucho.
 *
 * Dos pasadas con naturalezas MUY distintas, y todo el diseño de esta clase sale
 * de esa diferencia:
 *
 *  - **Archivar** es marcar. Pone `archived_at` y `purge_eligible_at`. Se
 *    deshace poniéndolas a nulo. Es reversible y se ejecuta sola cada noche.
 *  - **Purgar** es DELETE. No se deshace de ninguna manera. Va detrás de un
 *    interruptor explícito —`RETENTION_PURGE_ENABLED`, apagado por defecto— y
 *    aunque esté encendido nunca toca nada sin que se cumplan las cuatro
 *    condiciones de abajo.
 *
 * Que la purga esté apagada de fábrica no es cobardía: es que el coste de las
 * dos equivocaciones no se parece en nada. Purgar de menos deja unos gigabytes
 * de más en una tabla. Purgar de más borra la prueba de un pleito. Una empresa
 * enciende la purga el día que ha leído lo que va a borrar, y hasta entonces la
 * pantalla se lo enseña en seco.
 *
 * ## Las cuatro condiciones para purgar una fila
 *
 *  1. Su tabla está en la política Y no es de las intocables (`NEVER_PURGE`).
 *  2. Está archivada, y su `purge_eligible_at` ya pasó.
 *  3. `legal_hold` es 0.
 *  4. Ningún bloqueo vigente cubre su tipo — comprobado APARTE de la columna,
 *     porque la columna es una copia y una copia puede quedarse vieja.
 *
 * La cuarta es deliberadamente redundante con la tercera. En todo lo demás
 * evito comprobar dos veces lo mismo; aquí no, porque el precio de que la copia
 * esté desactualizada es un borrado permanente. Si alguna vez discrepan, gana
 * la que dice «no borres».
 */
final class Sweeper
{
    /** Cuántas filas por tabla y pasada. Un barrido no puede bloquear la base. */
    private const LOTE = 500;

    /**
     * Archiva lo que ha dejado de estar activo, en toda una empresa.
     *
     * @return array<string, array{candidates: int, processed: int, skipped: int}>
     */
    public static function archive(string $tenantId, ?CarbonImmutable $now = null): array
    {
        $now ??= CarbonImmutable::now();
        $politica = Policy::forTenant($tenantId);
        $resumen = [];

        foreach (array_keys(Policy::ENTITIES) as $tabla) {
            $corte = $politica->archiveCutoff($tabla, $now);

            if ($corte === null) {
                continue;
            }

            $edad = Policy::ageColumn($tabla);

            $base = fn () => DB::table($tabla)
                ->where('tenant_id', $tenantId)
                ->whereNull('archived_at')
                ->where($edad, '<', $corte);

            $candidatos = (clone $base())->count();
            $bloqueados = (clone $base())->where('legal_hold', 1)->count();

            $hechos = 0;

            // Por lotes: un UPDATE sobre cien mil filas mantiene la tabla
            // bloqueada el tiempo que tarde, y esto corre de noche pero no en
            // otro planeta.
            do {
                $ids = (clone $base())
                    ->where('legal_hold', 0)
                    ->limit(self::LOTE)
                    ->pluck('id')
                    ->all();

                if ($ids === []) {
                    break;
                }

                DB::table($tabla)->whereIn('id', $ids)->update([
                    'archived_at' => $now,
                    // La fecha de purga se calcula AHORA y se guarda. Si se
                    // calculara al purgar, cambiar la política movería hacia
                    // atrás la fecha de filas archivadas hace años, y un ajuste
                    // de configuración podría borrar mañana lo que hoy estaba a
                    // salvo. Guardada, es una promesa hecha el día del archivado.
                    'purge_eligible_at' => $politica->purgeEligibleAt($tabla, $now),
                    'updated_at' => $now,
                ]);

                $hechos += count($ids);
            } while (count($ids) === self::LOTE);

            if ($candidatos > 0) {
                $resumen[$tabla] = ['candidates' => $candidatos, 'processed' => $hechos, 'skipped' => $bloqueados];
            }
        }

        return $resumen;
    }

    /**
     * Qué se purgaría hoy, SIN purgar nada.
     *
     * Es la pantalla antes del botón. Nadie debería encender una purga sin haber
     * visto antes esta lista, y por eso la lista existe antes que la purga.
     *
     * @return array<string, array{candidates: int, skipped: int}>
     */
    public static function purgeDryRun(string $tenantId, ?CarbonImmutable $now = null): array
    {
        $now ??= CarbonImmutable::now();
        $politica = Policy::forTenant($tenantId);
        $resumen = [];

        foreach (array_keys(Policy::ENTITIES) as $tabla) {
            if (! $politica->canPurge($tabla)) {
                continue;
            }

            $base = fn () => DB::table($tabla)
                ->where('tenant_id', $tenantId)
                ->whereNotNull('archived_at')
                ->whereNotNull('purge_eligible_at')
                ->where('purge_eligible_at', '<=', $now);

            $candidatos = (clone $base())->where('legal_hold', 0)->count();
            $bloqueados = (clone $base())->where('legal_hold', 1)->count();

            if ($candidatos > 0 || $bloqueados > 0) {
                $resumen[$tabla] = ['candidates' => $candidatos, 'skipped' => $bloqueados];
            }
        }

        return $resumen;
    }

    /**
     * Purga de verdad. Irreversible.
     *
     * @return array<string, array{processed: int, skipped: int}>
     */
    public static function purge(string $tenantId, ?CarbonImmutable $now = null): array
    {
        if (! config('retention.purge_enabled')) {
            // No es un error: es el estado de fábrica. Se devuelve vacío y quien
            // llama lo cuenta como cero, en vez de reventar un barrido nocturno
            // por una opción que nadie ha encendido a propósito.
            return [];
        }

        $now ??= CarbonImmutable::now();
        $politica = Policy::forTenant($tenantId);

        // Los tipos con bloqueo vigente, preguntados a `legal_holds` y no a la
        // columna. Ver la nota de la clase: la columna es una copia, y aquí el
        // precio de una copia vieja es un borrado permanente.
        $bloqueoAmplio = Holds::active($tenantId)->contains(fn (object $h): bool => (string) $h->scope_type === 'tenant');

        $resumen = [];

        foreach (array_keys(Policy::ENTITIES) as $tabla) {
            if (! $politica->canPurge($tabla)) {
                continue;
            }

            $base = fn () => DB::table($tabla)
                ->where('tenant_id', $tenantId)
                ->whereNotNull('archived_at')
                ->whereNotNull('purge_eligible_at')
                ->where('purge_eligible_at', '<=', $now);

            $bloqueados = (clone $base())->where('legal_hold', 1)->count();

            if ($bloqueoAmplio || Holds::covers($tenantId, $tabla)) {
                // Un bloqueo por tipo o de toda la empresa: no se toca la tabla,
                // y se cuenta entera como saltada por bloqueo legal — que es
                // justo para lo que existe `retention_jobs.skipped_legal_hold_count`.
                $resumen[$tabla] = ['processed' => 0, 'skipped' => (clone $base())->count()];

                continue;
            }

            $hechos = 0;

            do {
                $ids = (clone $base())
                    ->where('legal_hold', 0)
                    ->limit(self::LOTE)
                    ->pluck('id')
                    ->all();

                if ($ids === []) {
                    break;
                }

                $hechos += DB::table($tabla)->whereIn('id', $ids)->delete();
            } while (count($ids) === self::LOTE);

            if ($hechos > 0 || $bloqueados > 0) {
                $resumen[$tabla] = ['processed' => $hechos, 'skipped' => $bloqueados];
            }
        }

        return $resumen;
    }

    /**
     * Una pasada completa sobre una empresa, dejando constancia en
     * `retention_jobs`.
     *
     * Una fila por tabla y acción, que es como el esquema lo pide:
     * `retention_jobs` tiene `entity_type` y `action`, no un resumen global.
     *
     * Es el ÚNICO sitio que llama a `archive()` y `purge()` en una ejecución
     * real. Llamarlas por separado además de esto haría el trabajo dos veces —
     * inofensivo al archivar, porque la segunda pasada ya no encuentra
     * candidatos, y una forma excelente de duplicar filas en `retention_jobs`.
     *
     * @return array{archived: int, purged: int, skipped: int, jobs: list<string>}
     */
    public static function run(string $tenantId, ?CarbonImmutable $now = null): array
    {
        $now ??= CarbonImmutable::now();
        $total = ['archived' => 0, 'purged' => 0, 'skipped' => 0, 'jobs' => []];

        foreach (self::archive($tenantId, $now) as $tabla => $r) {
            $total['archived'] += $r['processed'];
            $total['skipped'] += $r['skipped'];
            $total['jobs'][] = self::record($tenantId, 'archive', $tabla, $now, $r['candidates'], $r['processed'], $r['skipped']);
        }

        foreach (self::purge($tenantId, $now) as $tabla => $r) {
            $total['purged'] += $r['processed'];
            $total['skipped'] += $r['skipped'];
            $total['jobs'][] = self::record($tenantId, 'purge', $tabla, $now, $r['processed'] + $r['skipped'], $r['processed'], $r['skipped']);
        }

        return $total;
    }

    private static function record(
        string $tenantId,
        string $accion,
        string $tabla,
        CarbonImmutable $now,
        int $candidatos,
        int $hechos,
        int $bloqueados,
    ): string {
        $id = (string) Str::uuid();

        DB::table('retention_jobs')->insert([
            'id' => $id,
            'tenant_id' => $tenantId,
            'action' => $accion,
            'entity_type' => $tabla,
            // `succeeded`, NO `completed`. El CHECK de `retention_jobs.status`
            // admite queued|running|succeeded|failed|dead_letter|cancelled, y
            // `completed` no está. Es el mismo tropiezo que el `pod` del lote
            // 50: un literal que el esquema no admite no da error de tipos, da
            // una fila que no entra — y aquí el sitio donde se descubriría
            // sería el primer barrido nocturno.
            'status' => 'succeeded',
            'cutoff_at' => $now,
            'candidate_count' => $candidatos,
            'processed_count' => $hechos,
            'skipped_legal_hold_count' => $bloqueados,
            'started_at' => $now,
            'completed_at' => CarbonImmutable::now(),
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        return $id;
    }
}
