<?php

declare(strict_types=1);

namespace App\Support\Fleet;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * Qué camión y qué remolque lleva un conductor habitualmente.
 *
 * ## Dos preguntas y una tabla
 *
 * «¿Cuál es el equipo de Eduardo hoy?» y «¿quién lleva el camión 101?» son la
 * misma fila leída por los dos extremos. Las dos las hace el tablero, una por
 * columna.
 *
 * ## Lo que se rechaza, y lo que no
 *
 * **Un conductor, una asignación a la vez.** Si no, «¿cuál es su camión?» tiene
 * dos respuestas y la pantalla elige una al azar.
 *
 * **Un camión, un conductor a la vez.** Dos conductores con el mismo camión el
 * mismo día es un estado que no existe en la calle.
 *
 * **Un remolque, los que hagan falta.** Esto no se rechaza, y es a propósito:
 * en una flota los remolques se sueltan y se recogen, y el mismo remolque pasa
 * por varias manos sin que nadie mienta. Si algún día hace falta la exclusiva
 * también para remolques, se añade aquí y no en cada pantalla.
 *
 * El solapamiento no lo puede comprobar MySQL —no hay tipo rango ni
 * restricción de exclusión—, así que se comprueba aquí, en un solo sitio, y lo
 * vigila `tests/Unit/Suite/StandingAssignmentTest.php`.
 */
final class StandingAssignment
{
    /** Un día, siempre el mismo formato, para comparar con `date`. */
    public static function dia(?CarbonImmutable $dia = null): string
    {
        return ($dia ?? CarbonImmutable::now())->toDateString();
    }

    /**
     * La asignación vigente de un conductor, o nada.
     *
     * @return array{id: string, truckId: string, trailerId: string|null, startsOn: string, endsOn: string|null}|null
     */
    public static function deConductor(string $tenantId, string $driverId, ?CarbonImmutable $dia = null): ?array
    {
        $filas = self::deConductores($tenantId, [$driverId], $dia);

        return $filas[$driverId] ?? null;
    }

    /**
     * Las vigentes de varios conductores, para una lista.
     *
     * @param  list<string>  $driverIds
     * @return array<string, array{id: string, truckId: string, trailerId: string|null, startsOn: string, endsOn: string|null}>
     */
    public static function deConductores(string $tenantId, array $driverIds, ?CarbonImmutable $dia = null): array
    {
        if ($driverIds === []) {
            return [];
        }

        $hoy = self::dia($dia);

        $filas = DB::table('driver_equipment_assignments')
            ->where('tenant_id', $tenantId)
            ->whereIn('driver_id', $driverIds)
            ->whereNull('deleted_at')
            ->whereDate('starts_on', '<=', $hoy)
            ->where(fn ($q) => $q->whereNull('ends_on')->orWhereDate('ends_on', '>=', $hoy))
            // La más reciente manda si por lo que sea hubiera dos: la regla de
            // arriba lo impide al guardar, y esto impide que un dato viejo
            // decida qué se enseña.
            ->orderByDesc('starts_on')
            ->get(['id', 'driver_id', 'truck_id', 'trailer_id', 'starts_on', 'ends_on']);

        $salida = [];

        foreach ($filas as $fila) {
            $conductor = (string) $fila->driver_id;

            $salida[$conductor] ??= [
                'id' => (string) $fila->id,
                'truckId' => (string) $fila->truck_id,
                'trailerId' => $fila->trailer_id === null ? null : (string) $fila->trailer_id,
                'startsOn' => substr((string) $fila->starts_on, 0, 10),
                'endsOn' => $fila->ends_on === null ? null : substr((string) $fila->ends_on, 0, 10),
            ];
        }

        return $salida;
    }

    /** El conductor que lleva este camión, o nada. */
    public static function conductorDeCamion(string $tenantId, string $truckId, ?CarbonImmutable $dia = null): ?string
    {
        $hoy = self::dia($dia);

        $id = DB::table('driver_equipment_assignments')
            ->where('tenant_id', $tenantId)
            ->where('truck_id', $truckId)
            ->whereNull('deleted_at')
            ->whereDate('starts_on', '<=', $hoy)
            ->where(fn ($q) => $q->whereNull('ends_on')->orWhereDate('ends_on', '>=', $hoy))
            ->orderByDesc('starts_on')
            ->value('driver_id');

        return $id === null ? null : (string) $id;
    }

    /**
     * Lo que choca con una asignación que se quiere guardar.
     *
     * Devuelve las claves de `drivers.standing.*` que explican el choque, o una
     * lista vacía si no hay ninguno. Devolver TODOS los choques y no el primero
     * ahorra el ida y vuelta de arreglar uno para descubrir el siguiente.
     *
     * @return list<string>
     */
    public static function choques(
        string $tenantId,
        string $driverId,
        string $truckId,
        string $startsOn,
        ?string $endsOn,
        ?string $exceptoId = null,
    ): array {
        $solapan = static function ($q) use ($startsOn, $endsOn) {
            // Dos tramos se solapan si cada uno empieza antes de que el otro
            // acabe. Un final nulo es «sigue vigente», así que no acaba nunca.
            $q->where(function ($q) use ($endsOn): void {
                if ($endsOn !== null) {
                    $q->whereDate('starts_on', '<=', $endsOn);
                }
            })->where(fn ($q) => $q->whereNull('ends_on')->orWhereDate('ends_on', '>=', $startsOn));
        };

        $base = fn () => DB::table('driver_equipment_assignments')
            ->where('tenant_id', $tenantId)
            ->whereNull('deleted_at')
            ->when($exceptoId !== null, fn ($q) => $q->where('id', '!=', $exceptoId))
            ->where($solapan);

        $choques = [];

        if ($base()->where('driver_id', $driverId)->exists()) {
            $choques[] = 'driverBusy';
        }

        if ($base()->where('truck_id', $truckId)->exists()) {
            $choques[] = 'truckBusy';
        }

        return $choques;
    }
}
