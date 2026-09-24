<?php

declare(strict_types=1);

namespace App\Support\Drivers;

use App\Support\Loads\StopClock;
use App\Support\Tracking\Ingestion;
use Illuminate\Support\Facades\DB;

/**
 * Lo que le ha pasado a un conductor: sus cargas y dónde ha estado.
 *
 * ## Dos fuentes y una pregunta
 *
 * «¿Qué ha hecho este conductor?» se contesta con lo que se le asignó y con las
 * posiciones que llegaron mientras lo llevaba. Están en dos tablas porque las
 * escriben dos actos distintos, y ninguna de las dos es la respuesta por sí
 * sola: la asignación dice qué le tocó y la posición dice por dónde va.
 *
 * ## El reloj de las posiciones
 *
 * En la hora del muelle de la parada a la que pertenece el suceso, y si no
 * pertenece a ninguna, en la del origen de esa carga. Un conductor que recoge
 * en Laredo y entrega en Gary cruza dos husos, y una cronología que los mezcle
 * sin decirlo se lee al revés.
 */
final class DriverTimeline
{
    public const TOPE = 40;

    /**
     * @return list<array<string, mixed>>
     */
    public static function de(string $tenantId, string $driverId): array
    {
        $asignaciones = DB::table('load_assignments as a')
            ->join('loads as l', 'l.id', '=', 'a.load_id')
            ->where('a.tenant_id', $tenantId)
            ->where('a.driver_id', $driverId)
            ->whereNull('a.deleted_at')
            ->orderByDesc('a.created_at')
            ->limit(self::TOPE)
            ->get(['a.id', 'a.load_id', 'a.created_at', 'a.unassigned_at', 'a.unassigned_reason',
                'l.load_number', 'l.status']);

        $cargas = $asignaciones->pluck('load_id')->map(fn ($v): string => (string) $v)->unique()->values()->all();

        $sucesos = [];

        foreach ($asignaciones as $a) {
            $sucesos[] = [
                'id' => (string) $a->id.':on',
                'type' => 'assigned',
                'utc' => (string) $a->created_at,
                'at' => StopClock::moment($a->created_at, null),
                'zone' => StopClock::label(null, $a->created_at),
                'detail' => ['loadId' => (string) $a->load_id, 'loadNumber' => (string) $a->load_number],
            ];

            if ($a->unassigned_at !== null) {
                $sucesos[] = [
                    'id' => (string) $a->id.':off',
                    'type' => 'unassigned',
                    'utc' => (string) $a->unassigned_at,
                    'at' => StopClock::moment($a->unassigned_at, null),
                    'zone' => StopClock::label(null, $a->unassigned_at),
                    'detail' => [
                        'loadId' => (string) $a->load_id,
                        'loadNumber' => (string) $a->load_number,
                        'note' => $a->unassigned_reason,
                    ],
                ];
            }
        }

        foreach (self::posiciones($tenantId, $cargas) as $posicion) {
            $sucesos[] = $posicion;
        }

        usort($sucesos, static fn (array $a, array $b): int => strcmp((string) $b['utc'], (string) $a['utc']));

        return array_map(
            static function (array $s): array {
                unset($s['utc']);

                return $s;
            },
            array_slice($sucesos, 0, self::TOPE),
        );
    }

    /**
     * Las posiciones de las cargas que llevó.
     *
     * No hay registro de dispositivos: las posiciones entran POR CARGA, así que
     * el rastro de un conductor es el de las cargas que llevó y nada más. Un
     * conductor sin carga en curso no tiene posición, y esta lista lo dice
     * quedándose corta en vez de inventarse dónde está.
     *
     * @param  list<string>  $loadIds
     * @return list<array<string, mixed>>
     */
    private static function posiciones(string $tenantId, array $loadIds): array
    {
        if ($loadIds === []) {
            return [];
        }

        $husos = DB::table('load_stops')
            ->where('tenant_id', $tenantId)
            ->whereIn('load_id', $loadIds)
            ->whereNull('deleted_at')
            ->orderBy('sequence')
            ->get(['id', 'load_id', 'timezone']);

        $porParada = $husos->pluck('timezone', 'id')->all();
        $origen = [];

        foreach ($husos as $h) {
            $origen[(string) $h->load_id] ??= $h->timezone;
        }

        return DB::table('tracking_events as e')
            ->join('loads as l', 'l.id', '=', 'e.load_id')
            ->where('e.tenant_id', $tenantId)
            ->whereIn('e.load_id', $loadIds)
            ->whereNull('e.archived_at')
            ->orderByDesc('e.occurred_at')
            ->limit(self::TOPE)
            ->get(['e.id', 'e.event_type', 'e.provider', 'e.location_label', 'e.occurred_at',
                'e.stop_id', 'e.load_id', 'l.load_number'])
            ->map(static function (object $e) use ($porParada, $origen): array {
                $huso = $e->stop_id === null
                    ? ($origen[(string) $e->load_id] ?? null)
                    : ($porParada[(string) $e->stop_id] ?? $origen[(string) $e->load_id] ?? null);

                return [
                    'id' => (string) $e->id,
                    'type' => 'tracking',
                    'utc' => (string) $e->occurred_at,
                    'at' => StopClock::moment($e->occurred_at, $huso),
                    'zone' => StopClock::label($huso, $e->occurred_at),
                    'detail' => [
                        'event' => (string) $e->event_type,
                        'place' => $e->location_label,
                        'loadId' => (string) $e->load_id,
                        'loadNumber' => (string) $e->load_number,
                        'byPerson' => $e->provider === Ingestion::MANUAL,
                    ],
                ];
            })
            ->all();
    }
}
