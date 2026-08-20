<?php

declare(strict_types=1);

namespace App\Http\Controllers\App;

use App\Authorization\Actor;
use App\Authorization\CurrentActor;
use App\Authorization\PermissionChecker;
use App\Authorization\ResourceContext;
use App\Enums\LoadStatus;
use App\Enums\Scope;
use App\Models\Load;
use App\Support\Finance\LoadCalculator;
use App\Support\InertiaPage;
use App\Support\Loads\Guards;
use App\Support\Loads\LoadScope;
use App\Support\Loads\Transitions;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Inertia\Inertia;
use Inertia\Response;

/**
 * Las cargas: lo que una oficina de despacho mira todo el día.
 *
 * Dos cosas la separan de transportistas y clientes.
 *
 * **El dinero tiene su propio permiso.** `load:financials:read` es distinto de
 * `load:read`, y la diferencia no es decorativa: un conductor tiene `load:read`
 * con ámbito propio y ninguna concesión financiera. Ve su carga, sus paradas y
 * sus horas, y NO ve lo que cobra la empresa ni lo que se le paga al
 * transportista. Si el bloque de dinero se enviara y se ocultara en React, ese
 * conductor podría leerlo abriendo las herramientas del navegador. Por eso el
 * bloque no se calcula siquiera cuando el permiso falta.
 *
 * **Un cambio de estado tiene dos preguntas, no una.** Transitions responde si
 * el paso es legal; Guards, si la carga está en condiciones de darlo. Se pueden
 * tener todos los permisos y aun así no poder despachar, porque el seguro del
 * transportista venció anoche. Ver App\Support\Loads\Guards.
 */
final class LoadController
{
    use InertiaPage;

    private const PER_PAGE = 25;

    /** Lista blanca: el parámetro de orden va a SQL. */
    private const SORTABLE = [
        'load_number' => 'load_number',
        'status' => 'status',
        'planned_pickup_at' => 'planned_pickup_at',
        'planned_delivery_at' => 'planned_delivery_at',
        'customer_charge_cents' => 'customer_charge_cents',
    ];

    public function index(Request $request, CurrentActor $current, PermissionChecker $checker): Response
    {
        $actor = $current->require();
        $policy = $current->policy();
        $scope = $checker->authorize($actor, 'load:read', null, $policy);

        $this->usesDictionary($request, ['loads', 'nav']);

        $showMoney = $checker->can($actor, 'load:financials:read', null, $policy)->allowed;

        $filters = [
            'search' => trim((string) $request->query('search', '')),
            'status' => (string) $request->query('status', ''),
            'customer' => (string) $request->query('customer', ''),
            'carrier' => (string) $request->query('carrier', ''),
            'sort' => (string) $request->query('sort', 'planned_pickup_at'),
            'direction' => $request->query('direction') === 'asc' ? 'asc' : 'desc',
        ];

        $query = $this->scoped($checker, $actor, $scope);
        $this->applyFilters($query, $filters);

        $sort = self::SORTABLE[$filters['sort']] ?? 'planned_pickup_at';

        $page = $query
            ->orderBy($sort, $filters['direction'])
            ->orderBy('id')
            ->paginate(self::PER_PAGE)
            ->withQueryString();

        $rows = collect($page->items());
        $names = $this->relatedNames($rows);

        return Inertia::render('App/Loads/Index', [
            'loads' => [
                'data' => $rows->map(fn (Load $l): array => $this->row($l, $names, $showMoney))->all(),
                'meta' => [
                    'total' => $page->total(),
                    'perPage' => $page->perPage(),
                    'currentPage' => $page->currentPage(),
                    'lastPage' => $page->lastPage(),
                ],
            ],
            'filters' => $filters,
            'scope' => $scope->value,
            // Los recuentos por estado se cuentan DENTRO del ámbito. Un
            // despachador que viera «disponibles: 40» sabría cuántas cargas hay
            // en la empresa aunque solo pueda abrir seis.
            'facets' => $this->facets($checker, $actor, $scope),
            'options' => $this->filterOptions($checker, $actor, $scope),
            'showMoney' => $showMoney,
            'can' => [
                'create' => $checker->can($actor, 'load:create', null, $policy)->allowed,
            ],
        ]);
    }

    public function show(Request $request, string $load, CurrentActor $current, PermissionChecker $checker): Response
    {
        $actor = $current->require();
        $policy = $current->policy();
        $model = $this->find($load);
        // Una vez por petición: resolver la asignación del conductor cuesta una
        // consulta, y show() consulta el contexto siete veces.
        $context = $this->context($model, $actor);

        $checker->authorize($actor, 'load:read', $context, $policy);

        $this->usesDictionary($request, ['loads', 'nav']);

        $canMoney = $checker->can($actor, 'load:financials:read', $context, $policy)->allowed;

        // Las acciones se filtran por las TRES condiciones a la vez: el grafo,
        // el permiso y las puertas de cumplimiento. La pantalla no decide nada;
        // solo pinta lo que el servidor ya decidió.
        $actions = [];
        foreach (Transitions::availableFrom($model->status) as $action) {
            $permission = Transitions::permission($action);

            if ($permission === null || ! $checker->can($actor, $permission, $context, $policy)->allowed) {
                continue;
            }

            $actions[] = [
                'action' => $action,
                'blocking' => Guards::blocking($model, $action),
                'requiresReason' => Transitions::requiresReason($action),
            ];
        }

        return Inertia::render('App/Loads/Show', [
            'load' => $this->detail($model),
            'stops' => $this->stops($model),
            'assignments' => $this->assignments($model),
            'history' => $this->history($model),
            // El bloque de dinero NO SE CALCULA si falta el permiso. Enviarlo y
            // esconderlo en React lo dejaría al alcance de cualquiera que abra
            // las herramientas del navegador.
            'financials' => $canMoney ? $this->financials($model) : null,
            'actions' => $actions,
            'can' => [
                'update' => $checker->can($actor, 'load:update', $context, $policy)->allowed,
                'updateFinancials' => $checker->can($actor, 'load:financials:update', $context, $policy)->allowed,
                'assignCarrier' => $checker->can($actor, 'load:assign_carrier', $context, $policy)->allowed,
                'assignResources' => $checker->can($actor, 'load:assign_resources', $context, $policy)->allowed,
                'duplicate' => $checker->can($actor, 'load:duplicate', $context, $policy)->allowed,
            ],
        ]);
    }

    /**
     * Cambia el estado de una carga.
     *
     * Tres comprobaciones, en este orden y por este motivo:
     *
     *  1. **El permiso**, con la carga concreta en la mano. Va primero porque un
     *     403 no debe revelar en qué estado está una carga que no puedes ver.
     *  2. **El grafo**. Da 422, no 403: distinguirlos importa — con un 403
     *     alguien iría a revisar permisos durante una hora cuando el problema es
     *     que otra persona ya movió la carga desde otra pestaña.
     *  3. **Las puertas de cumplimiento**. También 422, y nombrando cada motivo:
     *     «no se puede despachar» a secas obliga a adivinar.
     */
    public function transition(
        Request $request,
        string $load,
        string $action,
        CurrentActor $current,
        PermissionChecker $checker,
    ): RedirectResponse {
        $actor = $current->require();
        $model = $this->find($load);
        $context = $this->context($model, $actor);

        $permission = Transitions::permission($action);
        abort_if($permission === null, 404);

        $checker->authorize($actor, $permission, $context, $current->policy());

        if (! Transitions::allowedFrom($action, $model->status)) {
            return back()->withErrors([
                'action' => __('loads.transition.illegal', [
                    'from' => __("nav.status.load.{$model->status->value}"),
                ]),
            ]);
        }

        $blocking = Guards::blocking($model, $action);

        if ($blocking !== []) {
            return back()->withErrors([
                'action' => __('loads.transition.blocked').' '.implode(' ', array_map(
                    fn (string $key): string => __("loads.blocking.{$key}"),
                    $blocking,
                )),
            ]);
        }

        $reason = trim((string) $request->input('reason', ''));

        if (Transitions::requiresReason($action) && mb_strlen($reason) < 10) {
            return back()->withErrors(['reason' => __('loads.transition.reasonRequired')]);
        }

        $target = Transitions::target($action);
        $from = $model->status;

        DB::transaction(function () use ($model, $target, $from, $action, $reason, $actor): void {
            $model->status = $target;

            // Las marcas de tiempo que el estado implica. Se escriben aquí y no
            // se deducen después: `actual_delivery_at` es lo que se factura, y
            // recalcularlo a partir del historial daría una hora distinta cada
            // vez que alguien corrija una fila.
            match ($action) {
                'at_pickup' => $model->actual_pickup_at ??= now(),
                'delivered' => $model->actual_delivery_at ??= now(),
                'pod_received' => $model->pod_received_at ??= now(),
                'cancelled' => tap($model, function (Load $l) use ($reason): void {
                    $l->cancelled_at = now();
                    $l->cancellation_reason = $reason;
                }),
                default => null,
            };

            $model->save();

            DB::table('load_status_history')->insert([
                'id' => (string) \Illuminate\Support\Str::uuid(),
                'tenant_id' => $model->tenant_id,
                'load_id' => $model->id,
                'from_status' => $from->value,
                'to_status' => $target->value,
                'notes' => $reason !== '' ? $reason : null,
                'actor_user_id' => $actor->auditUserId(),
                // `source` distingue quién movió la carga: una persona, el
                // seguimiento por GPS al entrar en la geocerca, o una API de
                // cliente. Importa cuando alguien pregunta por qué la carga se
                // marcó entregada a las 3 de la mañana.
                'source' => 'user',
                'occurred_at' => now(),
                'created_at' => now(),
                'updated_at' => now(),
            ]);

            DB::table('audit_events')->insert([
                'id' => (string) \Illuminate\Support\Str::uuid(),
                'tenant_id' => $model->tenant_id,
                'actor_user_id' => $actor->auditUserId(),
                'action' => 'load.status_changed',
                'entity_type' => 'load',
                'entity_id' => $model->id,
                'before_summary' => json_encode(['status' => $from->value]),
                'after_summary' => json_encode(['status' => $target->value]),
                'reason' => $reason !== '' ? $reason : null,
                'created_at' => now(),
            ]);
        });

        return back()->with('success', __('loads.transition.done', [
            'status' => __("nav.status.load.{$target->value}"),
        ]));
    }

    // ------------------------------------------------------------------ interno

    /**
     * @return Builder<Load>
     */
    private function scoped(PermissionChecker $checker, Actor $actor, Scope $scope): Builder
    {
        return LoadScope::apply(Load::query(), $checker, $actor, $scope);
    }

    /**
     * @param  Builder<Load>  $query
     * @param  array<string, string>  $filters
     */
    private function applyFilters(Builder $query, array $filters): void
    {
        if ($filters['search'] !== '') {
            $term = '%'.str_replace(['%', '_'], ['\%', '\_'], $filters['search']).'%';

            $query->where(function (Builder $q) use ($term): void {
                $q->where('load_number', 'like', $term)
                    ->orWhere('customer_reference', 'like', $term)
                    ->orWhere('po_number', 'like', $term)
                    ->orWhere('commodity', 'like', $term);
            });
        }

        if (LoadStatus::tryFrom($filters['status']) !== null) {
            $query->where('status', $filters['status']);
        }

        if ($filters['customer'] !== '') {
            $query->where('customer_id', $filters['customer']);
        }

        if ($filters['carrier'] !== '') {
            $query->where('carrier_id', $filters['carrier']);
        }
    }

    /**
     * @return array<string, int>
     */
    private function facets(PermissionChecker $checker, Actor $actor, Scope $scope): array
    {
        $counts = $this->scoped($checker, $actor, $scope)
            ->select('status', DB::raw('count(*) as total'))
            ->groupBy('status')
            ->pluck('total', 'status')
            ->all();

        $out = ['all' => array_sum($counts)];

        foreach (LoadStatus::cases() as $case) {
            $out[$case->value] = (int) ($counts[$case->value] ?? 0);
        }

        return $out;
    }

    /**
     * Los clientes y transportistas que APARECEN en las cargas visibles.
     *
     * No el catálogo entero: un desplegable con los treinta clientes de la
     * empresa le diría a un despachador de seis cargas quiénes son todos los
     * clientes, que es justo lo que su ámbito le niega.
     *
     * @return array{customers: list<array{id: string, name: string}>, carriers: list<array{id: string, name: string}>}
     */
    private function filterOptions(PermissionChecker $checker, Actor $actor, Scope $scope): array
    {
        $ids = $this->scoped($checker, $actor, $scope)
            ->select('customer_id', 'carrier_id')
            ->get();

        $customerIds = $ids->pluck('customer_id')->filter()->unique()->all();
        $carrierIds = $ids->pluck('carrier_id')->filter()->unique()->all();

        return [
            'customers' => $customerIds === [] ? [] : DB::table('customers')
                ->whereIn('id', $customerIds)
                ->orderBy('company_name')
                ->get(['id', 'company_name as name'])
                ->map(fn ($r): array => ['id' => (string) $r->id, 'name' => (string) $r->name])
                ->all(),
            'carriers' => $carrierIds === [] ? [] : DB::table('carriers')
                ->whereIn('id', $carrierIds)
                ->orderBy('legal_name')
                ->get(['id', 'legal_name as name'])
                ->map(fn ($r): array => ['id' => (string) $r->id, 'name' => (string) $r->name])
                ->all(),
        ];
    }

    /**
     * Nombres de cliente y transportista para las filas de la página actual.
     *
     * En DOS consultas, no una por fila. Con veinticinco cargas en pantalla la
     * diferencia son cincuenta viajes a la base de datos por cada listado.
     *
     * @param  \Illuminate\Support\Collection<int, Load>  $rows
     * @return array{customers: array<string, string>, carriers: array<string, string>}
     */
    private function relatedNames($rows): array
    {
        $customerIds = $rows->pluck('customer_id')->filter()->unique()->all();
        $carrierIds = $rows->pluck('carrier_id')->filter()->unique()->all();

        return [
            'customers' => $customerIds === [] ? [] : DB::table('customers')
                ->whereIn('id', $customerIds)->pluck('company_name', 'id')->all(),
            'carriers' => $carrierIds === [] ? [] : DB::table('carriers')
                ->whereIn('id', $carrierIds)->pluck('legal_name', 'id')->all(),
        ];
    }

    private function find(string $id): Load
    {
        return Load::query()->findOrFail($id);
    }

    /**
     * Los hechos de esta carga que permiten evaluar un ámbito estrecho.
     *
     * El transportista y el despachador salen de columnas. El CONDUCTOR no: una
     * carga puede llevar varios, y viven en `load_assignments`. ResourceContext
     * guarda un solo `driverId`, así que se resuelve la pregunta concreta —
     * «¿va ESTE conductor en esta carga?»— en vez de materializar el conjunto.
     *
     * Sigue siendo un hecho del recurso, no del actor: la respuesta no depende
     * de quién pregunta sino de si existe la fila de asignación. Se pasa el
     * actor solo para saber por cuál preguntar.
     *
     * Sin esto, un conductor veía su carga en el listado —LoadScope sí sabe
     * llegar por `load_assignments`— y recibía 403 al abrirla. El listado
     * enseñando algo que el detalle niega es de los fallos más desconcertantes
     * que puede tener un sistema de permisos.
     */
    private function context(Load $load, ?Actor $actor = null): ResourceContext
    {
        $driverId = null;

        if ($actor?->driverId !== null) {
            $onThisLoad = DB::table('load_assignments')
                ->where('load_id', $load->id)
                ->where('driver_id', $actor->driverId)
                ->whereNull('unassigned_at')
                ->whereNull('deleted_at')
                ->exists();

            $driverId = $onThisLoad ? $actor->driverId : null;
        }

        return new ResourceContext(
            tenantId: $load->tenant_id,
            carrierId: $load->carrier_id,
            dispatcherUserId: $load->dispatcher_user_id,
            ownerUserId: $load->dispatcher_user_id,
            driverId: $driverId,
        );
    }

    /**
     * @param  array{customers: array<string, string>, carriers: array<string, string>}  $names
     * @return array<string, mixed>
     */
    private function row(Load $l, array $names, bool $showMoney): array
    {
        return [
            'id' => $l->id,
            'loadNumber' => $l->load_number,
            'status' => $l->status->value,
            'customer' => $names['customers'][$l->customer_id] ?? null,
            'carrier' => $l->carrier_id === null ? null : ($names['carriers'][$l->carrier_id] ?? null),
            'commodity' => $l->commodity,
            'isOversize' => (bool) $l->is_oversize,
            'plannedPickupAt' => $l->planned_pickup_at?->toIso8601String(),
            'plannedDeliveryAt' => $l->planned_delivery_at?->toIso8601String(),
            'miles' => $l->miles === null ? null : (int) $l->miles,
            // Cuando falta el permiso, la clave sale con null en vez de omitirse:
            // así el tipo de TypeScript es uno solo y la tabla no tiene que
            // adivinar si la columna existe.
            'customerChargeCents' => $showMoney ? (int) $l->customer_charge_cents : null,
            'carrierGrossRateCents' => $showMoney ? (int) $l->carrier_gross_rate_cents : null,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function detail(Load $l): array
    {
        $customer = DB::table('customers')->where('id', $l->customer_id)->first(['id', 'company_name']);
        $carrier = $l->carrier_id === null ? null : DB::table('carriers')
            ->where('id', $l->carrier_id)->first(['id', 'legal_name', 'dot_number', 'onboarding_status']);

        return [
            'id' => $l->id,
            'loadNumber' => $l->load_number,
            'status' => $l->status->value,
            'customerReference' => $l->customer_reference,
            'poNumber' => $l->po_number,
            'customer' => $customer === null ? null : [
                'id' => (string) $customer->id,
                'name' => (string) $customer->company_name,
            ],
            'carrier' => $carrier === null ? null : [
                'id' => (string) $carrier->id,
                'name' => (string) $carrier->legal_name,
                'dotNumber' => (string) $carrier->dot_number,
                'onboardingStatus' => (string) $carrier->onboarding_status,
            ],
            'commodity' => $l->commodity,
            'weightPounds' => $l->weight_pounds === null ? null : (int) $l->weight_pounds,
            'pieceCount' => $l->piece_count === null ? null : (int) $l->piece_count,
            'dimensions' => [
                'length' => $l->length_inches === null ? null : (int) $l->length_inches,
                'width' => $l->width_inches === null ? null : (int) $l->width_inches,
                'height' => $l->height_inches === null ? null : (int) $l->height_inches,
            ],
            'isOversize' => (bool) $l->is_oversize,
            'isOverweight' => (bool) $l->is_overweight,
            'permitApprovedAt' => $l->permit_ready_approved_at?->toIso8601String(),
            'miles' => $l->miles === null ? null : (int) $l->miles,
            'deadheadMiles' => $l->deadhead_miles === null ? null : (int) $l->deadhead_miles,
            'plannedPickupAt' => $l->planned_pickup_at?->toIso8601String(),
            'plannedDeliveryAt' => $l->planned_delivery_at?->toIso8601String(),
            'actualPickupAt' => $l->actual_pickup_at?->toIso8601String(),
            'actualDeliveryAt' => $l->actual_delivery_at?->toIso8601String(),
            'podReceivedAt' => $l->pod_received_at?->toIso8601String(),
            'specialInstructions' => $l->special_instructions,
            'internalNotes' => $l->internal_notes,
            'cancellationReason' => $l->cancellation_reason,
        ];
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function stops(Load $l): array
    {
        return DB::table('load_stops as s')
            ->leftJoin('customer_locations as cl', 'cl.id', '=', 's.customer_location_id')
            ->where('s.load_id', $l->id)
            ->whereNull('s.deleted_at')
            ->orderBy('s.sequence')
            ->get([
                's.id', 's.stop_type', 's.sequence', 's.facility_name', 's.line1', 's.city',
                's.state', 's.postal_code', 's.timezone', 's.appointment_type',
                's.window_start', 's.window_end', 's.actual_arrival_at', 's.actual_departure_at',
                's.detention_minutes', 's.instructions', 's.contact_name', 's.contact_phone',
                'cl.name as location_name', 'cl.line1 as location_line1', 'cl.city as location_city',
                'cl.state as location_state', 'cl.postal_code as location_postal',
            ])
            ->map(fn ($s): array => [
                'id' => (string) $s->id,
                'type' => (string) $s->stop_type,
                'sequence' => (int) $s->sequence,
                // La parada puede apuntar a una ubicación del cliente o llevar su
                // propia dirección escrita a mano. Se prefiere la del cliente
                // cuando existe: es la que alguien mantiene al día.
                'name' => $s->location_name ?? $s->facility_name,
                'line1' => $s->location_line1 ?? $s->line1,
                'city' => $s->location_city ?? $s->city,
                'state' => $s->location_state ?? $s->state,
                'postalCode' => $s->location_postal ?? $s->postal_code,
                'timezone' => (string) $s->timezone,
                'appointmentType' => (string) $s->appointment_type,
                'windowStart' => $s->window_start,
                'windowEnd' => $s->window_end,
                'actualArrivalAt' => $s->actual_arrival_at,
                'actualDepartureAt' => $s->actual_departure_at,
                'detentionMinutes' => $s->detention_minutes === null ? null : (int) $s->detention_minutes,
                'instructions' => $s->instructions,
                'contactName' => $s->contact_name,
                'contactPhone' => $s->contact_phone,
            ])
            ->all();
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function assignments(Load $l): array
    {
        return DB::table('load_assignments as a')
            ->leftJoin('trucks as t', 't.id', '=', 'a.truck_id')
            ->leftJoin('trailers as r', 'r.id', '=', 'a.trailer_id')
            ->leftJoin('drivers as d', 'd.id', '=', 'a.driver_id')
            ->where('a.load_id', $l->id)
            ->whereNull('a.deleted_at')
            ->whereNull('a.unassigned_at')
            ->orderBy('a.resource_type')
            ->get([
                'a.id', 'a.resource_type', 'a.is_primary',
                't.unit_number as truck_unit', 't.plate_number as truck_plate',
                'r.unit_number as trailer_unit',
                'd.first_name', 'd.last_name', 'd.phone as driver_phone',
                'd.license_expires_at', 'd.medical_card_expires_at',
            ])
            ->map(fn ($a): array => [
                'id' => (string) $a->id,
                'type' => (string) $a->resource_type,
                'isPrimary' => (bool) $a->is_primary,
                'label' => match ($a->resource_type) {
                    'truck' => trim((string) $a->truck_unit).($a->truck_plate ? " · {$a->truck_plate}" : ''),
                    'trailer' => (string) $a->trailer_unit,
                    'driver' => trim("{$a->first_name} {$a->last_name}"),
                    default => '',
                },
                'phone' => $a->driver_phone,
                'licenseExpiresAt' => $a->license_expires_at,
                'medicalCardExpiresAt' => $a->medical_card_expires_at,
            ])
            ->all();
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function history(Load $l): array
    {
        return DB::table('load_status_history as h')
            ->leftJoin('users as u', 'u.id', '=', 'h.actor_user_id')
            ->where('h.load_id', $l->id)
            // Por `occurred_at`, no por `created_at`: son columnas distintas a
            // propósito. Un evento de GPS puede llegar con retraso y grabarse
            // hoy habiendo ocurrido ayer; el historial tiene que contar cuándo
            // PASÓ, no cuándo nos enteramos.
            ->orderByDesc('h.occurred_at')
            ->limit(40)
            ->get(['h.from_status', 'h.to_status', 'h.notes', 'h.source', 'h.occurred_at', 'u.first_name', 'u.last_name'])
            ->map(fn ($h): array => [
                'from' => $h->from_status,
                'to' => (string) $h->to_status,
                'reason' => $h->notes,
                'source' => (string) $h->source,
                'at' => $h->occurred_at,
                'by' => trim("{$h->first_name} {$h->last_name}") ?: null,
            ])
            ->all();
    }

    /**
     * @return array<string, mixed>
     */
    private function financials(Load $l): array
    {
        $f = (new LoadCalculator)->for($l);

        return [
            'customerCharge' => $f->customerCharge,
            'carrierGrossRate' => $f->carrierGrossRate,
            'dispatchFeeBps' => $f->dispatchFeeBps,
            'commissionBps' => $f->commissionBps,
            'commissionBasis' => $f->commissionBasis->value,
            'feeBase' => $f->feeBase->value,
            'excludedExpenses' => $f->excludedExpenses,
            'reimbursableExpenses' => $f->reimbursableExpenses,
            'tenantAbsorbedExpenses' => $f->tenantAbsorbedExpenses,
            'carrierDeductions' => $f->carrierDeductions,
            'commissionableBase' => $f->commissionableBase,
            'dispatchFee' => $f->dispatchFee,
            'netCarrierSettlement' => $f->netCarrierSettlement,
            'grossMargin' => $f->grossMargin,
            'dispatcherCommission' => $f->dispatcherCommission,
            'netMargin' => $f->netMargin(),
        ];
    }
}
