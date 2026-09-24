<?php

declare(strict_types=1);

namespace App\Support\Fleet;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

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
     * Guarda una asignación, o dice por qué no cabe.
     *
     * **El único sitio que escribe en la tabla.** Lo comprueba un guardián:
     * MySQL no sabe rechazar un solapamiento —no hay tipo rango ni restricción
     * de exclusión— así que no hay red debajo, y un `insert` suelto en otro
     * controlador dejaría el mismo camión con dos conductores sin que nada
     * fallara.
     *
     * Devuelve las claves de `drivers.standing.*` que explican el choque; una
     * lista vacía quiere decir que se guardó.
     *
     * @return list<string>
     */
    public static function crear(
        string $tenantId,
        string $driverId,
        string $truckId,
        ?string $trailerId,
        string $startsOn,
        ?string $endsOn = null,
        ?string $porUsuario = null,
        ?string $nota = null,
    ): array {
        $choques = self::choques($tenantId, $driverId, $truckId, $startsOn, $endsOn);

        if ($choques !== []) {
            return $choques;
        }

        DB::table('driver_equipment_assignments')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $tenantId,
            'driver_id' => $driverId,
            'truck_id' => $truckId,
            'trailer_id' => $trailerId,
            'starts_on' => $startsOn,
            'ends_on' => $endsOn,
            'assigned_by_user_id' => $porUsuario,
            'notes' => $nota,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return [];
    }

    /**
     * Termina UNA asignación: la deja de valer HOY MISMO.
     *
     * ## Por qué la fecha de fin es AYER
     *
     * `ends_on` es el último día en que la asignación VALE. Ponerla a hoy la
     * deja vigente hoy: la ficha sigue diciendo «en vigor», el camión sigue
     * ocupado y el relevo no lo puede coger hasta mañana. El botón decía
     * «Terminar», el aviso decía «asignación terminada», y las dos pantallas
     * que leen la tabla seguían enseñando lo mismo que antes de pulsarlo.
     *
     * `terminarVigentes()`, cuatro métodos más abajo, ya lo hacía bien y lo
     * explicaba en su propio comentario. Dos maneras de terminar lo mismo en
     * la misma clase, y solo una cierta.
     *
     * ## El suelo
     *
     * Lo único que no se puede es terminarla antes de empezar —la restricción
     * `chk_standing_dates` lo rechaza—, así que una que empezó hoy dura hoy.
     * Por eso se devuelve el día de verdad en vez de un sí: quien pulsó tiene
     * derecho a leer hasta cuándo, y una de cada tantas veces no es ayer.
     *
     * ## Lo que no termina
     *
     * Una que ya terminó antes de hoy. Sin esto, pulsar «Terminar» sobre una
     * asignación de marzo le movería el fin a ayer y la resucitaría: cinco
     * meses de historia cambiados por un clic que parecía no hacer nada.
     *
     * Y una que aún no ha empezado, porque ahí no hay nada que terminar. Esa
     * se cancela: ver `cancelar()`.
     *
     * Devuelve el último día en que vale, o nada si esa fila no se puede
     * terminar. La comprobación de a quién pertenece va aquí y no en el
     * controlador porque aquí es donde se escribe.
     */
    public static function terminar(string $tenantId, string $driverId, string $id, ?CarbonImmutable $dia = null): ?string
    {
        $fila = self::fila($tenantId, $driverId, $id);

        if ($fila === null) {
            return null;
        }

        $hoy = self::dia($dia);
        $inicio = substr((string) $fila->starts_on, 0, 10);
        $fin = $fila->ends_on === null ? null : substr((string) $fila->ends_on, 0, 10);

        // Ya terminó, o todavía no empieza: en ninguno de los dos casos hay
        // una asignación en vigor que quitar de en medio.
        if (($fin !== null && $fin < $hoy) || $inicio > $hoy) {
            return null;
        }

        $ayer = ($dia ?? CarbonImmutable::now())->subDay()->toDateString();
        $ultimo = max($ayer, $inicio);

        DB::table('driver_equipment_assignments')
            ->where('id', $fila->id)
            ->update(['ends_on' => $ultimo, 'updated_at' => now()]);

        return $ultimo;
    }

    /**
     * Cancela una asignación que todavía no ha empezado.
     *
     * Se borra en blando y no se termina, y la diferencia no es de forma: una
     * asignación que empieza el lunes que viene no tiene nada que contar de
     * marzo. Terminarla la dejaría escrita como un tramo de un día en el
     * futuro —un camión ocupado el lunes por un conductor que nunca lo
     * cogió—, y esa es justo la clase de fila que luego nadie sabe explicar.
     *
     * Lo que ya empezó no se cancela nunca: ahí sí hay historia, y una carga
     * de marzo se mira con el camión que se llevó en marzo.
     */
    public static function cancelar(string $tenantId, string $driverId, string $id, ?CarbonImmutable $dia = null): bool
    {
        $fila = self::fila($tenantId, $driverId, $id);

        if ($fila === null || substr((string) $fila->starts_on, 0, 10) <= self::dia($dia)) {
            return false;
        }

        DB::table('driver_equipment_assignments')
            ->where('id', $fila->id)
            ->update(['deleted_at' => now(), 'updated_at' => now()]);

        return true;
    }

    /**
     * Cambia una asignación que ya existe.
     *
     * ## Por qué hacía falta
     *
     * Porque hasta ahora solo se podía crear y terminar. Quien se equivocaba
     * de remolque —o escribía mal el día de comienzo— no tenía arreglo: la
     * terminaba y creaba otra, y la ficha quedaba con dos tramos donde solo
     * hubo uno. Corregir un dato no es un cambio de equipo.
     *
     * ## El choque se mide sin contarse a sí misma
     *
     * `choques()` ya sabía excluir una fila —el parámetro `$exceptoId` lleva
     * escrito desde que nació— y nadie lo usaba nunca. Sin él, cambiarle la
     * nota a una asignación chocaría consigo misma y diría que ese camión ya
     * está ocupado: por ella.
     *
     * Devuelve las claves de `drivers.standing.*` que explican el choque, una
     * lista vacía si se guardó, o nada si esa fila no es de ese conductor de
     * esa empresa.
     *
     * @return list<string>|null
     */
    public static function actualizar(
        string $tenantId,
        string $driverId,
        string $id,
        string $truckId,
        ?string $trailerId,
        string $startsOn,
        ?string $endsOn = null,
        ?string $nota = null,
    ): ?array {
        $fila = self::fila($tenantId, $driverId, $id);

        if ($fila === null) {
            return null;
        }

        $choques = self::choques($tenantId, $driverId, $truckId, $startsOn, $endsOn, (string) $fila->id);

        if ($choques !== []) {
            return $choques;
        }

        DB::table('driver_equipment_assignments')
            ->where('id', $fila->id)
            ->update([
                'truck_id' => $truckId,
                'trailer_id' => $trailerId,
                'starts_on' => $startsOn,
                'ends_on' => $endsOn,
                'notes' => $nota,
                'updated_at' => now(),
            ]);

        return [];
    }

    /** Una fila viva de ese conductor de esa empresa, o nada. */
    private static function fila(string $tenantId, string $driverId, string $id): ?object
    {
        return DB::table('driver_equipment_assignments')
            ->where('tenant_id', $tenantId)
            ->where('driver_id', $driverId)
            ->where('id', $id)
            ->whereNull('deleted_at')
            ->first(['id', 'starts_on', 'ends_on']);
    }

    /**
     * Termina lo que esté vigente de un conductor, AHORA.
     *
     * Terminar y no borrar: una carga de marzo se mira con el camión que se
     * llevó en marzo. Se usa al dar de baja a alguien — si no, su camión se
     * queda atado a un conductor que ya no trabaja aquí y no hay manera de
     * dárselo a otro.
     *
     * La fecha de fin es AYER y no hoy, y la diferencia importa: `ends_on` es
     * el último día en que la asignación vale, así que terminarla «hoy» la
     * dejaría vigente hoy y el camión seguiría ocupado la tarde en que alguien
     * intenta dárselo al relevo. Lo único que no se puede es terminarla antes
     * de empezar —la base lo rechaza—, y por eso una que empezó hoy dura ese
     * día.
     *
     * Devuelve cuántas se terminaron.
     */
    public static function terminarVigentes(string $tenantId, string $driverId, ?CarbonImmutable $dia = null): int
    {
        $ayer = ($dia ?? CarbonImmutable::now())->subDay()->toDateString();

        return DB::table('driver_equipment_assignments')
            ->where('tenant_id', $tenantId)
            ->where('driver_id', $driverId)
            ->whereNull('deleted_at')
            ->whereNull('ends_on')
            ->update([
                'ends_on' => DB::raw("greatest(starts_on, '".$ayer."')"),
                'updated_at' => now(),
            ]);
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
