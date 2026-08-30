<?php

declare(strict_types=1);

namespace App\Http\Controllers\Public;

use App\Support\InertiaPage;
use App\Support\Tenancy\TenantPolicy;
use App\Support\TenantContext;
use App\Support\Tracking\TrackingLinks;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Inertia\Inertia;
use Symfony\Component\HttpFoundation\Response;

/**
 * La página que ve el cliente final. Sin sesión, sin cuenta, sin menú.
 *
 * Es la única superficie del producto donde un desconocido lee datos de una
 * empresa, así que las reglas son más estrictas que en cualquier otra pantalla:
 *
 *  - **El token ES la autorización.** De él sale el `tenant_id`, y ese id
 *    estrecha todo lo demás. Nunca al revés: aquí no hay actor, no hay permisos
 *    y no hay empresa activa que consultar.
 *  - **Se enseña lo mínimo.** Número de carga, estado, transportista, paradas
 *    con su ventana y sus horas reales, y la última llamada de control. NO
 *    viajan al cliente: lo que se cobra, lo que se le paga al transportista, los
 *    otros clientes, las notas internas de las llamadas, ni un solo
 *    identificador con el que probar otra dirección.
 *  - **Tres estados, tres textos.** Un enlace que no existe está mal copiado;
 *    uno vencido se arregla pidiendo otro; uno revocado se lo quitaron a
 *    propósito. Contestar «no válido» a los tres sería cómodo y le haría perder
 *    el tiempo a alguien. Los cuatro casos dan 404 igual: la diferencia está en
 *    el texto, no en el código de estado — uno distinto por estado le diría a
 *    quien prueba enlaces cuáles existieron alguna vez.
 *  - **Si la empresa apagó el rastreo público, no se sirve** — tampoco los
 *    enlaces ya repartidos. Si apagarlo solo impidiera crear nuevos, el ajuste
 *    no serviría para lo que uno lo apaga.
 *
 * El límite de peticiones va en la ruta. El token son 48 caracteres al azar y
 * adivinarlo es inviable, pero un límite corta de raíz que alguien lo intente a
 * ritmo de máquina.
 */
final class TrackingController
{
    use InertiaPage;

    public function __invoke(Request $request, string $token): Response
    {
        // Se declara antes de cualquier salida: las cuatro respuestas de
        // rechazo también son páginas y también necesitan sus textos.
        $this->usesDictionary($request, ['tracking', 'common']);

        $resuelto = TrackingLinks::resolve($token);

        if ($resuelto['state'] !== 'active') {
            return $this->rechazo($request, $resuelto['state']);
        }

        /** @var object $enlace */
        $enlace = $resuelto['link'];
        $tenantId = (string) $enlace->tenant_id;

        if (! TenantPolicy::for($tenantId)->publicTrackingEnabled) {
            return $this->rechazo($request, 'disabled');
        }

        $datos = app(TenantContext::class)->runAs($tenantId, function () use ($enlace, $tenantId): ?array {
            $carga = DB::table('loads')
                ->where('tenant_id', $tenantId)
                ->where('id', $enlace->load_id)
                ->whereNull('deleted_at')
                ->first(['id', 'load_number', 'status', 'carrier_id', 'planned_delivery_at']);

            if ($carga === null) {
                return null;
            }

            return [
                'load' => [
                    'number' => (string) $carga->load_number,
                    'status' => (string) $carga->status,
                    'carrierName' => $this->carrierName($tenantId, $carga->carrier_id),
                    'plannedDeliveryOn' => $carga->planned_delivery_at === null
                        ? null
                        : substr((string) $carga->planned_delivery_at, 0, 10),
                ],
                'stops' => $this->stops($tenantId, (string) $carga->id),
                'lastUpdate' => $this->lastCheckCall($tenantId, (string) $carga->id),
            ];
        });

        if ($datos === null) {
            return $this->rechazo($request, 'not_found');
        }

        // La visita se anota DESPUÉS de saber que hay algo que enseñar: un
        // enlace cuya carga se borró no cuenta como visto.
        TrackingLinks::recordView((string) $enlace->id);

        return Inertia::render('Public/Tracking', [
            ...$datos,
            'tenantName' => $this->tenantName($tenantId),
            'state' => 'active',
        ])->toResponse($request);
    }

    private function rechazo(Request $request, string $estado): Response
    {
        return Inertia::render('Public/Tracking', [
            'state' => $estado,
            'load' => null,
            'stops' => [],
            'lastUpdate' => null,
            'tenantName' => null,
        ])->toResponse($request)->setStatusCode(404);
    }

    private function carrierName(string $tenantId, mixed $carrierId): ?string
    {
        if ($carrierId === null) {
            return null;
        }

        $nombre = DB::table('carriers')
            ->where('tenant_id', $tenantId)
            ->where('id', $carrierId)
            ->value('legal_name');

        return $nombre === null ? null : (string) $nombre;
    }

    private function tenantName(string $tenantId): ?string
    {
        $nombre = app(TenantContext::class)->withoutTenant(fn () => DB::table('tenants')
            ->where('id', $tenantId)
            ->value('display_name'));

        return $nombre === null ? null : (string) $nombre;
    }

    /** @return list<array<string, mixed>> */
    private function stops(string $tenantId, string $loadId): array
    {
        // La ciudad puede estar en la parada o en la ubicación del cliente a la
        // que apunta. Sin este join, la página pública de una carga creada con
        // ubicaciones guardadas no dice de dónde a dónde va, que es lo único
        // que el cliente vino a ver.
        return DB::table('load_stops as s')
            ->leftJoin('customer_locations as cl', 'cl.id', '=', 's.customer_location_id')
            ->where('s.tenant_id', $tenantId)
            ->where('s.load_id', $loadId)
            ->whereNull('s.deleted_at')
            ->orderBy('s.sequence')
            ->get([
                's.stop_type', 's.city', 's.state', 's.window_start', 's.window_end',
                's.actual_arrival_at', 's.actual_departure_at',
                'cl.city as location_city', 'cl.state as location_state',
            ])
            ->map(static fn (object $s): array => [
                // Ni `id` ni `customer_location_id`: al cliente no le sirven y
                // son material para probar otras direcciones. Tampoco el NOMBRE
                // de la ubicación: la ciudad basta para seguir la carga.
                'type' => (string) $s->stop_type,
                'city' => $s->location_city ?? $s->city,
                'state' => $s->location_state ?? $s->state,
                'windowStart' => $s->window_start === null ? null : substr((string) $s->window_start, 0, 16),
                'windowEnd' => $s->window_end === null ? null : substr((string) $s->window_end, 0, 16),
                'arrivedAt' => $s->actual_arrival_at === null ? null : substr((string) $s->actual_arrival_at, 0, 16),
                'departedAt' => $s->actual_departure_at === null ? null : substr((string) $s->actual_departure_at, 0, 16),
            ])
            ->all();
    }

    /** @return array<string, mixed>|null */
    private function lastCheckCall(string $tenantId, string $loadId): ?array
    {
        $fila = DB::table('check_calls')
            ->where('tenant_id', $tenantId)
            ->where('load_id', $loadId)
            ->whereNotNull('completed_at')
            ->whereNull('deleted_at')
            ->orderByDesc('completed_at')
            ->first(['completed_at', 'location_summary']);

        if ($fila === null) {
            return null;
        }

        return [
            // Las NOTAS no viajan: son para despacho y pueden decir cualquier
            // cosa sobre el conductor o sobre el propio cliente. El resumen de
            // ubicación sí, que es justo lo que se escribe para poder contarlo.
            'at' => substr((string) $fila->completed_at, 0, 16),
            'location' => $fila->location_summary,
        ];
    }
}
