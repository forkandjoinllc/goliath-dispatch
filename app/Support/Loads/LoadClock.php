<?php

declare(strict_types=1);

namespace App\Support\Loads;

use App\Support\Time\Clock;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * En qué reloj está cada hora de una CARGA.
 *
 * ## El defecto
 *
 * Es el mismo que `StopClock` arregló para las paradas, un nivel más arriba y
 * sin arreglar. En la ficha de la carga, cuatro filas seguidas en la misma
 * tarjeta y sin una sola etiqueta de huso:
 *
 *  - `planned_pickup_at` / `planned_delivery_at` los escribe el despachador en
 *    un `datetime-local` y se guardan tal cual. El propio formulario lo
 *    demuestra: los devuelve con `value.slice(0, 16)`, sin convertir nada. Son
 *    hora **de pared**.
 *  - `actual_pickup_at` / `actual_delivery_at` los escribe el servidor con
 *    `now()`, y `config('app.timezone')` es `UTC`.
 *
 * La pantalla les aplicaba a las cuatro la misma conversión de navegador:
 *
 * ```
 * Recogida prevista   16 sep, 1:00     (se guardó 06:00)
 * Recogida real       16 sep, 6:05     (se guardó 11:05 UTC)
 * ```
 *
 * Cinco minutos de retraso, leídos como cinco horas. En la pantalla más usada de
 * la aplicación.
 *
 * ## La decisión ya estaba tomada
 *
 * `StopClock` la razona entera para `load_stops`, incluida la alternativa que se
 * descartó —migrar las ventanas a UTC— y por qué: reinterpretar cada hora ya
 * guardada mueve citas de verdad sin forma de saber cuáles. Aquí se aplica lo
 * mismo:
 *
 *  - lo previsto SIGUE siendo hora del muelle y no se convierte,
 *  - lo real se convierte a la hora de ESE muelle, para que la comparación entre
 *    las dos filas sea la que el ojo espera,
 *  - y las dos llevan la abreviatura del huso al lado, porque convertir sin
 *    decir en qué reloj está lo que se enseña deja el problema a medias.
 *
 * ## De qué muelle
 *
 * De la parada. La recogida toma el huso de la primera parada de recogida y la
 * entrega el de la primera de entrega, que es exactamente lo que esas horas
 * significan. Una carga sin paradas —un borrador recién creado— cae al mismo por
 * omisión que `StopClock`.
 *
 * ## El comprobante es de la oficina
 *
 * `pod_received_at` no es una hora de muelle: es cuándo llegó el papel. Va en el
 * reloj de quien mira, con su etiqueta, que es lo que `Clock` hace con todo lo
 * demás que pasa dentro del sistema. Dos relojes en la misma tarjeta se pueden
 * leer; dos relojes sin etiqueta, no.
 */
final class LoadClock
{
    /**
     * Los husos de las paradas de una carga: recogida y entrega.
     *
     * @return array{pickup: ?string, delivery: ?string}
     */
    public static function muelles(string $loadId): array
    {
        $filas = DB::table('load_stops')
            ->where('load_id', $loadId)
            ->whereNull('deleted_at')
            ->whereIn('stop_type', ['pickup', 'delivery'])
            ->orderBy('sequence')
            ->get(['stop_type', 'timezone']);

        return [
            'pickup' => self::primera($filas, 'pickup'),
            'delivery' => self::primera($filas, 'delivery'),
        ];
    }

    /**
     * Lo mismo para varias cargas de una vez.
     *
     * El listado pinta la fecha prevista de cada fila y necesita el huso de cada
     * una. Una consulta por carga sería una por fila de la tabla; esta es una
     * por página.
     *
     * @param  list<string>  $loadIds
     * @return array<string, array{pickup: ?string, delivery: ?string}>
     */
    public static function muellesDe(array $loadIds): array
    {
        if ($loadIds === []) {
            return [];
        }

        $filas = DB::table('load_stops')
            ->whereIn('load_id', $loadIds)
            ->whereNull('deleted_at')
            ->whereIn('stop_type', ['pickup', 'delivery'])
            ->orderBy('sequence')
            ->get(['load_id', 'stop_type', 'timezone']);

        $mapa = [];

        foreach ($loadIds as $id) {
            $suyas = $filas->where('load_id', $id);

            $mapa[$id] = [
                'pickup' => self::primera($suyas, 'pickup'),
                'delivery' => self::primera($suyas, 'delivery'),
            ];
        }

        return $mapa;
    }

    /**
     * Una hora PREVISTA: hora de pared del muelle, sin tocar.
     *
     * @return array{at: ?string, zone: string}
     */
    public static function previsto(mixed $valor, ?string $timezone): array
    {
        return [
            'at' => StopClock::window($valor),
            'zone' => StopClock::label($timezone, $valor),
        ];
    }

    /**
     * Una hora REAL: guardada en UTC, enseñada en la hora de ese muelle.
     *
     * @return array{at: ?string, zone: string}
     */
    public static function real(mixed $utc, ?string $timezone): array
    {
        return [
            'at' => StopClock::moment($utc, $timezone),
            'zone' => StopClock::label($timezone, $utc),
        ];
    }

    /**
     * Una hora de OFICINA: en el reloj de quien mira.
     *
     * @return array{at: ?string, zone: string}
     */
    public static function oficina(mixed $utc, ?string $timezone): array
    {
        return [
            'at' => Clock::at($utc, $timezone),
            'zone' => Clock::label($timezone, $utc),
        ];
    }

    /**
     * @param  Collection<int, object>  $filas
     */
    private static function primera($filas, string $tipo): ?string
    {
        foreach ($filas as $fila) {
            if ((string) $fila->stop_type === $tipo) {
                // Se devuelve lo que traiga la fila, vacío incluido: quien
                // decide qué hacer con un huso que falta o que no existe es
                // `StopClock`, y lo hace con el por omisión de las paradas.
                // Comprobarlo también aquí era la segunda pieza contestando la
                // misma pregunta — y un sabotaje lo enseñó: quitar esta
                // comprobación no cambiaba nada, porque la de abajo ya estaba.
                return $fila->timezone === null ? null : (string) $fila->timezone;
            }
        }

        return null;
    }
}
