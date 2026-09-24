<?php

declare(strict_types=1);

namespace App\Support\Loads;

use App\Support\Tracking\Ingestion;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Todo lo que le ha pasado a una carga, en una sola lista.
 *
 * ## Por qué hay que juntarlo
 *
 * La historia de una carga está repartida en cinco tablas porque cada una la
 * escribe un acto distinto: el cambio de estado en `load_status_history`, quién
 * la lleva en `load_assignments`, las llegadas y salidas en `load_stops`, los
 * papeles en `load_documents` y las posiciones en `tracking_events`. Ninguna es
 * la historia; la historia es el orden en que pasaron.
 *
 * Quien despacha no pregunta «¿qué dice `load_status_history`?». Pregunta «¿qué
 * ha pasado con esta carga?», y hasta ahora eso se contestaba abriendo cinco
 * sitios y ordenando de cabeza.
 *
 * ## El reloj
 *
 * Cada suceso se enseña en la hora DEL MUELLE al que pertenece, y los que no
 * pertenecen a ninguno —una posición del proveedor, un cambio de estado— en la
 * del origen. Es el mismo criterio que `Tracking\Timeline`, y por el mismo
 * motivo: sin él, la parada dice «llegó a las 09:04» y la cronología «13:04»
 * del mismo suceso, en la misma pantalla.
 *
 * Cada entrada lleva su huso escrito al lado. No es ruido: es lo que permite
 * leer una carga que recoge en Laredo y entrega en Gary sin restar horas de
 * cabeza.
 */
final class History
{
    /** Tope de entradas. Una carga con mil posiciones no se lee de un tirón. */
    public const TOPE = 60;

    /**
     * @return list<array<string, mixed>>
     */
    public static function de(string $tenantId, string $loadId): array
    {
        /*
         * Con el sitio del cliente al lado, y no solo con lo que la parada
         * escribió a mano.
         *
         * Una parada que apunta a una instalación del cliente deja vacíos su
         * `facility_name`, su ciudad y su estado: el nombre y la dirección
         * están en `customer_locations`. Sin este `leftJoin`, la cronología
         * decía «Llegó a la recogida · —» justo debajo del panel que, en la
         * misma pantalla, nombraba el sitio y la ciudad —porque ese panel sí
         * lo une—. Salió en el paseo por el navegador, no en las pruebas: los
         * datos de las pruebas escriben la ciudad en la parada.
         *
         * El huso NO se trae de aquí: `load_stops.timezone` es NOT NULL con
         * valor por omisión, así que un respaldo sería una rama que no puede
         * dispararse.
         */
        $paradas = DB::table('load_stops as s')
            ->leftJoin('customer_locations as cl', 'cl.id', '=', 's.customer_location_id')
            ->where('s.tenant_id', $tenantId)
            ->where('s.load_id', $loadId)
            ->whereNull('s.deleted_at')
            ->orderBy('s.sequence')
            ->get(['s.id', 's.stop_type', 's.sequence', 's.timezone', 's.city', 's.state',
                's.facility_name', 's.actual_arrival_at', 's.actual_departure_at',
                'cl.name as loc_name', 'cl.city as loc_city', 'cl.state as loc_state']);

        $husos = $paradas->pluck('timezone', 'id')->all();
        $origen = $husos === [] ? null : reset($husos);

        $sucesos = [
            ...self::estados($tenantId, $loadId, $origen),
            ...self::asignaciones($tenantId, $loadId, $origen),
            ...self::paradas($paradas, $origen),
            ...self::papeles($tenantId, $loadId, $origen),
            ...self::posiciones($tenantId, $loadId, $husos, $origen),
        ];

        // De lo más nuevo a lo más viejo, que es como se lee una cronología de
        // trabajo: lo último que pasó es lo que importa ahora.
        usort($sucesos, static fn (array $a, array $b): int => strcmp((string) $b['utc'], (string) $a['utc']));

        // `utc` sale de la lista antes de viajar: solo servía para ordenar.
        // Mandarlo invitaría a que alguien lo pintara, que es exactamente el
        // defecto que `StopClock` vino a cerrar.
        return array_map(
            static function (array $s): array {
                unset($s['utc']);

                return $s;
            },
            array_slice($sucesos, 0, self::TOPE),
        );
    }

    /** @return list<array<string, mixed>> */
    private static function estados(string $tenantId, string $loadId, ?string $huso): array
    {
        return DB::table('load_status_history')
            ->where('tenant_id', $tenantId)
            ->where('load_id', $loadId)
            ->orderBy('occurred_at')
            ->get(['id', 'from_status', 'to_status', 'occurred_at', 'source', 'notes'])
            ->map(static fn (object $f): array => self::suceso(
                (string) $f->id,
                // Sin estado de partida es el nacimiento de la carga, y decirlo
                // como «pasó de nada a borrador» no lo dice.
                $f->from_status === null ? 'created' : 'status',
                $f->occurred_at,
                $huso,
                [
                    'to' => $f->to_status === null ? null : (string) $f->to_status,
                    'from' => $f->from_status === null ? null : (string) $f->from_status,
                    // `source` distingue lo que movió una PERSONA de lo que
                    // movió el sistema. En una cronología eso es la mitad de la
                    // información.
                    'source' => (string) $f->source,
                    'note' => $f->notes,
                ],
            ))
            ->all();
    }

    /** @return list<array<string, mixed>> */
    private static function asignaciones(string $tenantId, string $loadId, ?string $huso): array
    {
        $filas = DB::table('load_assignments as a')
            ->leftJoin('drivers as d', 'd.id', '=', 'a.driver_id')
            ->leftJoin('trucks as t', 't.id', '=', 'a.truck_id')
            ->leftJoin('trailers as r', 'r.id', '=', 'a.trailer_id')
            ->where('a.tenant_id', $tenantId)
            ->where('a.load_id', $loadId)
            ->whereNull('a.deleted_at')
            ->orderBy('a.created_at')
            ->get([
                'a.id', 'a.resource_type', 'a.created_at', 'a.unassigned_at', 'a.unassigned_reason',
                'd.first_name', 'd.last_name', 't.unit_number as truck_unit', 'r.unit_number as trailer_unit',
            ]);

        $salida = [];

        foreach ($filas as $fila) {
            $quien = trim((string) $fila->first_name.' '.(string) $fila->last_name);
            $nombre = $quien !== ''
                ? $quien
                : (string) ($fila->truck_unit ?? $fila->trailer_unit ?? '');

            $salida[] = self::suceso(
                (string) $fila->id.':on',
                'assigned',
                $fila->created_at,
                $huso,
                ['resource' => (string) $fila->resource_type, 'name' => $nombre],
            );

            // Y la retirada, que es un suceso por derecho propio: «se le quitó
            // el conductor el martes» es lo que explica por qué la carga se
            // quedó parada.
            if ($fila->unassigned_at !== null) {
                $salida[] = self::suceso(
                    (string) $fila->id.':off',
                    'unassigned',
                    $fila->unassigned_at,
                    $huso,
                    [
                        'resource' => (string) $fila->resource_type,
                        'name' => $nombre,
                        'note' => $fila->unassigned_reason,
                    ],
                );
            }
        }

        return $salida;
    }

    /**
     * `stdClass` y no `object`: es lo que devuelve `DB::table()->get()`, y el
     * genérico de la colección no es covariante —una `Collection<stdClass>` no
     * pasa por una `Collection<object>`—.
     *
     * @param  Collection<int, \stdClass>  $paradas
     * @return list<array<string, mixed>>
     */
    private static function paradas(Collection $paradas, ?string $origen): array
    {
        $salida = [];

        foreach ($paradas as $parada) {
            $huso = $parada->timezone ?? $origen;
            $nombre = $parada->facility_name ?? $parada->loc_name;
            $ciudad = $parada->city ?? $parada->loc_city;
            $estado = $parada->state ?? $parada->loc_state;

            // «Bodega Laredo · Laredo, TX», y lo que falte se calla en vez de
            // dejar un separador suelto.
            $sitio = implode(' · ', array_filter([
                $nombre === null ? null : (string) $nombre,
                $ciudad === null
                    ? null
                    : (string) $ciudad.($estado === null ? '' : ', '.(string) $estado),
            ]));

            foreach ([['arrived', $parada->actual_arrival_at], ['departed', $parada->actual_departure_at]] as [$que, $cuando]) {
                if ($cuando === null) {
                    continue;
                }

                $salida[] = self::suceso(
                    (string) $parada->id.':'.$que,
                    $que,
                    $cuando,
                    $huso,
                    [
                        'stop' => (string) $parada->stop_type,
                        'sequence' => (int) $parada->sequence,
                        'place' => $sitio,
                    ],
                );
            }
        }

        return $salida;
    }

    /** @return list<array<string, mixed>> */
    private static function papeles(string $tenantId, string $loadId, ?string $huso): array
    {
        // El nombre del fichero vive en la VERSIÓN, no en el documento:
        // `documents` guarda el título y a qué versión apunta hoy, y
        // `document_versions` el fichero que se subió. Un documento sin versión
        // vigente —lo hay mientras se sube— se enseña por su título antes que
        // sin nombre.
        return DB::table('load_documents as ld')
            ->leftJoin('documents as d', 'd.id', '=', 'ld.document_id')
            ->leftJoin('document_versions as dv', 'dv.id', '=', 'd.current_version_id')
            ->where('ld.tenant_id', $tenantId)
            ->where('ld.load_id', $loadId)
            ->whereNull('ld.deleted_at')
            ->orderBy('ld.created_at')
            ->get(['ld.id', 'ld.document_type', 'ld.created_at', 'dv.original_filename', 'd.title'])
            ->map(static fn (object $f): array => self::suceso(
                (string) $f->id,
                'document',
                $f->created_at,
                $huso,
                [
                    'documentType' => (string) $f->document_type,
                    'name' => $f->original_filename ?? $f->title,
                ],
            ))
            ->all();
    }

    /**
     * @param  array<string, string|null>  $husos
     * @return list<array<string, mixed>>
     */
    private static function posiciones(string $tenantId, string $loadId, array $husos, ?string $origen): array
    {
        return DB::table('tracking_events')
            ->where('tenant_id', $tenantId)
            ->where('load_id', $loadId)
            ->whereNull('archived_at')
            ->orderByDesc('occurred_at')
            ->limit(self::TOPE)
            ->get(['id', 'event_type', 'provider', 'location_label', 'occurred_at', 'stop_id'])
            ->map(static fn (object $e): array => self::suceso(
                (string) $e->id,
                'tracking',
                $e->occurred_at,
                $e->stop_id === null ? $origen : ($husos[(string) $e->stop_id] ?? $origen),
                [
                    'event' => (string) $e->event_type,
                    'place' => $e->location_label,
                    // Un parte escrito por despacho no es un GPS por mucho que
                    // ocupe la misma línea.
                    'byPerson' => $e->provider === Ingestion::MANUAL,
                    'provider' => (string) $e->provider,
                ],
            ))
            ->all();
    }

    /**
     * @param  array<string, mixed>  $detalle
     * @return array<string, mixed>
     */
    private static function suceso(string $id, string $tipo, mixed $cuando, ?string $huso, array $detalle): array
    {
        return [
            'id' => $id,
            'type' => $tipo,
            'at' => StopClock::moment($cuando, $huso),
            'zone' => StopClock::label($huso, $cuando),
            // Solo para ordenar; `de()` lo quita antes de devolver la lista.
            'utc' => $cuando === null ? '' : (string) $cuando,
            'detail' => $detalle,
        ];
    }
}
