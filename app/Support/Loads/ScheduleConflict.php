<?php

declare(strict_types=1);

namespace App\Support\Loads;

use App\Support\Deletion\OpenWork;
use Illuminate\Support\Facades\DB;

/**
 * El mismo conductor, camión o remolque en dos cargas que se pisan.
 *
 * ## El defecto
 *
 * La página pública de Servicios dice, y se lee antes de comprar:
 *
 * > La asignación se verifica automáticamente contra el cumplimiento normativo
 * > — un camión, remolque o conductor con un documento vencido, **o un conflicto
 * > de horario**, no puede asignarse a una carga.
 *
 * Lo del documento vencido es verdad y lo comprueba
 * `LoadAssignmentController::checkResource()`. Lo del horario no existía: en
 * todo el producto no había una sola consulta que comparase las asignaciones de
 * un recurso contra las ventanas de otra carga. Se podía poner al mismo
 * conductor en dos cargas que se solapan y nadie decía nada.
 *
 * ## Qué es «pisarse»
 *
 * Dos cargas se pisan si sus ventanas se tocan. La ventana de una carga va del
 * `window_start` más temprano de sus paradas al `window_end` más tardío —y si
 * una parada no tiene fin, se toma su propio inicio, porque una cita sin
 * ventana de cierre no es una cita que dure para siempre—.
 *
 * Una carga sin ninguna ventana escrita no se pisa con nada: sin fechas no hay
 * conflicto que afirmar, y avisar «quizá» de todo convierte el aviso en ruido,
 * que es como se acaba desactivando.
 *
 * ## Avisa; no bloquea
 *
 * Un documento vencido es una puerta: la ley dice que ese camión no sale. Un
 * solape es un problema de agenda, y la agenda la lleva quien despacha: una
 * recogida a las 8 y otra a las 18 en la misma ciudad «se pisan» por ventana y
 * puede que sean perfectamente posibles. Endurecer esto a bloqueo es una
 * decisión de negocio con consecuencias en la operación del día, y le toca a
 * quien lleva la casa — el mismo criterio que ya está escrito para la
 * revalidación de FMCSA en `Onboarding\Readiness`.
 *
 * Lo que sí se hace es **decirlo antes de asignar**, con el número de la otra
 * carga, para que la decisión se tome sabiendo.
 *
 * ## Las cargas cerradas no se pisan
 *
 * `OpenWork::CARGAS_CERRADAS` —pagada y cancelada— queda fuera. Una carga
 * cancelada no ocupa a nadie, y se usa esa constante y no una lista nueva para
 * que «cerrada» signifique lo mismo en todo el producto.
 */
final class ScheduleConflict
{
    /** Los recursos que se pueden pisar. Un remolque también: es uno solo. */
    public const RECURSOS = ['driver', 'truck', 'trailer'];

    /**
     * Las cargas vivas que ya ocupan a CADA recurso de un tipo en la ventana de
     * esta carga.
     *
     * Una consulta por tipo de recurso y no una por opción del desplegable:
     * veinte conductores en la lista serían veinte consultas, y esto se calcula
     * cada vez que alguien abre la ficha de una carga.
     *
     * @return array<string, list<array{loadId: string, loadNumber: string, from: string, to: string}>>
     */
    public static function byResource(string $tenantId, string $loadId, string $resourceType): array
    {
        if (! in_array($resourceType, self::RECURSOS, true)) {
            return [];
        }

        $ventana = self::window($tenantId, $loadId);

        if ($ventana === null) {
            return [];
        }

        [$desde, $hasta] = $ventana;

        $columna = 'a.'.$resourceType.'_id';

        $filas = DB::table('load_assignments as a')
            ->join('loads as l', 'l.id', '=', 'a.load_id')
            ->join('load_stops as s', 's.load_id', '=', 'l.id')
            ->where('a.tenant_id', $tenantId)
            ->whereNotNull($columna)
            ->whereNull('a.unassigned_at')
            ->whereNull('a.deleted_at')
            ->where('a.load_id', '!=', $loadId)
            ->whereNull('l.deleted_at')
            ->whereNotIn('l.status', OpenWork::CARGAS_CERRADAS)
            ->whereNotNull('s.window_start')
            ->groupBy($columna, 'l.id', 'l.load_number')
            ->havingRaw('min(s.window_start) <= ? and max(coalesce(s.window_end, s.window_start)) >= ?', [$hasta, $desde])
            ->orderBy('l.load_number')
            ->get([
                DB::raw($columna.' as recurso'),
                'l.id as load_id',
                'l.load_number',
                DB::raw('min(s.window_start) as desde'),
                DB::raw('max(coalesce(s.window_end, s.window_start)) as hasta'),
            ]);

        $porRecurso = [];

        foreach ($filas as $f) {
            $porRecurso[(string) $f->recurso][] = [
                'loadId' => (string) $f->load_id,
                'loadNumber' => (string) $f->load_number,
                'from' => (string) $f->desde,
                'to' => (string) $f->hasta,
            ];
        }

        return $porRecurso;
    }

    /**
     * Lo mismo para un recurso concreto, que es lo que hace falta al asignar.
     *
     * @return list<array{loadId: string, loadNumber: string, from: string, to: string}>
     */
    public static function forResource(
        string $tenantId,
        string $resourceType,
        string $resourceId,
        string $loadId,
    ): array {
        return self::byResource($tenantId, $loadId, $resourceType)[$resourceId] ?? [];
    }

    /**
     * La ventana de una carga, o `null` si no tiene ninguna fecha escrita.
     *
     * @return array{0: string, 1: string}|null
     */
    public static function window(string $tenantId, string $loadId): ?array
    {
        $fila = DB::table('load_stops')
            ->where('tenant_id', $tenantId)
            ->where('load_id', $loadId)
            ->whereNotNull('window_start')
            ->selectRaw('min(window_start) as desde, max(coalesce(window_end, window_start)) as hasta')
            ->first();

        if ($fila === null || $fila->desde === null) {
            return null;
        }

        return [(string) $fila->desde, (string) $fila->hasta];
    }
}
