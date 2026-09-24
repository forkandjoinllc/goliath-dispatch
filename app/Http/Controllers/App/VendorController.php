<?php

declare(strict_types=1);

namespace App\Http\Controllers\App;

use App\Authorization\Actor;
use App\Authorization\CurrentActor;
use App\Authorization\PermissionChecker;
use App\Enums\Scope;
use App\Enums\VendorType;
use App\Models\Vendor;
use App\Rules\SubdivisionOfCountry;
use App\Support\Customers\NameKey;
use App\Support\Geo\Regions;
use App\Support\InertiaPage;
use App\Support\Locales;
use App\Support\TenantContext;
use App\Support\Time\Viewer;
use App\Support\Vendors\VendorScope;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Inertia\Inertia;
use Inertia\Response;

/**
 * Los proveedores: quién le cobra a un transportista.
 *
 * ## Qué pregunta vino a contestar
 *
 * `trucks.lessor_name` y `trailers.lessor_name` son texto libre desde el primer
 * día. El arrendador de cada unidad está escrito a mano, tantas veces como
 * unidades, con una coma de más o de menos cada vez. Así, «¿qué me arrienda
 * esta empresa?» y «¿a quién llamo cuando vence?» no tienen respuesta.
 *
 * Un proveedor es la ficha que faltaba. La arrendadora, el taller, la
 * aseguradora: con sus contactos, sus condiciones de pago, a qué
 * transportistas sirve, qué unidades le arrienda a cada uno y qué gastos se le
 * han imputado.
 *
 * ## De la empresa, no del transportista
 *
 * Una arrendadora que trabaja con tres transportistas es UNA ficha. A quién
 * sirve se anota en `vendor_carriers`, y de ahí sale el alcance: un usuario
 * transportista ve los que le sirven a él y no los de sus competidores, que
 * estarían en la misma pantalla. Ver `Vendors\VendorScope`.
 *
 * ## El identificador fiscal no vuelve
 *
 * Se guarda cifrado y solo viajan los cuatro últimos. Lo que se teclea una vez
 * no se devuelve nunca al formulario: editar un proveedor sin tocar ese campo
 * no lo borra —la ausencia significa «déjalo»— y el campo sale vacío con los
 * cuatro últimos escritos al lado. Es la única forma de tener un campo
 * editable de algo que no se puede volver a enseñar.
 */
final class VendorController
{
    use InertiaPage;

    private const PER_PAGE = 20;

    /** Lista blanca: el parámetro de orden va a SQL. */
    private const SORTABLE = [
        'company_name' => 'company_name',
        'vendor_type' => 'vendor_type',
        'city' => 'city',
        'payment_terms_days' => 'payment_terms_days',
        'status' => 'status',
        'created_at' => 'created_at',
    ];

    /** Formas de pago que el producto sabe producir. */
    public const FORMAS_DE_PAGO = ['ach', 'check', 'wire', 'card', 'other'];

    public function index(Request $request, CurrentActor $current, PermissionChecker $checker): Response
    {
        $actor = $current->require();
        $policy = $current->policy();

        $scope = $checker->authorize($actor, 'vendor:read', null, $policy);

        $this->usesDictionary($request, ['vendors', 'nav']);

        $filters = [
            'search' => trim((string) $request->query('search', '')),
            'type' => (string) $request->query('type', ''),
            'status' => (string) $request->query('status', ''),
            'carrier' => (string) $request->query('carrier', ''),
            'sort' => (string) $request->query('sort', 'company_name'),
            'direction' => $request->query('direction') === 'desc' ? 'desc' : 'asc',
        ];

        $query = $this->scoped($checker, $actor, $scope);
        $this->applyFilters($query, $filters);

        $sort = self::SORTABLE[$filters['sort']] ?? 'company_name';

        $page = $query
            ->orderBy($sort, $filters['direction'])
            // Desempate estable: sin él, dos proveedores del mismo tipo pueden
            // intercambiarse entre páginas y uno no salir en ninguna.
            ->orderBy('id')
            ->paginate(self::PER_PAGE)
            ->withQueryString();

        $ids = collect($page->items())->pluck('id')->map(fn ($v): string => (string) $v)->all();

        // Las dos cuentas, en DOS consultas agrupadas y no una por fila. Con
        // veinte proveedores en pantalla la diferencia son cuarenta viajes a
        // la base por listado.
        $porTransportista = $this->cuentasDeTransportista($ids);
        $porUnidades = $this->cuentasDeUnidades($ids);

        return Inertia::render('App/Vendors/Index', [
            'vendors' => [
                'data' => collect($page->items())->map(fn (Vendor $v): array => [
                    ...$this->row($v),
                    'carrierCount' => $porTransportista[(string) $v->id] ?? 0,
                    'unitCount' => $porUnidades[(string) $v->id] ?? 0,
                ])->all(),
                'meta' => [
                    'total' => $page->total(),
                    'perPage' => $page->perPage(),
                    'currentPage' => $page->currentPage(),
                    'lastPage' => $page->lastPage(),
                ],
            ],
            'filters' => $filters,
            'types' => VendorType::values(),
            'carriers' => $this->transportistasParaElegir($actor),
            'scope' => $scope->value,
            'can' => [
                'create' => $checker->can($actor, 'vendor:create', null, $policy)->allowed,
            ],
        ]);
    }

    public function show(Request $request, string $vendor, CurrentActor $current, PermissionChecker $checker): Response
    {
        $actor = $current->require();
        $policy = $current->policy();

        $scope = $checker->authorize($actor, 'vendor:read', null, $policy);
        $model = $this->alcanzable($checker, $actor, $scope, $vendor);

        $this->usesDictionary($request, ['vendors', 'equipment', 'expenses', 'nav']);

        return Inertia::render('App/Vendors/Show', [
            'vendor' => $this->detail($model),
            'contacts' => $this->contactos($model),
            'carriers' => $this->transportistasDe($model),
            // Lo que le arrienda. Sale de las unidades que APUNTAN a esta
            // ficha, no de un nombre parecido: es lo que el texto libre nunca
            // pudo contestar.
            'leased' => $this->unidadesArrendadas($model),
            'expenses' => $checker->can($actor, 'expense:read', VendorScope::contexto($model), $policy)->allowed
                ? $this->gastosDe($model)
                : null,
            'can' => [
                'update' => $checker->can($actor, 'vendor:update', VendorScope::contexto($model), $policy)->allowed,
                'delete' => $checker->can($actor, 'vendor:delete', VendorScope::contexto($model), $policy)->allowed,
            ],
        ]);
    }

    public function create(Request $request, CurrentActor $current, PermissionChecker $checker): Response
    {
        $actor = $current->require();
        $checker->authorize($actor, 'vendor:create', null, $current->policy());

        $this->usesDictionary($request, ['vendors', 'nav', 'validation']);

        return Inertia::render('App/Vendors/Form', [
            'vendor' => null,
            'contacts' => [],
            'selectedCarriers' => [],
            'carriers' => $this->transportistasParaElegir($actor),
            'codes' => $this->codigos(),
        ]);
    }

    public function store(Request $request, CurrentActor $current, PermissionChecker $checker): RedirectResponse
    {
        $actor = $current->require();
        $checker->authorize($actor, 'vendor:create', null, $current->policy());

        $data = $this->validated($request, null);
        $contactos = $this->sacarContactos($data);
        $transportistas = $this->sacarTransportistas($data);

        $vendor = DB::transaction(function () use ($data, $actor, $contactos, $transportistas): Vendor {
            $vendor = new Vendor;
            $vendor->fill($this->columnas($data, null));
            $vendor->save();

            $this->guardarContactos($actor, $vendor, $contactos);
            $this->guardarTransportistas($actor, $vendor, $transportistas);

            return $vendor;
        });

        return redirect()->route('vendors.show', $vendor->id)
            ->with('success', __('vendors.flash.created', ['name' => $vendor->company_name]));
    }

    public function edit(Request $request, string $vendor, CurrentActor $current, PermissionChecker $checker): Response
    {
        $actor = $current->require();
        $policy = $current->policy();

        $scope = $checker->authorize($actor, 'vendor:read', null, $policy);
        $model = $this->alcanzable($checker, $actor, $scope, $vendor);

        abort_unless($checker->can($actor, 'vendor:update', VendorScope::contexto($model), $policy)->allowed, 403);

        $this->usesDictionary($request, ['vendors', 'nav', 'validation']);

        return Inertia::render('App/Vendors/Form', [
            'vendor' => $this->detail($model),
            'contacts' => $this->contactos($model),
            'selectedCarriers' => collect($this->transportistasDe($model))->pluck('id')->all(),
            'carriers' => $this->transportistasParaElegir($actor),
            'codes' => $this->codigos(),
        ]);
    }

    public function update(Request $request, string $vendor, CurrentActor $current, PermissionChecker $checker): RedirectResponse
    {
        $actor = $current->require();
        $policy = $current->policy();

        $scope = $checker->authorize($actor, 'vendor:read', null, $policy);
        $model = $this->alcanzable($checker, $actor, $scope, $vendor);

        abort_unless($checker->can($actor, 'vendor:update', VendorScope::contexto($model), $policy)->allowed, 403);

        $data = $this->validated($request, $model);
        $contactos = $this->sacarContactos($data);
        $transportistas = $this->sacarTransportistas($data);

        DB::transaction(function () use ($model, $data, $actor, $contactos, $transportistas): void {
            $model->fill($this->columnas($data, $model));
            $model->save();

            $this->guardarContactos($actor, $model, $contactos);
            $this->guardarTransportistas($actor, $model, $transportistas);
        });

        return redirect()->route('vendors.show', $model->id)
            ->with('success', __('vendors.flash.updated', ['name' => $model->company_name]));
    }

    /**
     * Retirar un proveedor.
     *
     * Borrado SUAVE y con puerta: si hay unidades apuntando a él o gastos
     * imputados, no se borra. No es una regla de integridad —las columnas son
     * nulas y la base lo dejaría— sino de lectura: un gasto cuyo proveedor
     * desapareció es un gasto que ya no se puede explicar, y la unidad se
     * quedaría con un arrendador que no existe.
     */
    public function destroy(string $vendor, CurrentActor $current, PermissionChecker $checker): RedirectResponse
    {
        $actor = $current->require();
        $policy = $current->policy();

        $scope = $checker->authorize($actor, 'vendor:read', null, $policy);
        $model = $this->alcanzable($checker, $actor, $scope, $vendor);

        $checker->authorize($actor, 'vendor:delete', VendorScope::contexto($model), $policy);

        $atado = $this->loQueLoAta($model);

        if ($atado !== []) {
            return back()->with('error', __('vendors.errors.stillInUse', [
                'units' => (string) ($atado['units'] ?? 0),
                'expenses' => (string) ($atado['expenses'] ?? 0),
            ]));
        }

        $model->deleted_by = $actor->userId;
        $model->save();
        $model->delete();

        return redirect()->route('vendors.index')
            ->with('success', __('vendors.flash.deleted', ['name' => $model->company_name]));
    }

    /* ── La consulta ────────────────────────────────────────────────────── */

    /**
     * @return Builder<Vendor>
     */
    private function scoped(PermissionChecker $checker, Actor $actor, Scope $scope): Builder
    {
        return VendorScope::apply(Vendor::query(), $checker, $actor, $scope);
    }

    /**
     * El proveedor, si esta persona lo alcanza.
     *
     * Fuera de alcance es 404 y no 403: un 403 confirmaría que ese proveedor
     * existe en esta empresa, y con eso se enumeran las fichas de una en una.
     */
    private function alcanzable(PermissionChecker $checker, Actor $actor, Scope $scope, string $id): Vendor
    {
        $model = $this->scoped($checker, $actor, $scope)->whereKey($id)->first();

        abort_if($model === null, 404);

        return $model;
    }

    /**
     * @param  Builder<Vendor>  $query
     * @param  array<string, string>  $filters
     */
    private function applyFilters(Builder $query, array $filters): void
    {
        if ($filters['search'] !== '') {
            $termino = '%'.strtolower($filters['search']).'%';
            $clave = '%'.NameKey::for($filters['search']).'%';
            // Los dígitos se sacan FUERA del cierre: dentro, `$filters` no
            // existe —no se pasa por `use`— y buscar por teléfono reventaba
            // con «variable indefinida». Lo cazó phpstan antes que nadie.
            $digitos = preg_replace('/\D+/', '', $filters['search']).'%';

            $query->where(function (Builder $q) use ($termino, $clave, $digitos): void {
                $q->where('company_name_normalized', 'like', $clave)
                    ->orWhere('email_normalized', 'like', $termino)
                    ->orWhere('phone_normalized', 'like', $digitos);
            });
        }

        if (in_array($filters['type'], VendorType::values(), true)) {
            $query->where('vendor_type', $filters['type']);
        }

        if (in_array($filters['status'], ['active', 'inactive', 'archived'], true)) {
            $query->where('status', $filters['status']);
        }

        if ($filters['carrier'] !== '') {
            $query->whereExists(function ($q) use ($filters): void {
                $q->select(DB::raw(1))
                    ->from('vendor_carriers as fc')
                    ->whereColumn('fc.vendor_id', 'vendors.id')
                    ->where('fc.carrier_id', $filters['carrier'])
                    ->whereNull('fc.deleted_at');
            });
        }
    }

    /* ── Lo que sale a pantalla ─────────────────────────────────────────── */

    /** @return array<string, mixed> */
    private function row(Vendor $v): array
    {
        return [
            'id' => (string) $v->id,
            'companyName' => (string) $v->company_name,
            'vendorType' => (string) $v->vendor_type,
            'phone' => $v->phone,
            'email' => $v->email,
            'city' => $v->city,
            'state' => $v->state,
            'paymentTermsDays' => (int) $v->payment_terms_days,
            'status' => (string) $v->status,
        ];
    }

    /** @return array<string, mixed> */
    private function detail(Vendor $v): array
    {
        return [
            ...$this->row($v),
            'website' => $v->website,
            'line1' => $v->line1,
            'line2' => $v->line2,
            'country' => $v->country,
            'postalCode' => $v->postal_code,
            'preferredLocale' => $v->preferred_locale,
            // Solo los cuatro últimos. El cifrado no sale de la base: ver el
            // comentario de la clase.
            'taxIdLast4' => $v->tax_id_last4,
            'w9OnFile' => (bool) $v->w9_on_file,
            // Los diez primeros caracteres y no `format()`: así da igual que el
            // molde devuelva una fecha o la cadena de la base, y no hay una
            // rama que dependa de cómo esté declarado el molde.
            'w9ReceivedOn' => $v->w9_received_on === null
                ? null
                : mb_substr((string) $v->w9_received_on, 0, 10),
            'paymentMethod' => $v->payment_method,
            'accountLast4' => $v->account_last4,
            'notes' => $v->notes,
            'createdAt' => Viewer::at($v->created_at),
        ];
    }

    /** @return list<array<string, mixed>> */
    private function contactos(Vendor $v): array
    {
        return DB::table('vendor_contacts')
            ->where('vendor_id', $v->id)
            ->whereNull('deleted_at')
            ->orderByDesc('is_primary')
            ->orderBy('last_name')
            ->get()
            ->map(static fn (object $c): array => [
                'id' => (string) $c->id,
                'firstName' => (string) $c->first_name,
                'lastName' => (string) $c->last_name,
                'email' => $c->email,
                'phone' => $c->phone,
                'phoneExtension' => $c->phone_extension,
                'position' => $c->position,
                'preferredLocale' => $c->preferred_locale,
                'isPrimary' => (bool) $c->is_primary,
                'notes' => $c->notes,
            ])
            ->all();
    }

    /** @return list<array{id: string, name: string, accountReference: string|null}> */
    private function transportistasDe(Vendor $v): array
    {
        return DB::table('vendor_carriers as vc')
            ->join('carriers as c', 'c.id', '=', 'vc.carrier_id')
            ->where('vc.vendor_id', $v->id)
            ->whereNull('vc.deleted_at')
            ->orderBy('c.legal_name')
            ->get(['c.id', 'c.legal_name as name', 'vc.account_reference'])
            ->map(static fn (object $r): array => [
                'id' => (string) $r->id,
                'name' => (string) $r->name,
                'accountReference' => $r->account_reference,
            ])
            ->all();
    }

    /**
     * Lo que le arrienda: camiones y remolques que APUNTAN a esta ficha.
     *
     * Dos consultas y no una con `union`: son dos tablas con columnas
     * distintas, y juntarlas en SQL obligaría a inventar columnas vacías en
     * las dos para que casaran. El orden final se hace aquí, por fecha de fin,
     * que es lo que se mira en esta lista.
     *
     * @return list<array<string, mixed>>
     */
    private function unidadesArrendadas(Vendor $v): array
    {
        $salida = [];

        foreach (['truck' => 'trucks', 'trailer' => 'trailers'] as $tipo => $tabla) {
            foreach (DB::table($tabla)
                ->where('lessor_vendor_id', $v->id)
                ->whereNull('deleted_at')
                ->orderBy('unit_number')
                ->get(['id', 'unit_number', 'ownership', 'lease_ends_on', 'status', 'carrier_id']) as $u) {
                $salida[] = [
                    'id' => (string) $u->id,
                    'kind' => $tipo,
                    'unitNumber' => (string) $u->unit_number,
                    'ownership' => $u->ownership,
                    'leaseEndsOn' => $u->lease_ends_on === null ? null : mb_substr((string) $u->lease_ends_on, 0, 10),
                    'status' => (string) $u->status,
                    'carrierId' => $u->carrier_id === null ? null : (string) $u->carrier_id,
                ];
            }
        }

        // Lo que vence antes, primero. Lo que no tiene fecha, al final: son
        // los contratos abiertos, y no son los que hay que mirar hoy.
        usort($salida, static function (array $a, array $b): int {
            if ($a['leaseEndsOn'] === $b['leaseEndsOn']) {
                return strcmp((string) $a['unitNumber'], (string) $b['unitNumber']);
            }

            return match (true) {
                $a['leaseEndsOn'] === null => 1,
                $b['leaseEndsOn'] === null => -1,
                default => strcmp((string) $a['leaseEndsOn'], (string) $b['leaseEndsOn']),
            };
        });

        return $salida;
    }

    /** @return array<string, mixed> */
    private function gastosDe(Vendor $v): array
    {
        $filas = DB::table('expenses')
            ->where('vendor_id', $v->id)
            ->whereNull('deleted_at')
            ->orderByDesc('incurred_on')
            ->limit(20)
            ->get(['id', 'amount_cents', 'description', 'incurred_on', 'status']);

        return [
            'rows' => $filas->map(static fn (object $g): array => [
                'id' => (string) $g->id,
                'amountCents' => (int) $g->amount_cents,
                'description' => $g->description,
                'incurredOn' => $g->incurred_on === null ? null : mb_substr((string) $g->incurred_on, 0, 10),
                'status' => (string) $g->status,
            ])->all(),
            // El total va SOBRE TODOS y no sobre los veinte que se enseñan: un
            // total que solo suma la primera página es un total falso con
            // aspecto de total.
            'totalCents' => (int) DB::table('expenses')
                ->where('vendor_id', $v->id)
                ->whereNull('deleted_at')
                ->sum('amount_cents'),
            'count' => (int) DB::table('expenses')
                ->where('vendor_id', $v->id)
                ->whereNull('deleted_at')
                ->count(),
        ];
    }

    /**
     * Lo que impide retirar un proveedor, contado.
     *
     * @return array<string, int>
     */
    private function loQueLoAta(Vendor $v): array
    {
        $unidades = DB::table('trucks')->where('lessor_vendor_id', $v->id)->whereNull('deleted_at')->count()
            + DB::table('trailers')->where('lessor_vendor_id', $v->id)->whereNull('deleted_at')->count();

        $gastos = DB::table('expenses')->where('vendor_id', $v->id)->whereNull('deleted_at')->count();

        return array_filter(['units' => $unidades, 'expenses' => $gastos], static fn (int $n): bool => $n > 0);
    }

    /* ── Las listas de apoyo ────────────────────────────────────────────── */

    /**
     * @param  list<string>  $ids
     * @return array<string, int>
     */
    private function cuentasDeTransportista(array $ids): array
    {
        return $ids === [] ? [] : DB::table('vendor_carriers')
            ->whereIn('vendor_id', $ids)
            ->whereNull('deleted_at')
            ->select('vendor_id', DB::raw('count(*) as total'))
            ->groupBy('vendor_id')
            ->pluck('total', 'vendor_id')
            ->map(static fn ($v): int => (int) $v)
            ->all();
    }

    /**
     * @param  list<string>  $ids
     * @return array<string, int>
     */
    private function cuentasDeUnidades(array $ids): array
    {
        if ($ids === []) {
            return [];
        }

        $salida = [];

        foreach (['trucks', 'trailers'] as $tabla) {
            foreach (DB::table($tabla)
                ->whereIn('lessor_vendor_id', $ids)
                ->whereNull('deleted_at')
                ->select('lessor_vendor_id', DB::raw('count(*) as total'))
                ->groupBy('lessor_vendor_id')
                ->get() as $fila) {
                $clave = (string) $fila->lessor_vendor_id;
                $salida[$clave] = ($salida[$clave] ?? 0) + (int) $fila->total;
            }
        }

        return $salida;
    }

    /** @return list<array{id: string, name: string}> */
    private function transportistasParaElegir(Actor $actor): array
    {
        return DB::table('carriers')
            ->where('tenant_id', $actor->tenantId)
            ->whereNull('deleted_at')
            ->when($actor->carrierId !== null, fn ($q) => $q->where('id', $actor->carrierId))
            ->orderBy('legal_name')
            ->get(['id', 'legal_name as name'])
            ->map(fn ($r): array => ['id' => (string) $r->id, 'name' => (string) $r->name])
            ->all();
    }

    /** @return array<string, list<string>> */
    private function codigos(): array
    {
        return [
            'types' => VendorType::values(),
            'statuses' => ['active', 'inactive', 'archived'],
            'paymentMethods' => self::FORMAS_DE_PAGO,
            'countries' => Regions::countryCodes(),
            'locales' => Locales::all(),
        ];
    }

    /* ── Guardar ────────────────────────────────────────────────────────── */

    /**
     * Las columnas de la ficha.
     *
     * El identificador fiscal es el único campo que NO se escribe cuando no
     * viene: la pantalla no lo puede devolver —no se enseña nunca— así que
     * tratar su ausencia como «bórralo» haría que editar el teléfono borrara
     * el EIN. La ausencia significa «déjalo», igual que en las tarifas de una
     * carga; una cadena vacía sí lo borra, que es cómo se quita.
     *
     * @param  array<string, mixed>  $data
     * @return array<string, mixed>
     */
    private function columnas(array $data, ?Vendor $existente): array
    {
        $clave = NameKey::for((string) $data['company_name']);

        $columnas = [
            'company_name' => $data['company_name'],
            'company_name_normalized' => $clave,
            'vendor_type' => $data['vendor_type'],
            'website' => $data['website'] ?? null,
            'phone' => $data['phone'] ?? null,
            // `isset` ya excluye el nulo: la segunda mitad no podía ser falsa.
            'phone_normalized' => isset($data['phone'])
                ? preg_replace('/\D+/', '', (string) $data['phone'])
                : null,
            'email' => $data['email'] ?? null,
            'email_normalized' => isset($data['email'])
                ? strtolower((string) $data['email'])
                : null,
            'preferred_locale' => $data['preferred_locale'] ?? null,
            'line1' => $data['line1'] ?? null,
            'line2' => $data['line2'] ?? null,
            'city' => $data['city'] ?? null,
            'state' => $data['state'] ?? null,
            'country' => $data['country'] ?? Regions::DEFAULT_COUNTRY,
            'postal_code' => $data['postal_code'] ?? null,
            'w9_on_file' => (bool) ($data['w9_on_file'] ?? false),
            'payment_terms_days' => (int) ($data['payment_terms_days'] ?? 30),
            'payment_method' => $data['payment_method'] ?? null,
            'account_last4' => $data['account_last4'] ?? null,
            'status' => $data['status'] ?? 'active',
            'notes' => $data['notes'] ?? null,
        ];

        // La fecha del W-9 solo existe si hay W-9. Es la misma regla que la
        // restricción de la base, adelantada para que no llegue como un error
        // de SQL que nadie sabe leer.
        $columnas['w9_received_on'] = $columnas['w9_on_file'] ? ($data['w9_received_on'] ?? null) : null;

        if ($existente === null) {
            $columnas['tenant_id'] = app(TenantContext::class)->id();
        }

        if (array_key_exists('tax_id', $data)) {
            $enClaro = trim((string) ($data['tax_id'] ?? ''));

            $columnas['tax_id_encrypted'] = $enClaro === '' ? null : $enClaro;
            $columnas['tax_id_last4'] = $enClaro === '' ? null : mb_substr($enClaro, -4);
        }

        return $columnas;
    }

    /**
     * @param  array<string, mixed>  $data
     * @return list<array<string, mixed>>
     */
    private function sacarContactos(array &$data): array
    {
        $contactos = $data['contacts'] ?? [];
        unset($data['contacts']);

        return array_values(is_array($contactos) ? $contactos : []);
    }

    /**
     * @param  array<string, mixed>  $data
     * @return list<string>
     */
    private function sacarTransportistas(array &$data): array
    {
        $ids = $data['carrier_ids'] ?? [];
        unset($data['carrier_ids']);

        return array_values(array_unique(array_map(
            static fn ($v): string => (string) $v,
            is_array($ids) ? $ids : [],
        )));
    }

    /**
     * Los contactos, sincronizados.
     *
     * El principal se decide AQUÍ y a la fuerza: el primero de la lista, y
     * solo él. La base tiene un único que no admite dos principales vivos, así
     * que mandar dos marcados daría un error de SQL en vez de una pantalla;
     * decidirlo aquí es lo que hace que la regla se cumpla siempre y no solo
     * cuando el formulario se porta bien.
     *
     * @param  list<array<string, mixed>>  $contactos
     */
    private function guardarContactos(Actor $actor, Vendor $vendor, array $contactos): void
    {
        $ahora = now();
        $vistos = [];

        // Los que se quitan se CIERRAN antes de escribir los que quedan: si el
        // principal cambia de persona, el único de la base choca consigo mismo
        // mientras los dos están vivos.
        $idsQueQuedan = array_values(array_filter(array_map(
            static fn (array $c): ?string => isset($c['id']) && $c['id'] !== '' ? (string) $c['id'] : null,
            $contactos,
        )));

        DB::table('vendor_contacts')
            ->where('vendor_id', $vendor->id)
            ->whereNull('deleted_at')
            ->when($idsQueQuedan !== [], fn ($q) => $q->whereNotIn('id', $idsQueQuedan))
            ->update(['deleted_at' => $ahora, 'deleted_by' => $actor->userId, 'updated_at' => $ahora]);

        // Y se apaga el principal viejo antes de encender el nuevo, por lo
        // mismo: el único es sobre la fila viva, no sobre la fila nueva.
        DB::table('vendor_contacts')
            ->where('vendor_id', $vendor->id)
            ->whereNull('deleted_at')
            ->update(['is_primary' => false, 'updated_at' => $ahora]);

        foreach ($contactos as $i => $c) {
            $columnas = [
                'tenant_id' => $vendor->tenant_id,
                'vendor_id' => $vendor->id,
                'first_name' => (string) ($c['first_name'] ?? ''),
                'last_name' => (string) ($c['last_name'] ?? ''),
                'email' => $c['email'] ?? null,
                'phone' => $c['phone'] ?? null,
                'phone_extension' => $c['phone_extension'] ?? null,
                'position' => $c['position'] ?? null,
                'preferred_locale' => $c['preferred_locale'] ?? null,
                'is_primary' => $i === 0,
                'notes' => $c['notes'] ?? null,
                'updated_at' => $ahora,
            ];

            $id = isset($c['id']) && $c['id'] !== '' ? (string) $c['id'] : null;

            $existente = $id === null ? null : DB::table('vendor_contacts')
                ->where('vendor_id', $vendor->id)
                ->where('id', $id)
                ->whereNull('deleted_at')
                ->first(['id']);

            // Un id que no resuelve NO se convierte en un contacto nuevo:
            // convertirlo taparía el intento de tocar la ficha de otro.
            abort_if($id !== null && $existente === null, 404);

            if ($existente !== null) {
                DB::table('vendor_contacts')->where('id', $id)->update($columnas);

                $vistos[] = $id;

                continue;
            }

            $nuevo = (string) Str::uuid();
            DB::table('vendor_contacts')->insert([...$columnas, 'id' => $nuevo, 'created_at' => $ahora]);
            $vistos[] = $nuevo;
        }
    }

    /**
     * A qué transportistas sirve.
     *
     * Los que se quitan se CIERRAN con fecha, no se borran de la tabla: hace
     * falta poder decir quién le arrendaba a quién el año pasado cuando
     * aparece una factura vieja.
     *
     * @param  list<string>  $carrierIds
     */
    private function guardarTransportistas(Actor $actor, Vendor $vendor, array $carrierIds): void
    {
        $ahora = now();

        // Solo los que esta persona puede elegir: un id de la barra de
        // direcciones no ata el proveedor a un transportista de otra empresa.
        $validos = collect($this->transportistasParaElegir($actor))->pluck('id');
        $quiere = collect($carrierIds)->filter(fn (string $id): bool => $validos->contains($id))->values();

        DB::table('vendor_carriers')
            ->where('vendor_id', $vendor->id)
            ->whereNull('deleted_at')
            ->when($quiere->isNotEmpty(), fn ($q) => $q->whereNotIn('carrier_id', $quiere->all()))
            ->update(['deleted_at' => $ahora, 'deleted_by' => $actor->userId, 'updated_at' => $ahora]);

        foreach ($quiere as $carrierId) {
            $ya = DB::table('vendor_carriers')
                ->where('vendor_id', $vendor->id)
                ->where('carrier_id', $carrierId)
                ->whereNull('deleted_at')
                ->exists();

            if ($ya) {
                continue;
            }

            DB::table('vendor_carriers')->insert([
                'id' => (string) Str::uuid(),
                'tenant_id' => $vendor->tenant_id,
                'vendor_id' => $vendor->id,
                'carrier_id' => $carrierId,
                'created_at' => $ahora,
                'updated_at' => $ahora,
            ]);
        }
    }

    /**
     * @return array<string, mixed>
     */
    private function validated(Request $request, ?Vendor $existente): array
    {
        return $request->validate([
            'company_name' => ['required', 'string', 'max:200'],
            'vendor_type' => ['required', Rule::in(VendorType::values())],
            'website' => ['nullable', 'string', 'max:255'],
            'phone' => ['nullable', 'string', 'max:32'],
            'email' => ['nullable', 'email:rfc', 'max:255'],
            'preferred_locale' => ['nullable', Rule::in(Locales::all())],

            'line1' => ['nullable', 'string', 'max:200'],
            'line2' => ['nullable', 'string', 'max:200'],
            'city' => ['nullable', 'string', 'max:120'],
            'country' => ['nullable', 'string', Rule::in(Regions::countryCodes())],
            'state' => ['nullable', 'string', 'max:3', new SubdivisionOfCountry($request->input('country'))],
            'postal_code' => ['nullable', 'string', 'max:12'],

            // Llega en claro por HTTPS y se cifra antes de tocar la base. No se
            // valida su forma: un EIN son nueve dígitos, pero un proveedor
            // extranjero no tiene EIN y rechazarlo dejaría fuera a un
            // proveedor real.
            'tax_id' => ['nullable', 'string', 'max:40'],
            'w9_on_file' => ['boolean'],
            'w9_received_on' => ['nullable', 'date'],

            'payment_terms_days' => ['nullable', 'integer', 'min:0', 'max:365'],
            'payment_method' => ['nullable', Rule::in(self::FORMAS_DE_PAGO)],
            'account_last4' => ['nullable', 'string', 'regex:/^[0-9]{4}$/'],

            'status' => ['nullable', Rule::in(['active', 'inactive', 'archived'])],
            'notes' => ['nullable', 'string', 'max:5000'],

            'carrier_ids' => ['array'],
            'carrier_ids.*' => ['string', 'size:36'],

            'contacts' => ['array', 'max:20'],
            'contacts.*.id' => ['nullable', 'string', 'size:36'],
            'contacts.*.first_name' => ['required', 'string', 'max:100'],
            'contacts.*.last_name' => ['required', 'string', 'max:100'],
            'contacts.*.email' => ['nullable', 'email:rfc', 'max:255'],
            'contacts.*.phone' => ['nullable', 'string', 'max:32'],
            'contacts.*.phone_extension' => ['nullable', 'string', 'max:10'],
            'contacts.*.position' => ['nullable', 'string', 'max:120'],
            'contacts.*.preferred_locale' => ['nullable', Rule::in(Locales::all())],
            'contacts.*.notes' => ['nullable', 'string', 'max:2000'],
        ]);
    }
}
