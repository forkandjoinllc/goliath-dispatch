<?php

declare(strict_types=1);

namespace App\Support\Tracking;

use App\Services\Tracking\PositionReport;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * Marcar que el camión llegó a una parada, y que salió.
 *
 * ## El defecto que arregla
 *
 * `load_stops.actual_arrival_at` y `actual_departure_at` se LEÍAN en tres
 * pantallas —la ficha de la carga, el panel de rastreo y la página pública del
 * cliente— y no las escribía absolutamente nadie. No es que estuvieran poco
 * usadas: no había en todo el código una sola escritura. O sea que al cliente al
 * que se le manda un enlace con el logo y los colores de la casa de despacho se
 * le enseñaba una lista de paradas donde todas ponían «pendiente», para
 * siempre, incluso después de entregada la carga.
 *
 * Es el hecho más básico de todo el producto —«¿llegó o no llegó?»— y era el
 * único que no se podía escribir.
 *
 * ## Dos reglas, y las dos son del mundo, no del código
 *
 * **No se sale de donde no se ha llegado.** Marcar la salida de una parada sin
 * llegada no es un caso raro que convenga permitir por flexibilidad: es un dato
 * que después hace que la duración de la parada salga negativa y que el avance
 * cuente una parada hecha que nadie vio hacer.
 *
 * **No se llega a la segunda sin pasar por la primera.** Un camión recorre sus
 * paradas en orden; si alguien las marca al revés, lo que hay es un error de
 * tecleo o unas paradas mal ordenadas, y las dos cosas se arreglan mejor
 * mirándolas que guardándolas.
 *
 * Las dos se comprueban aquí y no en el formulario, porque el formulario es del
 * navegador y esto es un hecho de la carga.
 */
final class StopProgress
{
    /**
     * @throws \RuntimeException con la clave del motivo
     */
    public static function llegada(string $tenantId, string $loadId, string $stopId, CarbonImmutable $cuando): void
    {
        $parada = self::parada($tenantId, $loadId, $stopId);

        if ($parada->actual_arrival_at !== null) {
            throw new \RuntimeException('stopAlreadyArrived');
        }

        $anterior = DB::table('load_stops')
            ->where('tenant_id', $tenantId)
            ->where('load_id', $loadId)
            ->whereNull('deleted_at')
            ->where('sequence', '<', $parada->sequence)
            ->whereNull('actual_arrival_at')
            ->exists();

        if ($anterior) {
            throw new \RuntimeException('earlierStopNotArrived');
        }

        DB::table('load_stops')->where('id', $stopId)->update([
            'actual_arrival_at' => $cuando,
            'updated_at' => CarbonImmutable::now(),
        ]);

        self::anotar($tenantId, $loadId, $parada, 'arrived', $cuando);
    }

    /**
     * @throws \RuntimeException con la clave del motivo
     */
    public static function salida(string $tenantId, string $loadId, string $stopId, CarbonImmutable $cuando): void
    {
        $parada = self::parada($tenantId, $loadId, $stopId);

        if ($parada->actual_arrival_at === null) {
            throw new \RuntimeException('stopNotArrivedYet');
        }

        if ($parada->actual_departure_at !== null) {
            throw new \RuntimeException('stopAlreadyDeparted');
        }

        if ($cuando->isBefore(CarbonImmutable::parse((string) $parada->actual_arrival_at))) {
            throw new \RuntimeException('departureBeforeArrival');
        }

        DB::table('load_stops')->where('id', $stopId)->update([
            'actual_departure_at' => $cuando,
            'updated_at' => CarbonImmutable::now(),
        ]);

        self::anotar($tenantId, $loadId, $parada, 'departed', $cuando);
    }

    private static function parada(string $tenantId, string $loadId, string $stopId): object
    {
        // La carga en el `where` y no solo la parada: sin ella, el id de una
        // parada de otra carga de la misma empresa se marcaría desde esta
        // pantalla. Misma frontera que en `completeCheckCall`.
        //
        // Y con la ubicación del cliente unida, porque una parada puede apuntar
        // a una ficha de ubicación en vez de llevar la dirección escrita a mano
        // — y entonces `load_stops.city` está vacía. Es la misma regla que
        // siguen `LoadController` y el panel de rastreo; leer solo la columna
        // suelta dejaba el lugar del suceso en blanco justo en las cargas del
        // demo, que usan ubicaciones. Lo vio el navegador, no una prueba.
        $parada = DB::table('load_stops as s')
            ->leftJoin('customer_locations as cl', 'cl.id', '=', 's.customer_location_id')
            ->where('s.tenant_id', $tenantId)
            ->where('s.load_id', $loadId)
            ->where('s.id', $stopId)
            ->whereNull('s.deleted_at')
            ->first([
                's.id', 's.stop_type', 's.sequence', 's.actual_arrival_at', 's.actual_departure_at',
                DB::raw('coalesce(cl.city, s.city) as city'),
                DB::raw('coalesce(cl.state, s.state) as state'),
            ]);

        if ($parada === null) {
            throw new \RuntimeException('stopNotFound');
        }

        return $parada;
    }

    /**
     * El hecho, además, en la línea de tiempo.
     *
     * La fuente de verdad sigue siendo la columna de la parada; esto es lo que
     * hace que el suceso aparezca en el mismo orden que los del proveedor
     * cuando algún día los haya. La referencia lleva la parada y el verbo, así
     * que es idempotente por construcción: no hay forma de escribir dos veces la
     * llegada a la misma parada aunque se llame dos veces a este método.
     */
    private static function anotar(string $tenantId, string $loadId, object $parada, string $verbo, CarbonImmutable $cuando): void
    {
        $tipo = $parada->stop_type === 'pickup' ? 'pickup' : 'delivery';
        $lugar = array_filter([$parada->city ?? null, $parada->state ?? null]);

        Ingestion::manual($tenantId, $loadId, new PositionReport(
            eventType: "{$verbo}_{$tipo}",
            occurredAt: $cuando,
            reference: "stop:{$parada->id}:{$verbo}",
            locationLabel: $lugar === [] ? null : implode(', ', $lugar),
            stopId: (string) $parada->id,
        ));
    }
}
