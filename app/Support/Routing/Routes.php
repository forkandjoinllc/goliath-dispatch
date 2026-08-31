<?php

declare(strict_types=1);

namespace App\Support\Routing;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Guarda el recorrido calculado de una carga y los estados que cruza.
 *
 * `routes.is_current` existe porque una carga puede recalcularse: cambian las
 * paradas, o mañana entra un proveedor de verdad y da un recorrido mejor. Se
 * marca la anterior como no vigente en vez de borrarla, porque una evaluación
 * de sobredimensión apunta a `route_id` y borrar la ruta dejaría esa evaluación
 * hablando de un recorrido que ya no se puede leer.
 */
final class Routes
{
    /**
     * Calcula y guarda el recorrido de una carga.
     *
     * @param  list<array{city: string|null, state: string|null, sequence: int}>  $stops
     * @return array{routeId: string, states: list<string>, warnings: list<string>}
     */
    public static function calculate(string $tenantId, string $loadId, array $stops, RouteProvider $provider): array
    {
        $resultado = $provider->calculate($stops);

        $ahora = CarbonImmutable::now();
        $routeId = (string) Str::uuid();

        DB::table('routes')
            ->where('tenant_id', $tenantId)
            ->where('load_id', $loadId)
            ->whereNull('deleted_at')
            ->update(['is_current' => 0, 'updated_at' => $ahora]);

        DB::table('routes')->insert([
            'id' => $routeId,
            'tenant_id' => $tenantId,
            'load_id' => $loadId,
            'provider' => $resultado['provider'],
            'total_miles' => $resultado['totalMiles'],
            'estimated_duration_minutes' => $resultado['estimatedDurationMinutes'],
            'estimated_toll_cents' => $resultado['estimatedTollCents'],
            'polyline' => $resultado['polyline'],
            'legs' => json_encode($resultado['legs']),
            'calculated_at' => $ahora,
            'is_current' => 1,
            'created_at' => $ahora,
            'updated_at' => $ahora,
        ]);

        $filas = [];

        foreach ($resultado['states'] as $estado) {
            $filas[] = [
                'id' => (string) Str::uuid(),
                'tenant_id' => $tenantId,
                'route_id' => $routeId,
                'state_code' => $estado['state'],
                'sequence' => $estado['sequence'],
                'miles_in_state' => $estado['milesInState'],
                'created_at' => $ahora,
                'updated_at' => $ahora,
            ];
        }

        if ($filas !== []) {
            DB::table('route_states')->insert($filas);
        }

        return [
            'routeId' => $routeId,
            'states' => array_map(static fn (array $e): string => $e['state'], $resultado['states']),
            'warnings' => $resultado['warnings'],
        ];
    }

    /** El recorrido vigente de una carga, con sus estados. */
    public static function current(string $tenantId, string $loadId): ?object
    {
        $ruta = DB::table('routes')
            ->where('tenant_id', $tenantId)
            ->where('load_id', $loadId)
            ->where('is_current', 1)
            ->whereNull('deleted_at')
            ->orderByDesc('calculated_at')
            ->first();

        if ($ruta === null) {
            return null;
        }

        $ruta->states = DB::table('route_states')
            ->where('route_id', $ruta->id)
            ->orderBy('sequence')
            ->get(['state_code', 'sequence', 'miles_in_state'])
            ->all();

        return $ruta;
    }
}
