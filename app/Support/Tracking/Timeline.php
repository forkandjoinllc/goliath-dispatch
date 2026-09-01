<?php

declare(strict_types=1);

namespace App\Support\Tracking;

use Illuminate\Support\Facades\DB;

/**
 * La línea de tiempo de una carga: lo que se sabe de su viaje, en orden.
 *
 * Lee `tracking_events` y nada más. Que sea una sola tabla es el motivo de que
 * la migración de este lote permitiera sucesos sin sesión: con la forma
 * anterior, esto habría tenido que coser paradas, llamadas de control y eventos
 * de proveedor en el cliente, y el mismo hecho —la llegada a una parada—
 * habría salido dos veces cuando estuviera en dos sitios.
 *
 * ## Lo que sale y lo que no
 *
 * Devuelve la CLAVE del tipo de suceso, no su frase. `tracking.event.*` ya trae
 * las siete traducciones en los dos idiomas desde el diccionario portado, y la
 * página del cliente puede estar en un idioma distinto del de quien despacha —
 * es la misma regla que impide guardar la etiqueta del lugar traducida.
 *
 * Sale también QUIÉN lo dice: `provider = 'manual'` es una persona de despacho,
 * cualquier otro es un aparato. Enseñarlo no es un detalle técnico que se le
 * escapa al cliente; es la diferencia entre «el camión reportó» y «alguien nos
 * dijo», y el cliente tiene derecho a saber cuál de las dos está leyendo.
 */
final class Timeline
{
    /** Cuántos sucesos se enseñan. Una carga larga con GPS produce miles. */
    public const TOPE = 200;

    /**
     * Lo que el cliente puede ver: menos que el panel, y por eso una función
     * aparte y no un parámetro.
     *
     * Fuera van las coordenadas —el cliente ve el nombre del sitio, no un punto
     * con el que seguir a un conductor— y fuera van los sucesos del
     * consentimiento, que son asunto entre el conductor y su empresa y no del
     * cliente que compró un flete.
     *
     * @return list<array<string, mixed>>
     */
    public static function paraCliente(string $tenantId, string $loadId): array
    {
        return array_values(array_filter(
            self::paraDespacho($tenantId, $loadId, 50),
            static fn (array $e): bool => ! str_starts_with((string) $e['type'], 'consent_'),
        ));
    }

    /** @return list<array<string, mixed>> */
    public static function paraDespacho(string $tenantId, string $loadId, int $tope = self::TOPE): array
    {
        return DB::table('tracking_events')
            ->where('tenant_id', $tenantId)
            ->where('load_id', $loadId)
            ->orderByDesc('occurred_at')
            ->limit($tope)
            ->get(['id', 'event_type', 'provider', 'location_label', 'occurred_at', 'stop_id'])
            ->map(static fn (object $e): array => [
                'id' => (string) $e->id,
                'type' => (string) $e->event_type,
                'reportedByPerson' => $e->provider === Ingestion::MANUAL,
                'provider' => (string) $e->provider,
                'location' => $e->location_label,
                'at' => substr((string) $e->occurred_at, 0, 16),
                'stopId' => $e->stop_id === null ? null : (string) $e->stop_id,
            ])
            ->all();
    }
}
