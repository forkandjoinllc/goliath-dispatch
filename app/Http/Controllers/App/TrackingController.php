<?php

declare(strict_types=1);

namespace App\Http\Controllers\App;

use App\Authorization\Actor;
use App\Authorization\CurrentActor;
use App\Authorization\PermissionChecker;
use App\Enums\Scope;
use App\Models\Load;
use App\Support\EnumValue;
use App\Support\InertiaPage;
use App\Support\Loads\LoadScope;
use App\Support\TenantContext;
use App\Support\Tracking\Consent;
use App\Support\Tracking\CustomerLink;
use App\Support\Tracking\Sessions;
use App\Support\Tracking\TrackingLinks;
use Carbon\CarbonImmutable;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\App;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Inertia\Inertia;
use Inertia\Response;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * «¿Dónde va mi carga?», contestado por personas.
 *
 * Las cinco tablas de seguimiento llevaban vacías desde el primer día y los dos
 * ajustes de rastreo público se guardaban sin que nadie los leyera. Este lote
 * construye la mitad que no necesita un proveedor de telemática: las llamadas
 * de control que anota alguien de despacho, y el enlace que se le manda al
 * cliente para que lo siga sin cuenta.
 *
 * Lo que se deja fuera A PROPÓSITO, y conviene que quede escrito:
 *
 *  - `tracking_sessions` y `tracking_events` no se tocan. `session_id` es NOT
 *    NULL en los eventos, o sea que el esquema da por hecho que un evento viene
 *    de una sesión de proveedor. Inventar sesiones falsas para colgar de ellas
 *    posiciones tecleadas a mano ensuciaría la tabla que mañana tiene que
 *    guardar GPS de verdad.
 *  - El consentimiento del conductor tampoco. Existe para proteger el rastreo
 *    por GPS; construirlo antes que el GPS sería pedir permiso para algo que
 *    todavía no ocurre. Va con el lote que lo necesita.
 *
 * El vocabulario sale del diccionario PORTADO `tracking.json`, que ya traía en
 * los dos idiomas los estados del enlace, los mensajes de la página pública y
 * hasta la advertencia de que el enlace solo se enseña una vez. Lo único que se
 * añadió fue la sección del tablero, porque la portada —`fleetView`— habla de
 * sesiones de GPS activas y aquí todavía no hay ninguna.
 */
final class TrackingController
{
    use InertiaPage;

    /** Estados de carga que se consideran «en la carretera». */
    private const EN_RUTA = [
        'dispatched', 'en_route_to_pickup', 'at_pickup', 'in_transit', 'at_delivery',
    ];

    /** @var list<string> */
    private const ORIGENES = ['scheduled', 'manual'];

    /**
     * El tablero: qué hay rodando y cuándo se comprobó por última vez.
     */
    public function board(Request $request, CurrentActor $current, PermissionChecker $checker): Response
    {
        $actor = $current->require();
        $policy = $current->policy();
        $scope = $checker->authorize($actor, 'tracking:read', null, $policy);

        $this->usesDictionary($request, ['tracking', 'loads', 'nav', 'common']);

        $soloAtrasadas = $request->query('overdue') === '1';

        $cargas = LoadScope::apply(
            Load::query()->where('loads.tenant_id', $actor->tenantId),
            $checker,
            $actor,
            $scope,
        )
            ->whereIn('loads.status', self::EN_RUTA)
            ->orderBy('loads.planned_delivery_at')
            ->limit(200)
            ->get(['loads.id', 'loads.load_number', 'loads.status', 'loads.carrier_id',
                'loads.planned_delivery_at']);

        $filas = $this->withCheckCalls($actor, $cargas);

        if ($soloAtrasadas) {
            $filas = array_values(array_filter($filas, static fn (array $f): bool => $f['overdue']));
        }

        return Inertia::render('App/Tracking/Board', [
            'loads' => $filas,
            'filters' => ['overdue' => $soloAtrasadas ? '1' : ''],
            'can' => [
                'manage' => $checker->can($actor, 'tracking:manage', null, $policy)->allowed,
            ],
        ]);
    }

    /**
     * El panel de una carga: sus llamadas de control y sus enlaces.
     */
    public function show(Request $request, string $load, CurrentActor $current, PermissionChecker $checker): Response
    {
        $actor = $current->require();
        $policy = $current->policy();
        $scope = $checker->authorize($actor, 'tracking:read', null, $policy);

        $this->usesDictionary($request, ['tracking', 'loads', 'nav', 'common', 'validation']);

        $carga = $this->findLoad($actor, $checker, $scope, $load);

        return Inertia::render('App/Tracking/Show', [
            'load' => [
                'id' => (string) $carga->id,
                'number' => (string) $carga->load_number,
                'status' => EnumValue::of($carga->status),
            ],
            'stops' => $this->stops($actor, (string) $carga->id),
            'checkCalls' => $this->checkCalls($actor, (string) $carga->id),
            'links' => $this->links($actor, (string) $carga->id),
            // El enlace recién creado llega por el flash de la sesión y se lee
            // AQUÍ, no en la bolsa `flash` compartida: esa solo lleva
            // `success` y `error` a propósito. Mismo patrón que SignupController.
            'newLinkUrl' => $request->session()->get('trackingToken'),
            // La sesión de rastreo y el consentimiento bajo el que podría
            // abrirse. Las dos cosas juntas porque la pantalla tiene que poder
            // decir POR QUÉ no se puede empezar, no solo que no.
            'session' => $this->sessionPanel($actor, (string) $carga->id),
            'publicTrackingEnabled' => TrackingLinks::enabledFor((string) $actor->tenantId),
            'defaultTtlHours' => TrackingLinks::defaultTtlHours((string) $actor->tenantId),
            'can' => [
                'manage' => $checker->can($actor, 'tracking:manage', null, $policy)->allowed,
                'createLink' => $checker->can($actor, 'tracking:link:create', null, $policy)->allowed,
                'revokeLink' => $checker->can($actor, 'tracking:link:revoke', null, $policy)->allowed,
            ],
        ]);
    }

    /**
     * Programar una llamada de control, o anotar una ya hecha.
     *
     * Las dos cosas por la misma puerta porque son la misma fila: `origin`
     * distingue la que se dejó agendada de la que alguien apuntó después de
     * colgar el teléfono. Anotar una ya hecha rellena `completed_at` de una vez.
     */
    public function storeCheckCall(Request $request, string $load, CurrentActor $current, PermissionChecker $checker): RedirectResponse
    {
        $actor = $current->require();
        $policy = $current->policy();
        $scope = $checker->authorize($actor, 'tracking:read', null, $policy);
        $checker->authorize($actor, 'tracking:manage', null, $policy);

        $carga = $this->findLoad($actor, $checker, $scope, $load);

        $data = $request->validate([
            'scheduled_for' => ['required', 'date'],
            'origin' => ['required', 'string', Rule::in(self::ORIGENES)],
            'notes' => ['nullable', 'string', 'max:2000'],
            'location_summary' => ['nullable', 'string', 'max:200'],
            'completed' => ['required', 'boolean'],
        ]);

        $ahora = CarbonImmutable::now();

        DB::table('check_calls')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $actor->tenantId,
            'load_id' => $carga->id,
            'scheduled_for' => CarbonImmutable::parse($data['scheduled_for']),
            'completed_at' => $data['completed'] ? $ahora : null,
            'completed_by_user_id' => $data['completed'] ? $actor->userId : null,
            'origin' => $data['origin'],
            'notes' => $data['notes'] ?? null,
            'location_summary' => $data['location_summary'] ?? null,
            'created_at' => $ahora,
            'updated_at' => $ahora,
        ]);

        return back()->with('success', __('tracking.checkCalls.saved'));
    }

    /**
     * Marcar como hecha una que estaba agendada.
     *
     * Se puede añadir el resumen de ubicación al completarla: es justo lo que se
     * sabe DESPUÉS de la llamada y no antes.
     */
    public function completeCheckCall(Request $request, string $load, string $checkCall, CurrentActor $current, PermissionChecker $checker): RedirectResponse
    {
        $actor = $current->require();
        $policy = $current->policy();
        $scope = $checker->authorize($actor, 'tracking:read', null, $policy);
        $checker->authorize($actor, 'tracking:manage', null, $policy);

        $carga = $this->findLoad($actor, $checker, $scope, $load);

        $data = $request->validate([
            'notes' => ['nullable', 'string', 'max:2000'],
            'location_summary' => ['nullable', 'string', 'max:200'],
        ]);

        $ahora = CarbonImmutable::now();

        // El `where` sobre empresa Y carga es la frontera: sin la carga, el id de
        // una llamada de otra carga de la misma empresa se completaría desde
        // aquí, y quien mira esta pantalla puede no tener acceso a aquella.
        $tocadas = DB::table('check_calls')
            ->where('tenant_id', $actor->tenantId)
            ->where('load_id', $carga->id)
            ->where('id', $checkCall)
            ->whereNull('completed_at')
            ->whereNull('deleted_at')
            ->update([
                'completed_at' => $ahora,
                'completed_by_user_id' => $actor->userId,
                'notes' => $data['notes'] ?? DB::raw('notes'),
                'location_summary' => $data['location_summary'] ?? DB::raw('location_summary'),
                'updated_at' => $ahora,
            ]);

        if ($tocadas === 0) {
            return back()->with('error', __('tracking.checkCalls.alreadyDone'));
        }

        return back()->with('success', __('tracking.checkCalls.completed'));
    }


    /**
     * Crear un enlace para un cliente.
     *
     * Devuelve el token EN CLARO una sola vez, en el flash. No se guarda en
     * ninguna parte más: la tabla solo tiene su sha256, así que ni una copia de
     * seguridad ni un volcado de soporte abren el seguimiento de nadie. El
     * diccionario portado ya lo daba por hecho — «cópielo ahora, no se mostrará
     * de nuevo»— y esta es la implementación que lo cumple.
     */
    public function storeLink(Request $request, string $load, CurrentActor $current, PermissionChecker $checker): RedirectResponse
    {
        $actor = $current->require();
        $policy = $current->policy();
        $scope = $checker->authorize($actor, 'tracking:read', null, $policy);
        $checker->authorize($actor, 'tracking:link:create', null, $policy);

        $carga = $this->findLoad($actor, $checker, $scope, $load);

        if (! TrackingLinks::enabledFor((string) $actor->tenantId)) {
            return back()->with('error', __('tracking.errors.publicTrackingDisabled'));
        }

        $data = $request->validate([
            'label' => ['nullable', 'string', 'max:120'],
            'recipient_email' => ['nullable', 'email', 'max:255'],
            'ttl_hours' => ['nullable', 'integer', 'min:1', 'max:720'],
        ]);

        $enlace = TrackingLinks::issue(
            tenantId: (string) $actor->tenantId,
            loadId: (string) $carga->id,
            label: $data['label'] ?? null,
            recipientEmail: $data['recipient_email'] ?? null,
            ttlHours: $data['ttl_hours'] ?? null,
            createdByUserId: $actor->userId,
        );

        return back()
            ->with('success', __('tracking.publicLink.createSuccess'))
            // Viaja una vez, en el flash de ESTA respuesta. La siguiente
            // recarga ya no lo tiene, que es exactamente lo que se promete.
            //
            // Con el prefijo del idioma en el que está trabajando quien lo
            // reparte: el cliente lo abre desde un correo, sin cookie ni
            // sesión, y sin esto leería lo que diga el navegador de su oficina.
            ->with('trackingToken', url('/'.App::getLocale().'/t/'.$enlace['token']));
    }

    /**
     * Mandarle el enlace a una dirección, porque alguien lo ha pedido.
     *
     * El caso de «el cliente llama diciendo que no le llegó». Emite un enlace
     * NUEVO en vez de reenviar el viejo: del anterior solo se guarda el hash del
     * token, así que reenviarlo es imposible por construcción — y esa propiedad
     * conviene conservarla, no rodearla.
     */
    public function sendLink(Request $request, string $load, CurrentActor $current, PermissionChecker $checker): RedirectResponse
    {
        $actor = $current->require();
        $policy = $current->policy();
        $scope = $checker->authorize($actor, 'tracking:read', null, $policy);
        $checker->authorize($actor, 'tracking:link:create', null, $policy);

        $carga = $this->findLoad($actor, $checker, $scope, $load);

        if (! TrackingLinks::enabledFor((string) $actor->tenantId)) {
            return back()->with('error', __('tracking.errors.publicTrackingDisabled'));
        }

        $data = $request->validate([
            'email' => ['required', 'email', 'max:255'],
        ]);

        $salio = CustomerLink::sendTo(
            (string) $actor->tenantId,
            (string) $carga->id,
            $data['email'],
            $actor->auditUserId(),
        );

        return back()->with(
            $salio ? 'success' : 'error',
            __($salio ? 'tracking.publicLink.sendSuccess' : 'tracking.publicLink.sendFailed'),
        );
    }

    public function revokeLink(Request $request, string $load, string $link, CurrentActor $current, PermissionChecker $checker): RedirectResponse
    {
        $actor = $current->require();
        $policy = $current->policy();
        $scope = $checker->authorize($actor, 'tracking:read', null, $policy);
        $checker->authorize($actor, 'tracking:link:revoke', null, $policy);

        $carga = $this->findLoad($actor, $checker, $scope, $load);

        $revocado = TrackingLinks::revoke((string) $actor->tenantId, (string) $carga->id, $link);

        return back()->with(
            $revocado ? 'success' : 'error',
            __($revocado ? 'tracking.publicLink.revokeSuccess' : 'tracking.errors.linkNotFound'),
        );
    }

    /**
     * Arrancar el rastreo de una carga.
     *
     * La puerta que la pantalla llevaba prometiendo desde el primer día: sin
     * consentimiento vigente del conductor, esto no empieza. Ver
     * App\Support\Tracking\Consent.
     */
    public function startSession(Request $request, string $load, CurrentActor $current, PermissionChecker $checker): RedirectResponse
    {
        $actor = $current->require();
        $policy = $current->policy();
        $scope = $checker->authorize($actor, 'tracking:read', null, $policy);
        $checker->authorize($actor, 'tracking:manage', null, $policy);

        $carga = $this->findLoad($actor, $checker, $scope, $load);
        $recursos = $this->assignedResources((string) $carga->id);

        if ($recursos['driver_id'] === null) {
            return back()->with('error', __('tracking.errors.noDriverAssigned'));
        }

        try {
            Sessions::iniciar(
                $actor,
                (string) $carga->id,
                (string) $recursos['driver_id'],
                $recursos['truck_id'],
            );
        } catch (\RuntimeException $e) {
            return back()->with('error', __('tracking.errors.'.$e->getMessage()));
        }

        return back()->with('success', __('tracking.session.startSuccess'));
    }

    /** Pararlo a mano. Retirar el consentimiento lo para solo. */
    public function stopSession(Request $request, string $load, CurrentActor $current, PermissionChecker $checker): RedirectResponse
    {
        $actor = $current->require();
        $policy = $current->policy();
        $scope = $checker->authorize($actor, 'tracking:read', null, $policy);
        $checker->authorize($actor, 'tracking:manage', null, $policy);

        $carga = $this->findLoad($actor, $checker, $scope, $load);

        $parada = Sessions::detener((string) $actor->tenantId, (string) $carga->id);

        return back()->with(
            $parada ? 'success' : 'error',
            __($parada ? 'tracking.session.endSuccess' : 'tracking.session.notStarted'),
        );
    }

    // ------------------------------------------------------------------ ayudas

    /**
     * El estado del rastreo de esta carga, para la pantalla.
     *
     * @return array<string, mixed>
     */
    private function sessionPanel(Actor $actor, string $loadId): array
    {
        $tenantId = (string) $actor->tenantId;
        $abierta = Sessions::abierta($tenantId, $loadId);
        $recursos = $this->assignedResources($loadId);
        $driverId = $recursos['driver_id'] === null ? null : (string) $recursos['driver_id'];

        $conductor = $driverId === null
            ? null
            : DB::table('drivers')->where('id', $driverId)->first(['id', 'first_name', 'last_name', 'user_id']);

        return [
            'startedAt' => $abierta?->started_at === null ? null : substr((string) $abierta->started_at, 0, 16),
            'running' => $abierta !== null,
            'driver' => $conductor === null ? null : [
                'id' => (string) $conductor->id,
                'name' => trim($conductor->first_name.' '.$conductor->last_name),
            ],
            // Por qué no se puede empezar. Una clave, no una frase: ver la
            // lección del lote 55 sobre props que llegan ya traducidas.
            'blockedBy' => match (true) {
                $driverId === null => 'noDriverAssigned',
                ! Consent::permiteRastrear($tenantId, $driverId) => 'trackingConsentMissing',
                default => null,
            },
        ];
    }

    /**
     * El conductor y el camión que lleva esta carga ahora mismo.
     *
     * @return array{driver_id: ?string, truck_id: ?string}
     */
    private function assignedResources(string $loadId): array
    {
        $filas = DB::table('load_assignments')
            ->where('load_id', $loadId)
            ->whereNull('unassigned_at')
            ->whereNull('deleted_at')
            ->get(['driver_id', 'truck_id']);

        return [
            'driver_id' => $filas->pluck('driver_id')->filter()->first(),
            'truck_id' => $filas->pluck('truck_id')->filter()->first(),
        ];
    }


    /**
     * La carga, con el mismo estrechamiento que la pantalla de cargas.
     */
    private function findLoad(Actor $actor, PermissionChecker $checker, Scope $scope, string $id): object
    {
        $carga = LoadScope::apply(
            Load::query()->where('loads.tenant_id', $actor->tenantId),
            $checker,
            $actor,
            $scope,
        )->where('loads.id', $id)->first(['loads.id', 'loads.load_number', 'loads.status']);

        if ($carga === null) {
            throw new NotFoundHttpException;
        }

        return $carga;
    }

    /**
     * Une cada carga con su última llamada hecha y su próxima pendiente.
     *
     * Dos consultas para todas las cargas y no dos por carga: el tablero enseña
     * hasta doscientas y una consulta por fila sería cuatrocientas.
     *
     * @param  \Illuminate\Support\Collection<int, Load>  $cargas
     * @return list<array<string, mixed>>
     */
    private function withCheckCalls(Actor $actor, $cargas): array
    {
        $ids = $cargas->map(static fn (Load $l): string => (string) $l->id)->all();

        if ($ids === []) {
            return [];
        }

        $ultimas = DB::table('check_calls')
            ->where('tenant_id', $actor->tenantId)
            ->whereIn('load_id', $ids)
            ->whereNotNull('completed_at')
            ->whereNull('deleted_at')
            ->orderByDesc('completed_at')
            ->get(['load_id', 'completed_at', 'location_summary'])
            ->unique('load_id')
            ->keyBy('load_id');

        $proximas = DB::table('check_calls')
            ->where('tenant_id', $actor->tenantId)
            ->whereIn('load_id', $ids)
            ->whereNull('completed_at')
            ->whereNull('deleted_at')
            ->orderBy('scheduled_for')
            ->get(['load_id', 'scheduled_for'])
            ->unique('load_id')
            ->keyBy('load_id');

        $ahora = CarbonImmutable::now();
        $nombres = $this->carrierNames($actor, $cargas->pluck('carrier_id')->filter()->unique()->all());

        return $cargas->map(function (Load $l) use ($ultimas, $proximas, $ahora, $nombres): array {
            $id = (string) $l->id;
            $ultima = $ultimas->get($id);
            $proxima = $proximas->get($id);
            $vence = $proxima === null ? null : CarbonImmutable::parse((string) $proxima->scheduled_for);

            return [
                'id' => $id,
                'number' => (string) $l->load_number,
                'status' => EnumValue::of($l->status),
                'carrierName' => $l->carrier_id === null ? null : ($nombres[(string) $l->carrier_id] ?? null),
                'plannedDeliveryOn' => $l->planned_delivery_at === null
                    ? null
                    : substr((string) $l->planned_delivery_at, 0, 10),
                'lastCheckedAt' => $ultima === null ? null : substr((string) $ultima->completed_at, 0, 16),
                'lastLocation' => $ultima?->location_summary,
                'nextDueAt' => $vence?->format('Y-m-d H:i'),
                // Atrasada: hay una agendada y su hora ya pasó. Sin ninguna
                // agendada NO se considera atrasada — no haber quedado en llamar
                // no es lo mismo que faltar a la llamada.
                'overdue' => $vence !== null && $vence->isBefore($ahora),
            ];
        })->all();
    }

    /**
     * @param  list<string>  $ids
     * @return array<string, string>
     */
    private function carrierNames(Actor $actor, array $ids): array
    {
        if ($ids === []) {
            return [];
        }

        return DB::table('carriers')
            ->where('tenant_id', $actor->tenantId)
            ->whereIn('id', $ids)
            ->pluck('legal_name', 'id')
            ->map(static fn ($n): string => (string) $n)
            ->all();
    }

    /** @return list<array<string, mixed>> */
    private function stops(Actor $actor, string $loadId): array
    {
        // Una parada puede apuntar a una ubicación del cliente o llevar su propia
        // dirección escrita a mano. Se prefiere la del cliente cuando existe:
        // es la que alguien mantiene al día. Misma regla que en LoadController.
        return DB::table('load_stops as s')
            ->leftJoin('customer_locations as cl', 'cl.id', '=', 's.customer_location_id')
            ->where('s.tenant_id', $actor->tenantId)
            ->where('s.load_id', $loadId)
            ->whereNull('s.deleted_at')
            ->orderBy('s.sequence')
            ->get([
                's.id', 's.stop_type', 's.sequence', 's.facility_name', 's.city', 's.state',
                's.window_start', 's.window_end', 's.actual_arrival_at', 's.actual_departure_at',
                'cl.name as location_name', 'cl.city as location_city', 'cl.state as location_state',
            ])
            ->map(static fn (object $s): array => [
                'id' => (string) $s->id,
                'type' => (string) $s->stop_type,
                'sequence' => (int) $s->sequence,
                'facility' => $s->location_name ?? $s->facility_name,
                'city' => $s->location_city ?? $s->city,
                'state' => $s->location_state ?? $s->state,
                'windowStart' => $s->window_start === null ? null : substr((string) $s->window_start, 0, 16),
                'windowEnd' => $s->window_end === null ? null : substr((string) $s->window_end, 0, 16),
                'arrivedAt' => $s->actual_arrival_at === null ? null : substr((string) $s->actual_arrival_at, 0, 16),
                'departedAt' => $s->actual_departure_at === null ? null : substr((string) $s->actual_departure_at, 0, 16),
            ])
            ->all();
    }

    /** @return list<array<string, mixed>> */
    private function checkCalls(Actor $actor, string $loadId): array
    {
        $filas = DB::table('check_calls')
            ->where('tenant_id', $actor->tenantId)
            ->where('load_id', $loadId)
            ->whereNull('deleted_at')
            ->orderByDesc('scheduled_for')
            ->limit(100)
            ->get();

        $nombres = $this->userNames($filas->pluck('completed_by_user_id')->filter()->unique()->all());
        $ahora = CarbonImmutable::now();

        return $filas->map(static fn (object $c): array => [
            'id' => (string) $c->id,
            'scheduledFor' => substr((string) $c->scheduled_for, 0, 16),
            'completedAt' => $c->completed_at === null ? null : substr((string) $c->completed_at, 0, 16),
            'completedBy' => $c->completed_by_user_id === null
                ? null
                : ($nombres[(string) $c->completed_by_user_id] ?? null),
            'origin' => (string) $c->origin,
            'notes' => $c->notes,
            'locationSummary' => $c->location_summary,
            'overdue' => $c->completed_at === null
                && CarbonImmutable::parse((string) $c->scheduled_for)->isBefore($ahora),
        ])->all();
    }

    /** @return list<array<string, mixed>> */
    private function links(Actor $actor, string $loadId): array
    {
        return TrackingLinks::forLoad((string) $actor->tenantId, $loadId);
    }

    /**
     * @param  list<string>  $ids
     * @return array<string, string>
     */
    private function userNames(array $ids): array
    {
        if ($ids === []) {
            return [];
        }

        return app(TenantContext::class)->withoutTenant(fn (): array => DB::table('users')
            ->whereIn('id', $ids)
            ->get(['id', 'first_name', 'last_name'])
            ->mapWithKeys(static fn (object $u): array => [
                (string) $u->id => trim("{$u->first_name} {$u->last_name}"),
            ])
            ->all());
    }
}
