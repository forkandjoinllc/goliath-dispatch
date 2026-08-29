<?php

declare(strict_types=1);

namespace App\Http\Controllers\App;

use App\Authorization\Actor;
use App\Authorization\CurrentActor;
use App\Authorization\PermissionChecker;
use App\Authorization\ResourceContext;
use App\Enums\AuditAction;
use App\Enums\LoadRequirementType;
use App\Enums\LoadStatus;
use App\Enums\Role;
use App\Enums\Scope;
use App\Models\Customer;
use App\Models\Load;
use App\Rules\SubdivisionOfCountry;
use App\Support\Audit;
use App\Support\Finance\LoadCalculator;
use App\Support\Geo\Regions;
use App\Support\InertiaPage;
use App\Support\Loads\DriverEligibility;
use App\Support\Loads\DriverFacts;
use App\Support\Loads\Guards;
use App\Support\Loads\LoadScope;
use App\Support\Loads\NumberGenerator;
use App\Support\Loads\Transitions;
use App\Support\Tenancy\TenantPolicy;
use App\Support\TenantContext;
use Carbon\CarbonImmutable;
use Closure;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
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
                // Se manda el TEXTO, no la clave. Los documentos que faltan
                // llevan el tipo pegado a la clave y la pantalla tendría que
                // volver a partirla — dos sitios haciendo lo mismo acaban
                // discrepando.
                'blocking' => array_map(
                    fn (string $key): string => $this->blockingMessage($key),
                    Guards::blocking($model, $action),
                ),
                'requiresReason' => Transitions::requiresReason($action),
            ];
        }

        return Inertia::render('App/Loads/Show', [
            'load' => $this->detail($model),
            'stops' => $this->stops($model),
            'requirements' => $this->requirements($model),
            'assignments' => $this->assignments($model),
            'history' => $this->history($model),
            // El bloque de dinero NO SE CALCULA si falta el permiso. Enviarlo y
            // esconderlo en React lo dejaría al alcance de cualquiera que abra
            // las herramientas del navegador.
            'financials' => $canMoney ? $this->financials($model) : null,
            'actions' => $actions,
            // Lo que se puede asignar, solo si este actor puede asignarlo. Un
            // catálogo de conductores en la respuesta de quien no puede asignar
            // sería información de más sin ningún uso.
            'assignable' => $checker->can($actor, 'load:assign_resources', $context, $policy)->allowed
                || $checker->can($actor, 'load:assign_carrier', $context, $policy)->allowed
                    ? $this->assignable($model, $actor)
                    : null,
            'carrierLocked' => $model->carrier_locked_at !== null,
            'can' => [
                'update' => $checker->can($actor, 'load:update', $context, $policy)->allowed,
                'updateFinancials' => $checker->can($actor, 'load:financials:update', $context, $policy)->allowed,
                'assignCarrier' => $checker->can($actor, 'load:assign_carrier', $context, $policy)->allowed,
                'assignResources' => $checker->can($actor, 'load:assign_resources', $context, $policy)->allowed,
                'duplicate' => $checker->can($actor, 'load:duplicate', $context, $policy)->allowed,
            ],
        ]);
    }


    public function create(Request $request, CurrentActor $current, PermissionChecker $checker): Response
    {
        $actor = $current->require();
        $policy = $current->policy();
        $checker->authorize($actor, 'load:create', null, $policy);

        // `drivers` por las etiquetas de autorización de trabajo del bloque de
        // requisitos de la carga (`drivers.workAuthorization.*`). Sin él ese
        // desplegable enseñaba la clave en crudo.
        $this->usesDictionary($request, ['loads', 'drivers', 'nav', 'validation']);

        return Inertia::render('App/Loads/Form', [
            'load' => null,
            'stops' => [],
            'choices' => $this->choices($actor),
            // El despachador puede crear cargas pero NO tiene
            // load:financials:update. Puede fijar el cobro al cliente al dar de
            // alta —sin él la carga no se puede publicar— y no puede tocar la
            // tarifa del transportista ni los porcentajes.
            'canEditFinancials' => $checker->can($actor, 'load:financials:update', null, $policy)->allowed,
        ]);
    }

    public function store(Request $request, CurrentActor $current, PermissionChecker $checker): RedirectResponse
    {
        $actor = $current->require();
        $policy = $current->policy();
        $checker->authorize($actor, 'load:create', null, $policy);

        $data = $this->validated($request, true);
        $canMoney = $checker->can($actor, 'load:financials:update', null, $policy)->allowed;

        $load = DB::transaction(function () use ($data, $actor, $canMoney): Load {
            $load = new Load;
            $load->fill($this->loadColumns($data, $canMoney, true));
            // El número se genera aquí dentro para que el bloqueo del contador
            // viva en la misma transacción que la inserción. Generarlo fuera
            // dejaría un hueco en la serie cada vez que la validación falle.
            $load->load_number = NumberGenerator::next($actor->tenantId);
            // Una carga nace en borrador pase lo que pase. Igual que un
            // transportista nace en borrador: publicarla es un acto aparte, con
            // sus propias comprobaciones.
            $load->status = LoadStatus::Draft;
            $load->dispatcher_user_id = $actor->role === Role::Dispatcher ? $actor->userId : null;
            $load->save();

            $this->syncStops($load, $data['stops']);
            $this->syncRequirements($actor, $load, $data['requirements'] ?? null);

            return $load;
        });

        return redirect()
            ->route('loads.show', $load->id)
            ->with('success', __('loads.flash.created', ['number' => $load->load_number]));
    }

    public function edit(Request $request, string $load, CurrentActor $current, PermissionChecker $checker): Response
    {
        $actor = $current->require();
        $policy = $current->policy();
        $model = $this->find($load);
        $context = $this->context($model, $actor);

        // Dos permisos distintos abren esta pantalla, y ninguno implica al otro.
        //
        // Contabilidad tiene `load:financials:update` y NO tiene `load:update`:
        // le toca fijar la tarifa del transportista y los porcentajes, no
        // cambiar la mercancía. Un despachador es al revés. Cerrar la pantalla
        // con `load:update` a secas dejaba fuera precisamente al rol que existe
        // para tocar el dinero — que es el fallo que tenía esto.
        $canFreight = $checker->can($actor, 'load:update', $context, $policy)->allowed;
        $canMoney = $checker->can($actor, 'load:financials:update', $context, $policy)->allowed;

        abort_unless($canFreight || $canMoney, 403);

        // `drivers` por las etiquetas de autorización de trabajo del bloque de
        // requisitos de la carga (`drivers.workAuthorization.*`). Sin él ese
        // desplegable enseñaba la clave en crudo.
        $this->usesDictionary($request, ['loads', 'drivers', 'nav', 'validation']);

        return Inertia::render('App/Loads/Form', [
            'load' => [
                ...$this->detail($model),
                // Los importes solo viajan si se pueden editar. Mandarlos para
                // enseñarlos desactivados los pondría al alcance de quien abra
                // las herramientas del navegador, y el permiso de LECTURA del
                // dinero es otro distinto del de escritura.
                'customerChargeCents' => $canMoney ? (int) $model->customer_charge_cents : null,
                'carrierGrossRateCents' => $canMoney ? (int) $model->carrier_gross_rate_cents : null,
                'carrierDispatchFeeBps' => $canMoney ? (int) $model->carrier_dispatch_fee_bps : null,
                'dispatcherCommissionBps' => $canMoney ? (int) $model->dispatcher_commission_bps : null,
            ],
            'stops' => $this->stops($model),
            'requirements' => $this->requirements($model),
            'choices' => $this->choices($actor),
            'canEditFinancials' => $canMoney,
            'canEditFreight' => $canFreight,
        ]);
    }

    public function update(Request $request, string $load, CurrentActor $current, PermissionChecker $checker): RedirectResponse
    {
        $actor = $current->require();
        $policy = $current->policy();
        $model = $this->find($load);
        $context = $this->context($model, $actor);

        $canFreight = $checker->can($actor, 'load:update', $context, $policy)->allowed;
        $canMoney = $checker->can($actor, 'load:financials:update', $context, $policy)->allowed;

        abort_unless($canFreight || $canMoney, 403);

        $data = $this->validated($request, $canFreight);

        DB::transaction(function () use ($model, $data, $canMoney, $canFreight, $actor): void {
            $before = [
                'customer_charge_cents' => (int) $model->customer_charge_cents,
                'carrier_gross_rate_cents' => (int) $model->carrier_gross_rate_cents,
            ];

            $model->fill($this->loadColumns($data, $canMoney, $canFreight));
            $model->save();

            // Las paradas son mercancía, no dinero: solo las toca quien puede
            // editar la carga. Contabilidad no las recibe ni las manda.
            if ($canFreight) {
                $this->syncStops($model, $data['stops']);
                $this->syncRequirements($actor, $model, $data['requirements'] ?? null);
            }

            $after = [
                'customer_charge_cents' => (int) $model->customer_charge_cents,
                'carrier_gross_rate_cents' => (int) $model->carrier_gross_rate_cents,
            ];

            // Todo cambio de dinero deja rastro, aunque lo haga quien puede.
            // «¿Quién bajó la tarifa de esta carga?» es una pregunta que se hace
            // meses después, cuando el transportista reclama.
            if ($before !== $after) {
                Audit::record(
                    actor: $actor,
                    action: AuditAction::FinancialChanged,
                    entityType: 'load',
                    entityId: $model->id,
                    entityLabel: (string) $model->load_number,
                    before: $before,
                    after: $after,
                );
            }
        });

        return redirect()
            ->route('loads.show', $model->id)
            ->with('success', __('loads.flash.updated', ['number' => $model->load_number]));
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
                    fn (string $key): string => $this->blockingMessage($key),
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
                // Despachar CIERRA el transportista. La columna existía en el
                // esquema y nada la escribía nunca, así que la comprobación de
                // «esta carga ya salió con este transportista» no se disparaba
                // jamás: se podía cambiar el transportista de una carga ya
                // entregada, que no es una corrección sino otra carga.
                'dispatched' => $model->carrier_locked_at ??= now(),
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
                'id' => (string) Str::uuid(),
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

            Audit::record(
                actor: $actor,
                action: AuditAction::LoadStatusChanged,
                entityType: 'load',
                entityId: $model->id,
                entityLabel: (string) $model->load_number,
                before: ['status' => $from->value],
                after: ['status' => $target->value],
                reason: $reason !== '' ? $reason : null,
            );
        });

        return back()->with('success', __('loads.transition.done', [
            'status' => __("nav.status.load.{$target->value}"),
        ]));
    }

    // ------------------------------------------------------------------ interno

    /**
     * El texto de un motivo de bloqueo.
     *
     * Casi todos son claves sueltas, pero los documentos que faltan llegan como
     * `missingDocument:certificate_of_insurance` — el motivo y el tipo juntos,
     * porque hace falta decir CUÁL falta y pueden faltar tres.
     *
     * Se parten aquí y no se traduce la clave entera porque Laravel usa el `:`
     * para los parámetros de sustitución: `loads.blocking.missingDocument:x` no
     * resolvería nunca y el usuario vería la clave cruda en pantalla.
     */
    private function blockingMessage(string $key): string
    {
        if (! str_contains($key, ':')) {
            return __("loads.blocking.{$key}");
        }

        [$reason, $detail] = explode(':', $key, 2);

        return __("loads.blocking.{$reason}", [
            'document' => __("documents.types.{$detail}"),
        ]);
    }

    /**
     * Los recursos que se pueden poner en esta carga.
     *
     * Cada uno viene con su estado de cumplimiento y el motivo si no está en
     * regla, PERO se envían todos, también los que no valen. Ocultar un
     * conductor con la licencia vencida dejaría a quien despacha preguntándose
     * dónde está; enseñarlo tachado con «licencia vencida el 3 de marzo» le dice
     * qué hay que arreglar.
     *
     * Que se envíe no significa que se pueda: el servidor lo rechaza igual. Ver
     * LoadAssignmentController::checkResource().
     *
     * @return array<string, mixed>
     */
    private function assignable(Load $load, Actor $actor): array
    {
        $today = CarbonImmutable::now()->toDateString();

        $carriers = DB::table('carriers')
            ->where('tenant_id', $load->tenant_id)
            ->whereNull('deleted_at')
            ->where('onboarding_status', 'approved')
            ->orderBy('legal_name')
            ->get(['id', 'legal_name as name', 'dispatch_fee_bps'])
            ->map(fn ($r): array => [
                'id' => (string) $r->id,
                'name' => (string) $r->name,
                'dispatchFeeBps' => (int) $r->dispatch_fee_bps,
            ])
            ->all();

        if ($load->carrier_id === null) {
            return ['carriers' => $carriers, 'trucks' => [], 'trailers' => [], 'drivers' => []];
        }

        $units = fn (string $table): array => DB::table($table)
            ->where('tenant_id', $load->tenant_id)
            ->where('carrier_id', $load->carrier_id)
            ->whereNull('deleted_at')
            ->orderBy('unit_number')
            ->get(['id', 'unit_number', 'status'])
            ->map(fn ($r): array => [
                'id' => (string) $r->id,
                'label' => (string) $r->unit_number,
                'ok' => $r->status !== 'out_of_service',
                'problem' => $r->status === 'out_of_service' ? 'unitOutOfService' : null,
            ])
            ->all();

        // Los requisitos se piden UNA vez para toda la lista. La comparación es
        // una función pura y no toca la base, así que veinte conductores son
        // dos consultas, no cuarenta.
        $requisitos = $this->requirements($load);
        $requisitosParaComparar = array_map(
            fn (array $r): array => ['type' => $r['type'], 'value' => $r['value'], 'source' => $r['source']],
            $requisitos,
        );

        $drivers = DB::table('drivers as d')
            ->join('driver_carrier_relationships as r', 'r.driver_id', '=', 'd.id')
            ->where('d.tenant_id', $load->tenant_id)
            ->where('r.carrier_id', $load->carrier_id)
            ->whereNull('d.deleted_at')
            ->whereNull('r.deleted_at')
            ->where(fn ($q) => $q->whereNull('r.end_date')->orWhereDate('r.end_date', '>=', $today))
            ->orderBy('d.last_name')
            ->get([
                'd.id', 'd.first_name', 'd.last_name', 'd.status',
                'd.license_expires_at', 'd.medical_card_expires_at',
                'd.cdl_class', 'd.license_state', 'd.endorsements',
                'd.twic_card', 'd.twic_expires_at', 'd.work_authorization',
                'd.record_clean_years', 'd.record_checked_at',
            ])
            ->map(function ($d) use ($today, $requisitosParaComparar): array {
                $problem = match (true) {
                    $d->status === 'inactive' => 'driverInactive',
                    $d->license_expires_at !== null && $d->license_expires_at < $today => 'licenseExpired',
                    $d->medical_card_expires_at !== null && $d->medical_card_expires_at < $today => 'medicalExpired',
                    default => null,
                };

                $veredicto = DriverEligibility::evaluate(
                    $requisitosParaComparar,
                    DriverFacts::fromRow($d),
                );

                return [
                    'id' => (string) $d->id,
                    'label' => trim("{$d->first_name} {$d->last_name}"),
                    // `ok` sigue siendo lo de siempre: licencia, tarjeta médica
                    // y estado. Los requisitos de la carga NO lo tocan — no
                    // descartan a nadie, se enseñan aparte y decide quien
                    // despacha.
                    'ok' => $problem === null,
                    'problem' => $problem,
                    'licenseExpiresAt' => $d->license_expires_at,
                    'medicalCardExpiresAt' => $d->medical_card_expires_at,
                    'eligibility' => $requisitosParaComparar === [] ? null : [
                        ...DriverEligibility::summarize($veredicto),
                        'items' => $veredicto,
                    ],
                ];
            })
            ->all();

        return [
            'carriers' => $carriers,
            'trucks' => $units('trucks'),
            'trailers' => $units('trailers'),
            'drivers' => $drivers,
            // Para que el panel pueda decir QUÉ pide la carga, no solo si se
            // cumple.
            'requirements' => $requisitos,
        ];
    }

    /**
     * Lo que el formulario puede elegir: clientes, transportistas aprobados y
     * tipos de equipo.
     *
     * Los transportistas se limitan a los APROBADOS. Ofrecer uno en borrador
     * sería ofrecer algo que Guards va a rechazar al despachar, y descubrirlo
     * tres pasos más tarde es peor que no verlo.
     *
     * @return array<string, list<array<string, mixed>>>
     */
    private function choices(Actor $actor): array
    {
        return [
            'customers' => DB::table('customers')
                ->where('tenant_id', $actor->tenantId)
                ->whereNull('deleted_at')
                ->where('status', 'active')
                ->orderBy('company_name')
                ->get(['id', 'company_name as name'])
                ->map(fn ($r): array => ['id' => (string) $r->id, 'name' => (string) $r->name])
                ->all(),

            'carriers' => DB::table('carriers')
                ->where('tenant_id', $actor->tenantId)
                ->whereNull('deleted_at')
                ->where('onboarding_status', 'approved')
                ->orderBy('legal_name')
                ->get(['id', 'legal_name as name', 'dispatch_fee_bps'])
                ->map(fn ($r): array => [
                    'id' => (string) $r->id,
                    'name' => (string) $r->name,
                    // Se manda la tarifa vigente para que el formulario la
                    // proponga. Es una PROPUESTA: lo que se guarda es lo que
                    // quede escrito en la carga, porque es lo que se pactó.
                    'dispatchFeeBps' => (int) $r->dispatch_fee_bps,
                ])
                ->all(),

            'equipmentTypes' => DB::table('equipment_types')
                ->where('tenant_id', $actor->tenantId)
                ->whereNull('deleted_at')
                ->orderBy('sort_order')
                ->get(['id', 'code', 'label_en', 'label_es'])
                ->map(fn ($r): array => [
                    'id' => (string) $r->id,
                    'code' => (string) $r->code,
                    'labelEn' => (string) $r->label_en,
                    'labelEs' => (string) $r->label_es,
                ])
                ->all(),
        ];
    }

    /**
     * Las columnas de `loads` que salen del formulario.
     *
     * `$canMoney` decide si los importes se copian o se descartan EN EL
     * SERVIDOR. Que el formulario no pinte los campos no basta: una petición a
     * mano los llevaría igual, y un despachador podría subirse su propia
     * comisión.
     *
     * El cobro al cliente es la excepción y merece explicarse: lo fija quien
     * crea la carga, porque sin él no se puede publicar y quien la da de alta
     * es quien habló con el cliente. Lo que queda reservado a
     * `load:financials:update` es la tarifa del transportista y los porcentajes
     * —el reparto—, no el precio de venta.
     *
     * @param  array<string, mixed>  $data
     * @return array<string, mixed>
     */
    private function loadColumns(array $data, bool $canMoney, bool $canFreight): array
    {
        $columns = $canFreight ? [
            'customer_id' => $data['customer_id'],
            'customer_reference' => $data['customer_reference'] ?? null,
            'po_number' => $data['po_number'] ?? null,
            'commodity' => $data['commodity'] ?? null,
            'weight_pounds' => $data['weight_pounds'] ?? null,
            'piece_count' => $data['piece_count'] ?? null,
            'length_inches' => $data['length_inches'] ?? null,
            'width_inches' => $data['width_inches'] ?? null,
            'height_inches' => $data['height_inches'] ?? null,
            'required_equipment_type_id' => $data['required_equipment_type_id'] ?? null,
            'is_oversize' => (bool) ($data['is_oversize'] ?? false),
            'is_overweight' => (bool) ($data['is_overweight'] ?? false),
            'miles' => $data['miles'] ?? null,
            'deadhead_miles' => $data['deadhead_miles'] ?? null,
            'planned_pickup_at' => $data['planned_pickup_at'] ?? null,
            'planned_delivery_at' => $data['planned_delivery_at'] ?? null,
            'special_instructions' => $data['special_instructions'] ?? null,
            'internal_notes' => $data['internal_notes'] ?? null,
            'customer_charge_cents' => $data['customer_charge_cents'] ?? 0,
        ] : [];

        if ($canMoney) {
            $columns['carrier_gross_rate_cents'] = $data['carrier_gross_rate_cents'] ?? 0;
            // Los valores por defecto salen de la POLÍTICA DE LA EMPRESA, no de
            // constantes. Antes eran `?? 1000` y `?? 2500` y las columnas
            // `default_carrier_dispatch_fee_bps` y
            // `default_dispatcher_commission_bps` no las leía nadie: una empresa
            // con otra política recibía la mía en cada carga, en silencio.
            $policy = TenantPolicy::for(app(TenantContext::class)->id());

            $columns['carrier_dispatch_fee_bps'] = $data['carrier_dispatch_fee_bps']
                ?? $policy->carrierDispatchFeeBps;
            $columns['dispatcher_commission_bps'] = $data['dispatcher_commission_bps']
                ?? $policy->dispatcherCommissionBps;
            $columns['dispatcher_commission_basis'] = $data['dispatcher_commission_basis']
                ?? $policy->dispatcherCommissionBasis->value;
        }

        return $columns;
    }

    /**
     * Reescribe las paradas de una carga.
     *
     * Se borran las que ya no vienen y se reinsertan las demás con su secuencia
     * recalculada, dentro de la transacción del guardado.
     *
     * Por qué no se actualiza en su sitio: `load_stops_load_sequence_uq` impide
     * dos paradas con el mismo número en una carga, y reordenar en su sitio
     * choca contra el índice a mitad de camino — mover la parada 3 al puesto 2
     * colisiona con la 2 que todavía está ahí. Borrar y reinsertar evita
     * inventar un baile de secuencias temporales.
     *
     * Se pierden `actual_arrival_at` y la detención de las paradas existentes,
     * así que solo se reescriben las que CAMBIAN: las que llegan con su id y sin
     * cambios se dejan en paz.
     *
     * @param  list<array<string, mixed>>  $stops
     */
    /**
     * Deja los requisitos como los mandó el formulario.
     *
     * `null` es «no toques nada» —el formulario no mandó la lista— y no es lo
     * mismo que un array vacío, que sí es «quítalos todos».
     *
     * Los que se quitan se borran EN SUAVE: un requisito que estuvo vigente
     * cuando se asignó al conductor tiene que poder seguir leyéndose cuando
     * alguien pregunte por qué se asignó a esa persona.
     *
     * @param  list<array<string, mixed>>|null  $requirements
     */
    private function syncRequirements(Actor $actor, Load $load, ?array $requirements): void
    {
        if ($requirements === null) {
            return;
        }

        $ahora = now();
        $vistos = [];
        $claves = [];

        foreach (array_values($requirements) as $r) {
            $tipo = (string) ($r['type'] ?? '');
            $valor = isset($r['value']) && $r['value'] !== '' ? (string) $r['value'] : null;

            // Un requisito de estatus SIN decir de dónde sale no se guarda.
            // Exigir ciudadanía sin un contrato que la pida por escrito no es
            // una regla de negocio; ver la migración 2026_08_31_100000. Esto no
            // es asesoramiento legal.
            if ($tipo === LoadRequirementType::WorkAuthorization->value
                && trim((string) ($r['source'] ?? '')) === '') {
                throw ValidationException::withMessages([
                    'requirements' => __('loads.errors.requirementNeedsSource'),
                ]);
            }

            // El duplicado se impide aquí y no con un índice único porque la
            // columna generada que haría falta tendría que colgar de `load_id`,
            // que es columna de una ajena con ON DELETE CASCADE — y MySQL no
            // admite las dos cosas a la vez. Ver la migración.
            $clave = $tipo.'|'.($valor ?? '');

            if (isset($claves[$clave])) {
                throw ValidationException::withMessages([
                    'requirements' => __('loads.errors.requirementDuplicated'),
                ]);
            }

            $claves[$clave] = true;

            $columnas = [
                'requirement_type' => $tipo,
                'value' => $valor,
                'source' => $r['source'] ?? null,
                'notes' => $r['notes'] ?? null,
                'updated_at' => $ahora,
            ];

            $id = $r['id'] ?? null;

            $existente = $id === null ? null : DB::table('load_requirements')
                ->where('tenant_id', $load->tenant_id)
                ->where('load_id', $load->id)
                ->where('id', $id)
                ->whereNull('deleted_at')
                ->first(['id']);

            if ($existente !== null) {
                DB::table('load_requirements')->where('id', $existente->id)->update($columnas);
                $vistos[] = (string) $existente->id;

                continue;
            }

            $nuevo = (string) Str::uuid();

            DB::table('load_requirements')->insert([
                ...$columnas,
                'id' => $nuevo,
                'tenant_id' => $load->tenant_id,
                'load_id' => $load->id,
                'created_by_user_id' => $actor->auditUserId(),
                'created_at' => $ahora,
            ]);

            $vistos[] = $nuevo;
        }

        DB::table('load_requirements')
            ->where('tenant_id', $load->tenant_id)
            ->where('load_id', $load->id)
            ->whereNull('deleted_at')
            ->when($vistos !== [], fn ($q) => $q->whereNotIn('id', $vistos))
            ->update([
                'deleted_at' => $ahora,
                'deleted_by' => $actor->auditUserId(),
                'updated_at' => $ahora,
            ]);
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function requirements(Load $l): array
    {
        return DB::table('load_requirements')
            ->where('tenant_id', $l->tenant_id)
            ->where('load_id', $l->id)
            ->whereNull('deleted_at')
            ->orderBy('requirement_type')
            ->orderBy('value')
            ->get(['id', 'requirement_type', 'value', 'source', 'notes'])
            ->map(fn ($r): array => [
                'id' => (string) $r->id,
                'type' => (string) $r->requirement_type,
                'value' => $r->value,
                'source' => $r->source,
                'notes' => $r->notes,
            ])
            ->all();
    }

    private function syncStops(Load $load, array $stops): void
    {
        $keep = collect($stops)->pluck('id')->filter()->all();

        DB::table('load_stops')
            ->where('load_id', $load->id)
            ->when($keep !== [], fn ($q) => $q->whereNotIn('id', $keep))
            ->delete();

        foreach (array_values($stops) as $index => $stop) {
            $columns = [
                'stop_type' => $stop['stop_type'],
                'sequence' => $index + 1,
                'facility_name' => $stop['facility_name'] ?? null,
                'customer_location_id' => $stop['customer_location_id'] ?? null,
                'line1' => $stop['line1'] ?? null,
                'city' => $stop['city'] ?? null,
                'state' => $stop['state'] ?? null,
                'country' => $stop['country'] ?? Regions::DEFAULT_COUNTRY,
                'postal_code' => $stop['postal_code'] ?? null,
                'timezone' => $stop['timezone'] ?? 'America/Chicago',
                'appointment_type' => $stop['appointment_type'] ?? 'window',
                'window_start' => $stop['window_start'] ?? null,
                'window_end' => $stop['window_end'] ?? null,
                'contact_name' => $stop['contact_name'] ?? null,
                'contact_phone' => $stop['contact_phone'] ?? null,
                'instructions' => $stop['instructions'] ?? null,
                'updated_at' => now(),
            ];

            if (! empty($stop['id'])) {
                DB::table('load_stops')->where('id', $stop['id'])->update($columns);

                continue;
            }

            DB::table('load_stops')->insert([
                ...$columns,
                'id' => (string) Str::uuid(),
                'tenant_id' => $load->tenant_id,
                'load_id' => $load->id,
                'created_at' => now(),
            ]);
        }
    }

    /**
     * @return array<string, mixed>
     */
    private function validated(Request $request, bool $withFreight = true): array
    {
        // Quien solo puede tocar el dinero no manda mercancía ni paradas, así
        // que exigírselas lo dejaría fuera con un error de validación que no
        // podría arreglar. Las reglas se recortan al conjunto que ese rol puede
        // enviar de verdad.
        $freightRules = $withFreight ? [
            'customer_id' => ['required', 'string', 'size:36'],
            'customer_reference' => ['nullable', 'string', 'max:80'],
            'po_number' => ['nullable', 'string', 'max:80'],
            'commodity' => ['nullable', 'string', 'max:200'],
            'weight_pounds' => ['nullable', 'integer', 'min:0', 'max:500000'],
            'piece_count' => ['nullable', 'integer', 'min:0', 'max:100000'],
            'length_inches' => ['nullable', 'integer', 'min:0', 'max:5000'],
            'width_inches' => ['nullable', 'integer', 'min:0', 'max:1000'],
            'height_inches' => ['nullable', 'integer', 'min:0', 'max:1000'],
            'required_equipment_type_id' => ['nullable', 'string', 'size:36'],
            'is_oversize' => ['boolean'],
            'is_overweight' => ['boolean'],
            'miles' => ['nullable', 'integer', 'min:0', 'max:20000'],
            'deadhead_miles' => ['nullable', 'integer', 'min:0', 'max:20000'],
            'planned_pickup_at' => ['nullable', 'date'],
            'planned_delivery_at' => ['nullable', 'date', 'after_or_equal:planned_pickup_at'],
            'special_instructions' => ['nullable', 'string', 'max:5000'],
            'internal_notes' => ['nullable', 'string', 'max:5000'],
            'customer_charge_cents' => ['nullable', 'integer', 'min:0', 'max:99999999999'],

            'stops' => ['required', 'array', 'min:2'],
            'stops.*.id' => ['nullable', 'string', 'size:36'],
            'stops.*.stop_type' => ['required', 'in:pickup,delivery'],
            'stops.*.facility_name' => ['nullable', 'string', 'max:200'],
            'stops.*.customer_location_id' => ['nullable', 'string', 'size:36'],
            'stops.*.line1' => ['nullable', 'string', 'max:200'],
            'stops.*.city' => ['nullable', 'string', 'max:120'],
            'stops.*.country' => ['nullable', 'string', Rule::in(Regions::countryCodes())],
            // El país de una parada va POR parada: una carga puede recoger en
            // Laredo y entregar en Nuevo León. Por eso aquí no vale la regla con
            // el país fijo — hay que mirar el hermano del mismo índice.
            'stops.*.state' => ['nullable', 'string', 'max:3', function (string $attribute, mixed $value, Closure $fail) use ($request): void {
                $pais = $request->input(str_replace('.state', '.country', $attribute));

                (new SubdivisionOfCountry(is_string($pais) ? $pais : null))->validate($attribute, $value, $fail);
            }],
            'stops.*.postal_code' => ['nullable', 'string', 'max:12'],
            'stops.*.timezone' => ['nullable', 'string', 'max:64'],
            'stops.*.appointment_type' => ['nullable', 'in:exact,window,fcfs,open'],
            'stops.*.window_start' => ['nullable', 'date'],
            'stops.*.window_end' => ['nullable', 'date'],
            // Lo que la carga EXIGE de quien la lleva. Ver
            // App\Support\Loads\DriverEligibility.
            'requirements' => ['nullable', 'array', 'max:20'],
            'requirements.*.id' => ['nullable', 'string', 'size:36'],
            'requirements.*.type' => ['required', Rule::in(LoadRequirementType::values())],
            'requirements.*.value' => ['nullable', 'string', 'max:40'],
            'requirements.*.source' => ['nullable', 'string', 'max:2000'],
            'requirements.*.notes' => ['nullable', 'string', 'max:1000'],

            'stops.*.contact_name' => ['nullable', 'string', 'max:200'],
            'stops.*.contact_phone' => ['nullable', 'string', 'max:32'],
            'stops.*.instructions' => ['nullable', 'string', 'max:2000'],
        ] : [];

        $data = $request->validate([
            ...$freightRules,
            'carrier_gross_rate_cents' => ['nullable', 'integer', 'min:0', 'max:99999999999'],
            'carrier_dispatch_fee_bps' => ['nullable', 'integer', 'min:0', 'max:10000'],
            'dispatcher_commission_bps' => ['nullable', 'integer', 'min:0', 'max:10000'],
        ]);

        if (! $withFreight) {
            return $data;
        }

        // El cliente tiene que ser de esta empresa. La validación de formato no
        // lo garantiza: un id válido de OTRA empresa pasaría `size:36`, y el
        // scope global impide leerlo pero no impide escribirlo aquí.
        $customerExists = Customer::query()->whereKey($data['customer_id'])->exists();

        if (! $customerExists) {
            throw ValidationException::withMessages([
                'customer_id' => __('loads.form.customerNotFound'),
            ]);
        }

        // Una carga necesita al menos una recogida y una entrega. Es la misma
        // regla que Guards comprueba al publicar, adelantada al formulario para
        // que nadie guarde algo que no va a poder publicar.
        $types = collect($data['stops'])->pluck('stop_type');

        if (! $types->contains('pickup') || ! $types->contains('delivery')) {
            throw ValidationException::withMessages([
                'stops' => __('loads.form.needsBothStops'),
            ]);
        }

        return $data;
    }


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
                's.state', 's.country', 's.postal_code', 's.timezone', 's.appointment_type',
                's.window_start', 's.window_end', 's.actual_arrival_at', 's.actual_departure_at',
                's.detention_minutes', 's.instructions', 's.contact_name', 's.contact_phone',
                'cl.name as location_name', 'cl.line1 as location_line1', 'cl.city as location_city',
                'cl.state as location_state', 'cl.country as location_country',
                'cl.postal_code as location_postal',
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
                'country' => $s->location_country ?? $s->country ?? Regions::DEFAULT_COUNTRY,
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
