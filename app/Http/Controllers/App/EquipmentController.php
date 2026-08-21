<?php

declare(strict_types=1);

namespace App\Http\Controllers\App;

use App\Authorization\Actor;
use App\Authorization\CurrentActor;
use App\Authorization\PermissionChecker;
use App\Authorization\ResourceContext;
use App\Enums\Scope;
use App\Models\Trailer;
use App\Models\Truck;
use App\Support\EnumValue;
use App\Support\InertiaPage;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Inertia\Inertia;
use Inertia\Response;

/**
 * Camiones y remolques.
 *
 * Un solo controlador para los dos porque son el mismo dominio: comparten los
 * permisos (`equipment:*`), el ciclo de vida, la unicidad del VIN y del número
 * de unidad, y las fechas de inspección y matrícula. Lo único que los separa
 * son unas columnas de medidas que solo tiene el remolque.
 *
 * Dos controladores casi idénticos habrían empezado a divergir en el primer
 * arreglo que se hiciera en uno y no en el otro — y el que se quedara atrás
 * sería el remolque, que es el que menos se mira.
 *
 * La regla propia de este dominio: **poner una unidad fuera de servicio la
 * retira de las cargas donde esté asignada.** Una unidad fuera de servicio que
 * siguiera figurando en una carga en tránsito es la peor combinación posible —
 * el sistema diría que tiene camión y el camión estaría en el taller.
 */
final class EquipmentController
{
    use InertiaPage;

    private const PER_PAGE = 25;

    /** A cuántos días vista se avisa de una inspección o una matrícula. */
    private const WARN_DAYS = 45;

    private const SORTABLE = [
        'unit_number' => 'unit_number',
        'status' => 'status',
        'year' => 'year',
        'next_inspection_due_at' => 'next_inspection_due_at',
        'registration_expires_at' => 'registration_expires_at',
    ];

    public function index(Request $request, string $type, CurrentActor $current, PermissionChecker $checker): Response
    {
        $this->assertType($type);

        $actor = $current->require();
        $policy = $current->policy();
        $scope = $checker->authorize($actor, 'equipment:read', null, $policy);

        $this->usesDictionary($request, ['equipment', 'nav']);

        $filters = [
            'search' => trim((string) $request->query('search', '')),
            'status' => (string) $request->query('status', ''),
            'expiring' => $request->query('expiring') === '1' ? '1' : '',
            'sort' => (string) $request->query('sort', 'unit_number'),
            'direction' => $request->query('direction') === 'desc' ? 'desc' : 'asc',
        ];

        $query = $this->scoped($checker, $actor, $scope, $type);
        $this->applyFilters($query, $filters);

        $sort = self::SORTABLE[$filters['sort']] ?? 'unit_number';

        $page = $query->orderBy($sort, $filters['direction'])->orderBy('id')
            ->paginate(self::PER_PAGE)->withQueryString();

        $rows = collect($page->items());
        $carriers = $this->carrierNames($rows);

        return Inertia::render('App/Equipment/Index', [
            'type' => $type,
            'units' => [
                'data' => $rows->map(fn (Model $u): array => $this->row($u, $carriers, $type))->all(),
                'meta' => [
                    'total' => $page->total(),
                    'perPage' => $page->perPage(),
                    'currentPage' => $page->currentPage(),
                    'lastPage' => $page->lastPage(),
                ],
            ],
            'filters' => $filters,
            'scope' => $scope->value,
            'facets' => $this->facets($checker, $actor, $scope, $type),
            'can' => [
                'create' => $checker->can($actor, 'equipment:create', null, $policy)->allowed,
            ],
        ]);
    }

    public function show(Request $request, string $type, string $unit, CurrentActor $current, PermissionChecker $checker): Response
    {
        $this->assertType($type);

        $actor = $current->require();
        $policy = $current->policy();
        $model = $this->find($type, $unit);
        $context = $this->context($model);

        $checker->authorize($actor, 'equipment:read', $context, $policy);

        $this->usesDictionary($request, ['equipment', 'nav']);

        return Inertia::render('App/Equipment/Show', [
            'type' => $type,
            'unit' => $this->detail($model, $type),
            'loads' => $checker->can($actor, 'load:read', null, $policy)->allowed
                ? $this->recentLoads($model, $type)
                : null,
            'can' => [
                'update' => $checker->can($actor, 'equipment:update', $context, $policy)->allowed,
                'changeStatus' => $checker->can($actor, 'equipment:status:update', $context, $policy)->allowed,
            ],
        ]);
    }

    public function create(Request $request, string $type, CurrentActor $current, PermissionChecker $checker): Response
    {
        $this->assertType($type);

        $actor = $current->require();
        $checker->authorize($actor, 'equipment:create', null, $current->policy());

        $this->usesDictionary($request, ['equipment', 'nav', 'validation']);

        return Inertia::render('App/Equipment/Form', [
            'type' => $type,
            'unit' => null,
            'choices' => $this->choices($actor),
        ]);
    }

    public function store(Request $request, string $type, CurrentActor $current, PermissionChecker $checker): RedirectResponse
    {
        $this->assertType($type);

        $actor = $current->require();
        $checker->authorize($actor, 'equipment:create', null, $current->policy());

        $data = $this->validated($request, $type, $actor);
        $this->guardDuplicates($type, $data, null);

        $model = $type === 'trucks' ? new Truck : new Trailer;
        $model->fill($this->columns($data, $type));
        // Nace pendiente de verificar. Igual que un transportista nace en
        // borrador: que exista la ficha no significa que la unidad esté en
        // regla, y `pending_verification` es lo que impide despacharla sin que
        // alguien la haya mirado.
        $model->status = $data['status'] ?? 'pending_verification';
        $model->save();

        return redirect()->route('equipment.show', [$type, $model->id])
            ->with('success', __('equipment.flash.created', ['unit' => $model->unit_number]));
    }

    public function edit(Request $request, string $type, string $unit, CurrentActor $current, PermissionChecker $checker): Response
    {
        $this->assertType($type);

        $actor = $current->require();
        $model = $this->find($type, $unit);

        $checker->authorize($actor, 'equipment:update', $this->context($model), $current->policy());

        $this->usesDictionary($request, ['equipment', 'nav', 'validation']);

        return Inertia::render('App/Equipment/Form', [
            'type' => $type,
            'unit' => $this->detail($model, $type),
            'choices' => $this->choices($actor),
        ]);
    }

    public function update(Request $request, string $type, string $unit, CurrentActor $current, PermissionChecker $checker): RedirectResponse
    {
        $this->assertType($type);

        $actor = $current->require();
        $model = $this->find($type, $unit);

        $checker->authorize($actor, 'equipment:update', $this->context($model), $current->policy());

        $data = $this->validated($request, $type, $actor);
        $this->guardDuplicates($type, $data, $model->id);

        $model->fill($this->columns($data, $type));
        $model->save();

        return redirect()->route('equipment.show', [$type, $model->id])
            ->with('success', __('equipment.flash.updated', ['unit' => $model->unit_number]));
    }

    /**
     * Cambiar el estado de servicio de una unidad.
     *
     * Sacarla de servicio exige motivo y la RETIRA de las cargas donde esté
     * asignada. Sin eso, una carga en tránsito seguiría diciendo que tiene
     * camión mientras el camión está en el taller — y quien lo descubriría
     * sería el cliente, preguntando por qué no ha llegado su entrega.
     */
    public function status(Request $request, string $type, string $unit, CurrentActor $current, PermissionChecker $checker): RedirectResponse
    {
        $this->assertType($type);

        $actor = $current->require();
        $model = $this->find($type, $unit);

        $checker->authorize($actor, 'equipment:status:update', $this->context($model), $current->policy());

        $data = $request->validate([
            'status' => ['required', 'in:pending_verification,active,out_of_service,archived'],
            'reason' => ['nullable', 'string', 'max:2000'],
        ]);

        $goingDown = in_array($data['status'], ['out_of_service', 'archived'], true);
        $reason = trim((string) ($data['reason'] ?? ''));

        if ($goingDown && mb_strlen($reason) < 5) {
            throw ValidationException::withMessages([
                'reason' => __('equipment.status.reasonRequired'),
            ]);
        }

        $released = DB::transaction(function () use ($model, $data, $reason, $goingDown, $type): int {
            $model->status = $data['status'];
            $model->out_of_service_reason = $goingDown ? $reason : null;
            $model->save();

            if (! $goingDown) {
                return 0;
            }

            $column = $type === 'trucks' ? 'truck_id' : 'trailer_id';

            // Solo de las cargas VIVAS. Retirarla de una carga entregada hace
            // dos meses reescribiría el historial de quién la llevó.
            return DB::table('load_assignments')
                ->where($column, $model->id)
                ->whereNull('unassigned_at')
                ->whereNull('deleted_at')
                ->whereIn('load_id', function ($q): void {
                    $q->select('id')->from('loads')
                        ->whereNotIn('status', ['delivered', 'pod_received', 'invoiced', 'paid', 'cancelled'])
                        ->whereNull('deleted_at');
                })
                ->update([
                    'unassigned_at' => now(),
                    'unassigned_reason' => __('equipment.status.releasedBecause', ['reason' => $reason]),
                    'updated_at' => now(),
                ]);
        });

        return back()->with('success', $released > 0
            ? __('equipment.status.doneAndReleased', ['count' => $released])
            : __('equipment.status.done'));
    }

    // ------------------------------------------------------------------ interno

    private function assertType(string $type): void
    {
        // La ruta lleva el tipo, así que llega de fuera. Sin esta comprobación,
        // «/equipment/usuarios/…» acabaría en un nombre de tabla construido con
        // texto del usuario.
        abort_unless(in_array($type, ['trucks', 'trailers'], true), 404);
    }

    /**
     * @return Builder<Truck>|Builder<Trailer>
     */
    private function scoped(PermissionChecker $checker, Actor $actor, Scope $scope, string $type): Builder
    {
        $query = $type === 'trucks' ? Truck::query() : Trailer::query();

        // El ámbito propio de un CONDUCTOR: las unidades que ha llevado. No hay
        // columna que lo diga —se llega por `load_assignments`, cruzando las
        // cargas donde también va él— así que ScopeFilter no sabe expresarlo y
        // devolvería cero filas.
        //
        // Devolver cero es la forma segura de equivocarse y por eso ScopeFilter
        // hace bien en hacerlo, pero aquí sabemos cómo llegar: el conductor
        // tiene `equipment:read` en la matriz, y una concesión que enseña una
        // lista vacía es una concesión que no significa nada.
        if ($scope === Scope::Own && $actor->driverId !== null) {
            $column = $type === 'trucks' ? 'truck_id' : 'trailer_id';
            $table = $type === 'trucks' ? 'trucks' : 'trailers';

            return $query
                ->where("{$table}.tenant_id", $actor->tenantId)
                ->whereExists(function ($q) use ($actor, $column, $table): void {
                    $q->select(DB::raw(1))
                        ->from('load_assignments as unidad')
                        ->whereColumn("unidad.{$column}", "{$table}.id")
                        ->whereNull('unidad.deleted_at')
                        // La misma carga tiene que llevar a este conductor.
                        ->whereExists(function ($inner) use ($actor): void {
                            $inner->select(DB::raw(1))
                                ->from('load_assignments as suya')
                                ->whereColumn('suya.load_id', 'unidad.load_id')
                                ->where('suya.driver_id', $actor->driverId)
                                ->whereNull('suya.deleted_at');
                        });
                });
        }

        return $checker->scopeFilter($actor, $scope)->apply($query, ['carrier' => 'carrier_id']);
    }

    /**
     * @param  Builder<Model>  $query
     * @param  array<string, string>  $filters
     */
    private function applyFilters(Builder $query, array $filters): void
    {
        if ($filters['search'] !== '') {
            $term = '%'.str_replace(['%', '_'], ['\%', '\_'], $filters['search']).'%';
            // El VIN se busca por su forma normalizada: nadie escribe el VIN
            // con los mismos espacios con que lo tecleó otro.
            $vin = '%'.self::normalizeVin($filters['search']).'%';

            $query->where(function (Builder $q) use ($term, $vin): void {
                $q->where('unit_number', 'like', $term)
                    ->orWhere('vin_normalized', 'like', $vin)
                    ->orWhere('plate_number', 'like', $term)
                    ->orWhere('make', 'like', $term)
                    ->orWhere('model', 'like', $term);
            });
        }

        if (in_array($filters['status'], ['pending_verification', 'active', 'out_of_service', 'archived'], true)) {
            $query->where('status', $filters['status']);
        }

        if ($filters['expiring'] === '1') {
            $limit = CarbonImmutable::now()->addDays(self::WARN_DAYS);

            $query->where(function (Builder $q) use ($limit): void {
                $q->where('next_inspection_due_at', '<=', $limit)
                    ->orWhere('registration_expires_at', '<=', $limit);
            });
        }
    }

    /**
     * @return array<string, int>
     */
    private function facets(PermissionChecker $checker, Actor $actor, Scope $scope, string $type): array
    {
        $counts = $this->scoped($checker, $actor, $scope, $type)
            ->select('status', DB::raw('count(*) as total'))
            ->groupBy('status')->pluck('total', 'status')->all();

        $limit = CarbonImmutable::now()->addDays(self::WARN_DAYS);

        return [
            'all' => array_sum($counts),
            'pending_verification' => (int) ($counts['pending_verification'] ?? 0),
            'active' => (int) ($counts['active'] ?? 0),
            'out_of_service' => (int) ($counts['out_of_service'] ?? 0),
            'archived' => (int) ($counts['archived'] ?? 0),
            'expiring' => $this->scoped($checker, $actor, $scope, $type)
                ->where(function (Builder $q) use ($limit): void {
                    $q->where('next_inspection_due_at', '<=', $limit)
                        ->orWhere('registration_expires_at', '<=', $limit);
                })->count(),
        ];
    }

    private function find(string $type, string $id): Model
    {
        return $type === 'trucks'
            ? Truck::query()->findOrFail($id)
            : Trailer::query()->findOrFail($id);
    }

    private function context(Model $unit): ResourceContext
    {
        return new ResourceContext(
            tenantId: $unit->getAttribute('tenant_id'),
            carrierId: $unit->getAttribute('carrier_id'),
        );
    }

    /**
     * El VIN y el número de unidad son únicos por empresa, y lo impone la base
     * de datos con columnas generadas. Se comprueba aquí igualmente para poder
     * decir CUÁL es la unidad que ya lo tiene.
     *
     * @param  array<string, mixed>  $data
     */
    private function guardDuplicates(string $type, array $data, ?string $ignoreId): void
    {
        $model = $type === 'trucks' ? Truck::class : Trailer::class;

        if (! empty($data['vin'])) {
            $existing = $model::query()
                ->where('vin_normalized', self::normalizeVin((string) $data['vin']))
                ->when($ignoreId !== null, fn (Builder $q) => $q->whereKeyNot($ignoreId))
                ->first(['unit_number']);

            if ($existing !== null) {
                throw ValidationException::withMessages([
                    'vin' => __('equipment.form.vinTaken', ['unit' => (string) $existing->unit_number]),
                ]);
            }
        }

        // El número de unidad es único DENTRO de un transportista, no de la
        // empresa: dos transportistas distintos pueden tener los dos su camión
        // «101», y de hecho lo normal es que lo tengan.
        $existing = $model::query()
            ->where('carrier_id', $data['carrier_id'])
            ->where('unit_number', $data['unit_number'])
            ->when($ignoreId !== null, fn (Builder $q) => $q->whereKeyNot($ignoreId))
            ->exists();

        if ($existing) {
            throw ValidationException::withMessages([
                'unit_number' => __('equipment.form.unitTaken', ['unit' => (string) $data['unit_number']]),
            ]);
        }
    }

    /**
     * Mayúsculas y sin nada que no sea letra o número.
     *
     * Un VIN son 17 caracteres sin I, O ni Q, pero no se valida esa forma: un
     * remolque viejo puede tener un número más corto, y rechazarlo obligaría a
     * inventarse uno.
     */
    private static function normalizeVin(string $vin): string
    {
        return mb_strtoupper(preg_replace('/[^A-Za-z0-9]/', '', $vin) ?? '');
    }

    /**
     * @param  \Illuminate\Support\Collection<int, Model>  $rows
     * @return array<string, string>
     */
    private function carrierNames($rows): array
    {
        $ids = $rows->pluck('carrier_id')->filter()->unique()->all();

        return $ids === [] ? [] : DB::table('carriers')
            ->whereIn('id', $ids)->pluck('legal_name', 'id')->all();
    }

    /**
     * @return array{inspection: string|null, registration: string|null}
     */
    private function expiries(Model $u): array
    {
        $flag = static function ($date): ?string {
            if ($date === null) {
                return null;
            }

            $days = CarbonImmutable::now()->startOfDay()
                ->diffInDays(CarbonImmutable::parse($date)->startOfDay(), false);

            return match (true) {
                $days < 0 => 'expired',
                $days <= self::WARN_DAYS => 'soon',
                default => null,
            };
        };

        return [
            'inspection' => $flag($u->getAttribute('next_inspection_due_at')),
            'registration' => $flag($u->getAttribute('registration_expires_at')),
        ];
    }

    /**
     * @param  array<string, string>  $carriers
     * @return array<string, mixed>
     */
    private function row(Model $u, array $carriers, string $type): array
    {
        $g = fn (string $c) => $u->getAttribute($c);

        return [
            'id' => $g('id'),
            'unitNumber' => (string) $g('unit_number'),
            'vin' => $g('vin'),
            'carrier' => $g('carrier_id') === null ? null : ($carriers[$g('carrier_id')] ?? null),
            'carrierId' => $g('carrier_id'),
            'year' => $g('year') === null ? null : (int) $g('year'),
            'make' => $g('make'),
            'model' => $g('model'),
            'plateNumber' => $g('plate_number'),
            'plateState' => $g('plate_state'),
            'status' => EnumValue::of($g('status'), 'pending_verification'),
            'nextInspectionDueAt' => $this->iso($g('next_inspection_due_at')),
            'registrationExpiresAt' => $this->iso($g('registration_expires_at')),
            'expiries' => $this->expiries($u),
            'type' => $type,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function detail(Model $u, string $type): array
    {
        $g = fn (string $c) => $u->getAttribute($c);

        $common = [
            ...$this->row($u, $this->carrierNames(collect([$u])), $type),
            'equipmentTypeId' => $g('equipment_type_id'),
            'registrationNumber' => $g('registration_number'),
            'lastInspectionAt' => $this->iso($g('last_inspection_at')),
            'lastMaintenanceAt' => $this->iso($g('last_maintenance_at')),
            'nextMaintenanceDueAt' => $this->iso($g('next_maintenance_due_at')),
            'coiVerificationStatus' => EnumValue::of($g('coi_verification_status'), 'not_started'),
            'outOfServiceReason' => $g('out_of_service_reason'),
            'notes' => $g('notes'),
            'createdAt' => $this->iso($g('created_at')),
        ];

        if ($type === 'trucks') {
            return $common;
        }

        return [
            ...$common,
            'lengthInches' => $g('length_inches') === null ? null : (int) $g('length_inches'),
            'widthInches' => $g('width_inches') === null ? null : (int) $g('width_inches'),
            'deckHeightInches' => $g('deck_height_inches') === null ? null : (int) $g('deck_height_inches'),
            'wellLengthInches' => $g('well_length_inches') === null ? null : (int) $g('well_length_inches'),
            'capacityPounds' => $g('capacity_pounds') === null ? null : (int) $g('capacity_pounds'),
            'axleCount' => $g('axle_count') === null ? null : (int) $g('axle_count'),
            'axleConfiguration' => $g('axle_configuration'),
            'removableGooseneck' => (bool) $g('removable_gooseneck'),
            'isExtendable' => (bool) $g('is_extendable'),
        ];
    }

    private function iso(mixed $value): ?string
    {
        if ($value === null) {
            return null;
        }

        return $value instanceof \DateTimeInterface
            ? CarbonImmutable::instance($value)->toIso8601String()
            : (string) $value;
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function recentLoads(Model $u, string $type): array
    {
        $column = $type === 'trucks' ? 'truck_id' : 'trailer_id';

        return DB::table('loads as l')
            ->join('load_assignments as a', 'a.load_id', '=', 'l.id')
            ->where("a.{$column}", $u->getAttribute('id'))
            ->whereNull('a.deleted_at')
            ->whereNull('l.deleted_at')
            ->orderByDesc('l.planned_pickup_at')
            ->limit(10)
            ->get(['l.id', 'l.load_number', 'l.status', 'l.commodity', 'l.planned_pickup_at', 'a.unassigned_at'])
            ->map(fn ($l): array => [
                'id' => (string) $l->id,
                'loadNumber' => (string) $l->load_number,
                'status' => (string) $l->status,
                'commodity' => $l->commodity,
                'plannedPickupAt' => $l->planned_pickup_at,
                'released' => $l->unassigned_at !== null,
            ])
            ->all();
    }

    /**
     * @return array<string, list<array<string, mixed>>>
     */
    private function choices(Actor $actor): array
    {
        return [
            'carriers' => DB::table('carriers')
                ->where('tenant_id', $actor->tenantId)
                ->whereNull('deleted_at')
                ->when($actor->carrierId !== null, fn ($q) => $q->where('id', $actor->carrierId))
                ->orderBy('legal_name')
                ->get(['id', 'legal_name as name'])
                ->map(fn ($r): array => ['id' => (string) $r->id, 'name' => (string) $r->name])
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
     * @param  array<string, mixed>  $data
     * @return array<string, mixed>
     */
    private function columns(array $data, string $type): array
    {
        $columns = [
            'carrier_id' => $data['carrier_id'],
            'unit_number' => $data['unit_number'],
            'vin' => $data['vin'] ?? null,
            'vin_normalized' => empty($data['vin']) ? null : self::normalizeVin((string) $data['vin']),
            'year' => $data['year'] ?? null,
            'make' => $data['make'] ?? null,
            'model' => $data['model'] ?? null,
            'equipment_type_id' => $data['equipment_type_id'] ?? null,
            'plate_number' => $data['plate_number'] ?? null,
            'plate_state' => $data['plate_state'] ?? null,
            'registration_number' => $data['registration_number'] ?? null,
            'registration_expires_at' => $data['registration_expires_at'] ?? null,
            'last_inspection_at' => $data['last_inspection_at'] ?? null,
            'next_inspection_due_at' => $data['next_inspection_due_at'] ?? null,
            'notes' => $data['notes'] ?? null,
        ];

        if ($type === 'trailers') {
            $columns += [
                'length_inches' => $data['length_inches'] ?? null,
                'width_inches' => $data['width_inches'] ?? null,
                'deck_height_inches' => $data['deck_height_inches'] ?? null,
                'well_length_inches' => $data['well_length_inches'] ?? null,
                'capacity_pounds' => $data['capacity_pounds'] ?? null,
                'axle_count' => $data['axle_count'] ?? null,
                'axle_configuration' => $data['axle_configuration'] ?? null,
                'removable_gooseneck' => (bool) ($data['removable_gooseneck'] ?? false),
                'is_extendable' => (bool) ($data['is_extendable'] ?? false),
            ];
        }

        return $columns;
    }

    /**
     * @return array<string, mixed>
     */
    private function validated(Request $request, string $type, Actor $actor): array
    {
        $rules = [
            'carrier_id' => ['required', 'string', 'size:36'],
            'unit_number' => ['required', 'string', 'max:40'],
            'vin' => ['nullable', 'string', 'max:32'],
            'year' => ['nullable', 'integer', 'min:1950', 'max:2100'],
            'make' => ['nullable', 'string', 'max:60'],
            'model' => ['nullable', 'string', 'max:60'],
            'equipment_type_id' => ['nullable', 'string', 'size:36'],
            'plate_number' => ['nullable', 'string', 'max:20'],
            'plate_state' => ['nullable', 'string', 'size:2'],
            'registration_number' => ['nullable', 'string', 'max:60'],
            'registration_expires_at' => ['nullable', 'date'],
            'last_inspection_at' => ['nullable', 'date'],
            'next_inspection_due_at' => ['nullable', 'date'],
            'status' => ['nullable', 'in:pending_verification,active,out_of_service,archived'],
            'notes' => ['nullable', 'string', 'max:5000'],
        ];

        if ($type === 'trailers') {
            $rules += [
                'length_inches' => ['nullable', 'integer', 'min:0', 'max:2000'],
                'width_inches' => ['nullable', 'integer', 'min:0', 'max:400'],
                'deck_height_inches' => ['nullable', 'integer', 'min:0', 'max:200'],
                'well_length_inches' => ['nullable', 'integer', 'min:0', 'max:2000'],
                'capacity_pounds' => ['nullable', 'integer', 'min:0', 'max:500000'],
                'axle_count' => ['nullable', 'integer', 'min:1', 'max:20'],
                'axle_configuration' => ['nullable', 'string', 'max:60'],
                'removable_gooseneck' => ['boolean'],
                'is_extendable' => ['boolean'],
            ];
        }

        $data = $request->validate($rules);

        // El transportista tiene que ser de esta empresa, y si quien edita es un
        // usuario transportista, tiene que ser el suyo. La validación de formato
        // no lo garantiza.
        $allowed = collect($this->choices($actor)['carriers'])->pluck('id');

        if (! $allowed->contains($data['carrier_id'])) {
            throw ValidationException::withMessages([
                'carrier_id' => __('equipment.form.carrierNotAllowed'),
            ]);
        }

        return $data;
    }
}
