<?php

declare(strict_types=1);

namespace App\Support\Board;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * Dónde está cada camión, según lo que el sistema SABE.
 *
 * ## Lo que hay hoy, dicho como es
 *
 * Las posiciones entran por carga: `tracking_sessions` se abre para una carga y
 * `tracking_events` guarda lo que llega. No hay registro de dispositivos —ni
 * un GPS atado a un camión ni un ELD atado a un conductor—, así que un
 * conductor sin carga en curso NO TIENE POSICIÓN, y eso no es un fallo que
 * tapar: es lo que hay, y el tablero lo dice con esas palabras.
 *
 * Cuando exista ese registro, esta clase es el único sitio donde hay que
 * mirar además de aquí. El tablero pregunta «¿dónde está?» y no «¿de qué
 * aparato salió?», y por eso cada punto viaja con su procedencia: `provider`
 * dice si lo mandó un proveedor o lo anotó una persona, y `manual` no es lo
 * mismo que un GPS por mucho que ocupe el mismo píxel.
 *
 * ## Por qué la última y no un rastro
 *
 * El tablero enseña dónde está cada uno AHORA. El rastro de una carga se mira
 * en su pantalla de rastreo, que para eso existe.
 */
final class Positions
{
    /** Más viejo que esto y el punto no se pinta: sería decir dónde estuvo. */
    public const HORAS_DE_VIGENCIA = 12;

    /**
     * La última posición conocida de cada carga.
     *
     * @param  list<string>  $loadIds
     * @return array<string, array{lat: float, lng: float, at: string, provider: string, label: string|null}>
     */
    public static function ultimasDeCargas(string $tenantId, array $loadIds, ?CarbonImmutable $ahora = null): array
    {
        if ($loadIds === []) {
            return [];
        }

        $limite = ($ahora ?? CarbonImmutable::now())->subHours(self::HORAS_DE_VIGENCIA);

        $filas = DB::table('tracking_events')
            ->where('tenant_id', $tenantId)
            ->whereIn('load_id', $loadIds)
            ->whereNull('archived_at')
            ->whereNotNull('latitude')
            ->whereNotNull('longitude')
            ->where('occurred_at', '>=', $limite)
            ->orderBy('occurred_at')
            ->get(['load_id', 'latitude', 'longitude', 'occurred_at', 'provider', 'location_label']);

        $salida = [];

        // Ordenadas de vieja a nueva y sobrescribiendo: la última que se lee es
        // la más reciente. Un `max` por carga en SQL exigiría una subconsulta
        // por cada una.
        foreach ($filas as $fila) {
            $lat = self::numero($fila->latitude);
            $lng = self::numero($fila->longitude);

            if ($lat === null || $lng === null) {
                continue;
            }

            $salida[(string) $fila->load_id] = [
                'lat' => $lat,
                'lng' => $lng,
                'at' => CarbonImmutable::parse((string) $fila->occurred_at)->toIso8601String(),
                'provider' => (string) $fila->provider,
                'label' => $fila->location_label === null ? null : (string) $fila->location_label,
            ];
        }

        return $salida;
    }

    /**
     * Una coordenada que de verdad lo sea.
     *
     * Las columnas son `text` y lo que llega de un proveedor de fuera llega
     * como texto. Una cadena vacía, un `null` escrito o un «n/d» no son cero
     * grados: son la ausencia del dato, y pintarlos como cero pondría el camión
     * en el golfo de Guinea.
     */
    public static function numero(mixed $valor): ?float
    {
        if ($valor === null || $valor === '') {
            return null;
        }

        return is_numeric($valor) ? (float) $valor : null;
    }
}
