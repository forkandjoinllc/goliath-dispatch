<?php

declare(strict_types=1);

namespace App\Http\Controllers\App;

use App\Authorization\Actor;
use App\Authorization\CurrentActor;
use App\Authorization\PermissionChecker;
use App\Authorization\ResourceContext;
use App\Enums\Scope;
use App\Models\Customer;
use App\Rules\SubdivisionOfCountry;
use App\Support\Customers\NameKey;
use App\Support\Geo\Regions;
use App\Support\InertiaPage;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Inertia\Inertia;
use Inertia\Response;

/**
 * Los clientes: quién paga las cargas.
 *
 * La misma disciplina que en transportistas — el ámbito concedido estrecha la
 * CONSULTA, y el registro concreto entra en cada comprobación — con una regla
 * propia que no tiene ningún otro dominio: la detección de duplicados.
 *
 * Por qué importa aquí y no en transportistas: un transportista se identifica
 * por su número USDOT, que es único por decreto federal y la base de datos lo
 * impone. Un cliente no tiene nada así. «Aceros Delgado S.A. de C.V.» y «aceros
 * delgado» son la misma empresa escrita por dos personas distintas, y el día que
 * existan las dos fichas la mitad de las facturas irán a una y la mitad a la
 * otra. Nadie lo nota hasta que alguien reclama un saldo.
 *
 * Por eso el duplicado no se impide: se AVISA, y hace falta un permiso y un
 * motivo escrito para seguir adelante. Impedirlo sin más sería peor — dos
 * empresas de verdad pueden llamarse casi igual, y un sistema que no deja dar de
 * alta a un cliente real acaba con alguien escribiendo «Aceros Delgado 2».
 */
final class CustomerController
{
    use InertiaPage;

    private const PER_PAGE = 20;

    /** Lista blanca: el parámetro de orden va a SQL. */
    private const SORTABLE = [
        'company_name' => 'company_name',
        'physical_city' => 'physical_city',
        'payment_terms_days' => 'payment_terms_days',
        'credit_limit_cents' => 'credit_limit_cents',
        'status' => 'status',
        'created_at' => 'created_at',
    ];

    public function index(Request $request, CurrentActor $current, PermissionChecker $checker): Response
    {
        $actor = $current->require();
        $policy = $current->policy();

        $scope = $checker->authorize($actor, 'customer:read', null, $policy);

        $this->usesDictionary($request, ['customers', 'nav']);

        $filters = [
            'search' => trim((string) $request->query('search', '')),
            'status' => (string) $request->query('status', ''),
            'sort' => (string) $request->query('sort', 'company_name'),
            'direction' => $request->query('direction') === 'desc' ? 'desc' : 'asc',
        ];

        $query = $this->scoped($checker, $actor, $scope);
        $this->applyFilters($query, $filters);

        $sort = self::SORTABLE[$filters['sort']] ?? 'company_name';

        $page = $query
            ->orderBy($sort, $filters['direction'])
            // Desempate estable: sin él, dos clientes con el mismo estado pueden
            // intercambiarse entre páginas y uno no salir en ninguna.
            ->orderBy('id')
            ->paginate(self::PER_PAGE)
            ->withQueryString();

        // Los recuentos de carga se traen en UNA consulta agrupada, no una por
        // fila. Con veinte clientes en pantalla la diferencia son veinte viajes
        // a la base de datos por cada listado.
        $ids = collect($page->items())->pluck('id')->all();

        $loadCounts = $ids === [] ? [] : DB::table('loads')
            ->whereIn('customer_id', $ids)
            ->whereNull('deleted_at')
            ->where('status', '!=', 'cancelled')
            ->select('customer_id', DB::raw('count(*) as total'))
            ->groupBy('customer_id')
            ->pluck('total', 'customer_id')
            ->all();

        return Inertia::render('App/Customers/Index', [
            'customers' => [
                'data' => collect($page->items())
                    ->map(fn (Customer $c): array => [
                        ...$this->row($c),
                        'loadCount' => (int) ($loadCounts[$c->id] ?? 0),
                    ])
                    ->all(),
                'meta' => [
                    'total' => $page->total(),
                    'perPage' => $page->perPage(),
                    'currentPage' => $page->currentPage(),
                    'lastPage' => $page->lastPage(),
                ],
            ],
            'filters' => $filters,
            'scope' => $scope->value,
            'can' => [
                'create' => $checker->can($actor, 'customer:create', null, $policy)->allowed,
            ],
        ]);
    }

    public function show(Request $request, string $customer, CurrentActor $current, PermissionChecker $checker): Response
    {
        $actor = $current->require();
        $policy = $current->policy();
        $model = $this->find($customer);

        $checker->authorize($actor, 'customer:read', $this->context($model), $policy);

        $this->usesDictionary($request, ['customers', 'nav']);

        return Inertia::render('App/Customers/Show', [
            'customer' => $this->detail($model),
            'locations' => $this->locations($model),
            'contacts' => $this->contacts($model),
            'loads' => $checker->can($actor, 'load:read', null, $policy)->allowed
                ? $this->recentLoads($model)
                : null,
            'can' => [
                'update' => $checker->can($actor, 'customer:update', $this->context($model), $policy)->allowed,
                'delete' => $checker->can($actor, 'customer:delete', $this->context($model), $policy)->allowed,
            ],
        ]);
    }

    public function create(Request $request, CurrentActor $current, PermissionChecker $checker): Response
    {
        $actor = $current->require();
        $checker->authorize($actor, 'customer:create', null, $current->policy());

        $this->usesDictionary($request, ['customers', 'nav', 'validation']);

        return Inertia::render('App/Customers/Form', [
            'customer' => null,
            'canOverrideDuplicate' => $checker->can($actor, 'customer:duplicate:override', null, $current->policy())->allowed,
        ]);
    }

    public function store(Request $request, CurrentActor $current, PermissionChecker $checker): RedirectResponse
    {
        $actor = $current->require();
        $policy = $current->policy();
        $checker->authorize($actor, 'customer:create', null, $policy);

        $data = $this->validated($request);
        $key = NameKey::for($data['company_name']);

        $override = $this->resolveDuplicate($request, $checker, $actor, $policy, $key, null);

        $customer = new Customer;
        $customer->fill($this->normalizeColumns($data, $key));
        $customer->duplicate_override_by_user_id = $override['userId'];
        $customer->duplicate_override_reason = $override['reason'];
        $customer->save();

        return redirect()
            ->route('customers.show', $customer->id)
            ->with('success', __('customers.flash.created', ['name' => $customer->company_name]));
    }

    public function edit(Request $request, string $customer, CurrentActor $current, PermissionChecker $checker): Response
    {
        $actor = $current->require();
        $model = $this->find($customer);
        $checker->authorize($actor, 'customer:update', $this->context($model), $current->policy());

        $this->usesDictionary($request, ['customers', 'nav', 'validation']);

        return Inertia::render('App/Customers/Form', [
            'customer' => $this->detail($model),
            'canOverrideDuplicate' => $checker->can($actor, 'customer:duplicate:override', $this->context($model), $current->policy())->allowed,
        ]);
    }

    public function update(Request $request, string $customer, CurrentActor $current, PermissionChecker $checker): RedirectResponse
    {
        $actor = $current->require();
        $policy = $current->policy();
        $model = $this->find($customer);
        $checker->authorize($actor, 'customer:update', $this->context($model), $policy);

        $data = $this->validated($request);
        $key = NameKey::for($data['company_name']);

        // Solo se vuelve a comprobar si el nombre CAMBIÓ. Sin esto, cualquier
        // edición de un cliente que ya se dio de alta como duplicado aceptado
        // volvería a exigir el motivo, y acabaría con alguien escribiendo
        // «ver arriba» para poder guardar un cambio de teléfono.
        if ($key !== $model->company_name_normalized) {
            $override = $this->resolveDuplicate($request, $checker, $actor, $policy, $key, $model->id);

            if ($override['userId'] !== null) {
                $model->duplicate_override_by_user_id = $override['userId'];
                $model->duplicate_override_reason = $override['reason'];
            }
        }

        $model->fill($this->normalizeColumns($data, $key));
        $model->save();

        return redirect()
            ->route('customers.show', $model->id)
            ->with('success', __('customers.flash.updated', ['name' => $model->company_name]));
    }

    public function destroy(string $customer, CurrentActor $current, PermissionChecker $checker): RedirectResponse
    {
        $actor = $current->require();
        $model = $this->find($customer);
        $checker->authorize($actor, 'customer:delete', $this->context($model), $current->policy());

        // Un cliente con cargas vivas no se borra. No es una regla de
        // conveniencia: la carga necesita saber a quién facturar, y un cliente
        // borrado en mitad de un viaje deja una factura sin destinatario.
        $live = DB::table('loads')
            ->where('customer_id', $model->id)
            ->whereNull('deleted_at')
            ->whereNotIn('status', ['paid', 'cancelled'])
            ->count();

        if ($live > 0) {
            throw ValidationException::withMessages([
                'customer' => __('customers.flash.hasLiveLoads', ['count' => $live]),
            ]);
        }

        // Borrado suave: las cargas y facturas históricas siguen pudiendo
        // nombrar al cliente, que es lo que exige una factura de hace dos años.
        $model->deleted_by = $actor->userId;
        $model->save();
        $model->delete();

        return redirect()
            ->route('customers.index')
            ->with('success', __('customers.flash.deleted', ['name' => $model->company_name]));
    }

    // ------------------------------------------------------------------ interno

    /**
     * Decide si el alta puede seguir adelante pese a parecerse a otro cliente.
     *
     * Tres desenlaces, y los tres son deliberados:
     *
     *  - No hay parecido: adelante, sin anulación.
     *  - Hay parecido y el actor NO puede anular: 422 nombrando al cliente que
     *    ya existe. Nombrarlo importa — «ya existe uno parecido» sin decir cuál
     *    obliga a buscarlo a mano.
     *  - Hay parecido y el actor SÍ puede anular: 422 pidiendo el motivo, y a
     *    la segunda pasa. El motivo se guarda con la ficha.
     *
     * @param  array{allow_dispatcher_resource_assignment?: bool}|null  $policy
     * @return array{userId: string|null, reason: string|null}
     */
    private function resolveDuplicate(
        Request $request,
        PermissionChecker $checker,
        Actor $actor,
        ?array $policy,
        string $key,
        ?string $ignoreId,
    ): array {
        $existing = Customer::query()
            ->where('company_name_normalized', $key)
            ->when($ignoreId !== null, fn (Builder $q) => $q->whereKeyNot($ignoreId))
            ->first(['id', 'company_name']);

        if ($existing === null) {
            return ['userId' => null, 'reason' => null];
        }

        $mayOverride = $checker->can($actor, 'customer:duplicate:override', null, $policy)->allowed;

        if (! $mayOverride) {
            throw ValidationException::withMessages([
                'company_name' => __('customers.duplicate.blocked', ['name' => $existing->company_name]),
            ]);
        }

        $reason = trim((string) $request->input('duplicate_override_reason', ''));

        if ($reason === '') {
            throw ValidationException::withMessages([
                'duplicate_override_reason' => __('customers.duplicate.reasonRequired', [
                    'name' => $existing->company_name,
                ]),
            ]);
        }

        return ['userId' => $actor->auditUserId(), 'reason' => $reason];
    }

    /**
     * @return Builder<Customer>
     */
    private function scoped(PermissionChecker $checker, Actor $actor, Scope $scope): Builder
    {
        // `customers` no tiene columna de transportista ni de conductor: no hay
        // forma de demostrar que un cliente «pertenece» a un ámbito estrecho.
        // La matriz solo concede `customer:read` con ámbito `tenant`, así que
        // esto es correcto hoy; si mañana alguien añadiera una concesión más
        // estrecha, ScopeFilter devolvería cero filas —no todas—, que es la
        // forma segura de equivocarse.
        return $checker->scopeFilter($actor, $scope)->apply(Customer::query());
    }

    /**
     * @param  Builder<Customer>  $query
     * @param  array{search: string, status: string}  $filters
     */
    private function applyFilters(Builder $query, array $filters): void
    {
        if ($filters['search'] !== '') {
            $term = '%'.str_replace(['%', '_'], ['\%', '\_'], $filters['search']).'%';
            // Se busca también por la forma normalizada: quien escribe «aceros
            // delgado» encuentra «Aceros Delgado S.A. de C.V.» sin saber cómo se
            // escribe el sufijo.
            $key = '%'.NameKey::for($filters['search']).'%';

            $query->where(function (Builder $q) use ($term, $key): void {
                $q->where('company_name', 'like', $term)
                    ->orWhere('company_name_normalized', 'like', $key)
                    ->orWhere('email', 'like', $term)
                    ->orWhere('phone_normalized', 'like', $term)
                    ->orWhere('physical_city', 'like', $term);
            });
        }

        if (in_array($filters['status'], ['active', 'inactive', 'on_hold'], true)) {
            $query->where('status', $filters['status']);
        }
    }

    private function find(string $id): Customer
    {
        return Customer::query()->findOrFail($id);
    }

    private function context(Customer $customer): ResourceContext
    {
        return new ResourceContext(tenantId: $customer->tenant_id);
    }

    /**
     * Las columnas derivadas que la base de datos no calcula sola.
     *
     * Se escriben aquí, en un solo sitio, porque son la clave de tres búsquedas
     * distintas: si el alta las escribiera y la edición no, un cliente dejaría
     * de encontrarse en cuanto alguien le corrigiera el nombre.
     *
     * @param  array<string, mixed>  $data
     * @return array<string, mixed>
     */
    private function normalizeColumns(array $data, string $key): array
    {
        return [
            ...$data,
            'company_name_normalized' => $key,
            'email_normalized' => isset($data['email']) && $data['email'] !== null
                ? strtolower((string) $data['email'])
                : null,
            'phone_normalized' => isset($data['phone']) && $data['phone'] !== null
                ? preg_replace('/\D+/', '', (string) $data['phone'])
                : null,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function row(Customer $c): array
    {
        return [
            'id' => $c->id,
            'companyName' => $c->company_name,
            'city' => $c->physical_city,
            'state' => $c->physical_state,
            'email' => $c->email,
            'phone' => $c->phone,
            'status' => (string) $c->status,
            'paymentTermsDays' => $c->payment_terms_days === null ? null : (int) $c->payment_terms_days,
            'creditLimitCents' => $c->credit_limit_cents === null ? null : (int) $c->credit_limit_cents,
            'creditApproved' => (bool) $c->credit_approved,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function detail(Customer $c): array
    {
        return [
            ...$this->row($c),
            'website' => $c->website,
            'physical' => [
                'line1' => $c->physical_line1,
                'line2' => $c->physical_line2,
                'city' => $c->physical_city,
                'state' => $c->physical_state,
                'postalCode' => $c->physical_postal_code,
                'country' => $c->physical_country,
            ],
            'billingSameAsPhysical' => (bool) $c->billing_same_as_physical,
            'billing' => [
                'line1' => $c->billing_line1,
                'line2' => $c->billing_line2,
                'city' => $c->billing_city,
                'state' => $c->billing_state,
                'postalCode' => $c->billing_postal_code,
                'country' => $c->billing_country,
            ],
            'creditNotes' => $c->credit_notes,
            'usesFactoring' => (bool) $c->uses_factoring,
            'factoringCompanyName' => $c->factoring_company_name,
            'notes' => $c->notes,
            // Se dice que la ficha se dio de alta pese a parecerse a otra, y por
            // qué. Guardarlo y no enseñarlo sería quedarse con lo peor de las
            // dos opciones: el dato ocupa sitio y nadie lo aprovecha.
            'duplicateOverrideReason' => $c->duplicate_override_reason,
            'createdAt' => $c->created_at?->toIso8601String(),
        ];
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function locations(Customer $c): array
    {
        return DB::table('customer_locations')
            ->where('customer_id', $c->id)
            ->whereNull('deleted_at')
            ->orderByDesc('is_primary')
            ->orderBy('name')
            ->get(['id', 'name', 'line1', 'city', 'state', 'postal_code', 'timezone', 'hours', 'is_primary'])
            ->map(fn ($l): array => [
                'id' => (string) $l->id,
                'name' => (string) $l->name,
                'line1' => $l->line1,
                'city' => $l->city,
                'state' => $l->state,
                'postalCode' => $l->postal_code,
                'timezone' => $l->timezone,
                'hours' => $l->hours,
                'isPrimary' => (bool) $l->is_primary,
            ])
            ->all();
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function contacts(Customer $c): array
    {
        return DB::table('customer_contacts')
            ->where('customer_id', $c->id)
            ->whereNull('deleted_at')
            ->orderByDesc('is_primary')
            ->orderBy('last_name')
            ->get(['id', 'first_name', 'last_name', 'email', 'phone', 'position', 'is_primary'])
            ->map(fn ($k): array => [
                'id' => (string) $k->id,
                'name' => trim("{$k->first_name} {$k->last_name}"),
                'email' => $k->email,
                'phone' => $k->phone,
                'position' => $k->position,
                'isPrimary' => (bool) $k->is_primary,
            ])
            ->all();
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function recentLoads(Customer $c): array
    {
        return DB::table('loads')
            ->where('customer_id', $c->id)
            ->whereNull('deleted_at')
            ->orderByDesc('planned_pickup_at')
            ->limit(10)
            ->get(['id', 'load_number', 'status', 'commodity', 'planned_pickup_at', 'customer_charge_cents'])
            ->map(fn ($l): array => [
                'id' => (string) $l->id,
                'loadNumber' => (string) $l->load_number,
                'status' => (string) $l->status,
                'commodity' => $l->commodity,
                'plannedPickupAt' => $l->planned_pickup_at,
                'chargeCents' => (int) $l->customer_charge_cents,
            ])
            ->all();
    }

    /**
     * @return array<string, mixed>
     */
    private function validated(Request $request): array
    {
        return $request->validate([
            'company_name' => ['required', 'string', 'max:200'],
            'website' => ['nullable', 'url', 'max:255'],
            'email' => ['nullable', 'email:rfc', 'max:255'],
            'phone' => ['nullable', 'string', 'max:32'],
            'physical_line1' => ['nullable', 'string', 'max:200'],
            'physical_line2' => ['nullable', 'string', 'max:200'],
            'physical_city' => ['nullable', 'string', 'max:120'],
            'physical_country' => ['nullable', 'string', Rule::in(Regions::countryCodes())],
            'physical_state' => ['nullable', 'string', 'max:3', new SubdivisionOfCountry($request->input('physical_country'))],
            'physical_postal_code' => ['nullable', 'string', 'max:12'],
            'billing_same_as_physical' => ['boolean'],
            'billing_line1' => ['nullable', 'string', 'max:200'],
            'billing_line2' => ['nullable', 'string', 'max:200'],
            'billing_city' => ['nullable', 'string', 'max:120'],
            'billing_country' => ['nullable', 'string', Rule::in(Regions::countryCodes())],
            'billing_state' => ['nullable', 'string', 'max:3', new SubdivisionOfCountry($request->input('billing_country'))],
            'billing_postal_code' => ['nullable', 'string', 'max:12'],
            // En centavos y entero, igual que la columna. El formulario enseña
            // dólares y convierte al enviar: nada de decimales flotantes para
            // representar dinero.
            'credit_limit_cents' => ['nullable', 'integer', 'min:0', 'max:99999999999'],
            'credit_approved' => ['boolean'],
            'credit_notes' => ['nullable', 'string', 'max:2000'],
            // Cero es «al contado», no «sin condiciones». 365 es un año, que ya
            // es absurdo y sirve de tope contra un dedo resbalado.
            'payment_terms_days' => ['nullable', 'integer', 'min:0', 'max:365'],
            'uses_factoring' => ['boolean'],
            'factoring_company_name' => ['nullable', 'string', 'max:200'],
            'status' => ['required', 'in:active,inactive,on_hold'],
            'notes' => ['nullable', 'string', 'max:5000'],
        ]);
    }
}
