<?php

declare(strict_types=1);

namespace App\Http\Controllers\App;

use App\Authorization\Actor;
use App\Authorization\CurrentActor;
use App\Authorization\PermissionChecker;
use App\Authorization\ResourceContext;
use App\Enums\AuditAction;
use App\Enums\DriverStatus;
use App\Enums\Scope;
use App\Enums\WorkAuthorization;
use App\Models\Driver;
use App\Rules\SubdivisionOfCountry;
use App\Support\Audit;
use App\Support\Compliance\ExpiryWindow;
use App\Support\Drivers\Cdl;
use App\Support\Drivers\DriverScope;
use App\Support\EnumValue;
use App\Support\Fleet\StandingAssignment;
use App\Support\Geo\Regions;
use App\Support\InertiaPage;
use App\Support\Links\CrossLink;
use App\Support\Lists\FacetCounts;
use App\Support\Security\SensitiveNumber;
use App\Support\Time\CalendarDates;
use App\Support\Tracking\Consent;
use Carbon\CarbonImmutable;
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
 * Los conductores.
 *
 * Tres cosas lo separan de los dominios anteriores.
 *
 * **El número de licencia no existe en claro.** Se guarda cifrado, con los
 * últimos cuatro aparte para poder enseñarlo y un índice ciego para poder
 * buscarlo. Ninguna respuesta de este controlador lleva el número entero, ni
 * siquiera para el admin: si alguna pantalla lo necesitara, la pantalla estaría
 * mal. Ver App\Support\Security\SensitiveNumber.
 *
 * **El transportista gestiona sus propios conductores.** Tiene `driver:create`,
 * `driver:update` y `driver:approve` con ámbito `carrier`, y no es un descuido
 * de la matriz: bajo la normativa federal el expediente de cualificación del
 * conductor es responsabilidad del TRANSPORTISTA, no de la oficina de despacho.
 * Quien despacha comprueba que esté en regla; quien responde ante la autoridad
 * es el transportista. Cambiar esto sería moverle a Goliath una obligación
 * legal que no le corresponde.
 *
 * **El propio conductor puede editar lo suyo** (`driver:self:update`), pero no
 * su verificación. Un conductor que pudiera marcarse a sí mismo como verificado
 * vaciaría de sentido la comprobación que impide despachar.
 */
final class DriverController
{
    use InertiaPage;

    private const PER_PAGE = 25;

    private const SORTABLE = [
        'last_name' => 'last_name',
        'status' => 'status',
        'license_expires_at' => 'license_expires_at',
        'medical_card_expires_at' => 'medical_card_expires_at',
    ];

    /**
     * Las tres tablas de la licencia, para la pantalla.
     *
     * Se mandan desde aquí porque el formulario llevaba la suya: una constante
     * `ENDORSEMENTS` en el TSX, con un comentario que decía «son cinco y no
     * cambian» encima de una lista de SEIS. Con la lista en un sitio y la
     * validación en otro, las dos podían decir cosas distintas — y lo decían.
     *
     * @var array<string, list<string>>
     */
    private const CODIGOS = [
        'cdlClass' => Cdl::CLASES,
        'endorsements' => Cdl::ENDOSOS,
        'restrictions' => Cdl::RESTRICCIONES,
    ];

    public function index(Request $request, CurrentActor $current, PermissionChecker $checker): Response
    {
        $actor = $current->require();
        $policy = $current->policy();
        $scope = $checker->authorize($actor, 'driver:read', null, $policy);

        $this->usesDictionary($request, ['drivers', 'nav']);

        $filters = [
            'search' => trim((string) $request->query('search', '')),
            'status' => (string) $request->query('status', ''),
            'expiring' => $request->query('expiring') === '1' ? '1' : '',
            'sort' => (string) $request->query('sort', 'last_name'),
            'direction' => $request->query('direction') === 'desc' ? 'desc' : 'asc',
        ];

        $query = $this->scoped($checker, $actor, $scope);
        $this->applyFilters($query, $filters);

        $sort = self::SORTABLE[$filters['sort']] ?? 'last_name';

        $page = $query->orderBy($sort, $filters['direction'])->orderBy('id')
            ->paginate(self::PER_PAGE)->withQueryString();

        $rows = collect($page->items());

        return Inertia::render('App/Drivers/Index', [
            'drivers' => [
                'data' => $rows->map(fn (Driver $d): array => $this->row($d))->all(),
                'meta' => [
                    'total' => $page->total(),
                    'perPage' => $page->perPage(),
                    'currentPage' => $page->currentPage(),
                    'lastPage' => $page->lastPage(),
                ],
            ],
            'filters' => $filters,
            'scope' => $scope->value,
            'facets' => $this->facets($checker, $actor, $scope, $filters),
            'can' => [
                'create' => $checker->can($actor, 'driver:create', null, $policy)->allowed,
            ],
        ]);
    }

    public function show(Request $request, string $driver, CurrentActor $current, PermissionChecker $checker): Response
    {
        $actor = $current->require();
        $policy = $current->policy();
        $model = $this->find($driver);
        $context = $this->context($model);

        $checker->authorize($actor, 'driver:read', $context, $policy);

        // `tracking` porque el panel de consentimiento vive en esta ficha: es la
        // pantalla del conductor, y el consentimiento es suyo.
        $this->usesDictionary($request, ['drivers', 'tracking', 'nav', 'common']);

        $puedeEditar = $this->mayEdit($checker, $actor, $model, $policy);

        return Inertia::render('App/Drivers/Show', [
            'driver' => $this->detail($model),
            'carriers' => $this->carriers($model, $checker, $actor, $policy),
            // El equipo habitual: la vigente y las de antes. Las unidades para
            // elegir solo viajan si esta persona puede cambiarlo — una lista de
            // la flota entera en la carga de una pantalla de solo lectura es
            // un dato que nadie pidió.
            'standing' => $this->equipoHabitual($model),
            'equipmentChoices' => $puedeEditar ? $this->unidadesParaElegir($actor, (string) $model->id) : null,
            'loads' => $checker->can($actor, 'load:read', null, $policy)->allowed
                ? $this->recentLoads($model)
                : null,
            'can' => [
                'update' => $puedeEditar,
                'approve' => $checker->can($actor, 'driver:approve', $context, $policy)->allowed,
                // Otorgar o retirar el consentimiento: el permiso es de ámbito
                // propio y ADEMÁS se exige que esta ficha sea la suya. Un
                // administrador con todos los permisos del mundo ve el estado y
                // no ve el botón.
                'consent' => $actor->driverId !== null
                    && (string) $actor->driverId === (string) $model->id
                    && $checker->can($actor, 'tracking:consent', $context, $policy)->allowed,
            ],
        ]);
    }

    public function create(Request $request, CurrentActor $current, PermissionChecker $checker): Response
    {
        $actor = $current->require();
        $checker->authorize($actor, 'driver:create', null, $current->policy());

        $this->usesDictionary($request, ['drivers', 'nav', 'validation']);

        return Inertia::render('App/Drivers/Form', [
            'driver' => null,
            'carriers' => $this->carrierChoices($actor),
            'selectedCarriers' => [],
            // El equipo se elige en el alta: el camión y el remolque del
            // transportista que se acaba de marcar, y solo los que no lleva ya
            // otro conductor.
            'equipment' => $this->unidadesParaElegir($actor),
            'codes' => self::CODIGOS,
        ]);
    }

    public function store(Request $request, CurrentActor $current, PermissionChecker $checker): RedirectResponse
    {
        $actor = $current->require();
        $checker->authorize($actor, 'driver:create', null, $current->policy());

        $data = $this->validated($request);
        $this->guardDuplicateLicence($data['license_number'] ?? null, null);

        $driver = DB::transaction(function () use ($data, $actor): Driver {
            $driver = new Driver;
            $driver->fill($this->stampVerifications($actor, null, $this->columns($data)));
            // Nace SIN verificar, diga lo que diga el formulario. Verificar es
            // un acto aparte con su propio permiso, igual que aprobar un alta
            // de transportista.
            $driver->verification_status = 'not_started';
            $driver->save();

            $this->syncCarriers($driver, $data['carrier_ids'] ?? [], $actor);

            return $driver;
        });

        // El equipo, si se eligió. Fuera de la transacción de arriba a
        // propósito: un choque de asignación no puede deshacer el alta del
        // conductor, que ya es correcta. Se avisa y se resuelve desde su ficha.
        $choques = $this->equipoDelAlta($request, $actor, $driver);

        return redirect()->route('drivers.show', $driver->id)
            ->with('success', __('drivers.flash.created', ['name' => $driver->first_name.' '.$driver->last_name]))
            ->with('warning', $choques === null ? null : __('drivers.standing.'.$choques));
    }

    public function edit(Request $request, string $driver, CurrentActor $current, PermissionChecker $checker): Response
    {
        $actor = $current->require();
        $model = $this->find($driver);

        abort_unless($this->mayEdit($checker, $actor, $model, $current->policy()), 403);

        $this->usesDictionary($request, ['drivers', 'nav', 'validation']);

        return Inertia::render('App/Drivers/Form', [
            'driver' => $this->detail($model),
            'carriers' => $this->carrierChoices($actor),
            'selectedCarriers' => collect($this->carriers($model, $checker, $actor, $current->policy()))
                ->pluck('id')->all(),
            'codes' => self::CODIGOS,
        ]);
    }

    public function update(Request $request, string $driver, CurrentActor $current, PermissionChecker $checker): RedirectResponse
    {
        $actor = $current->require();
        $model = $this->find($driver);

        abort_unless($this->mayEdit($checker, $actor, $model, $current->policy()), 403);

        $data = $this->validated($request);
        $this->guardDuplicateLicence($data['license_number'] ?? null, $model->id);

        // Un conductor editando su propia ficha NO toca su relación con
        // transportistas ni su estado. Podría quitarse de un transportista para
        // esquivar una comprobación, o ponerse «disponible» estando fuera de
        // servicio.
        $isSelf = ! $checker->can($actor, 'driver:update', $this->context($model), $current->policy())->allowed;

        DB::transaction(function () use ($model, $data, $actor, $isSelf): void {
            $columns = $this->stampVerifications($actor, $model, $this->columns($data));

            if ($isSelf) {
                unset($columns['status']);
            }

            $model->fill($columns);
            $model->save();

            if (! $isSelf) {
                $this->syncCarriers($model, $data['carrier_ids'] ?? [], $actor);
            }
        });

        return redirect()->route('drivers.show', $model->id)
            ->with('success', __('drivers.flash.updated', ['name' => $model->first_name.' '.$model->last_name]));
    }

    /**
     * Verificar a un conductor tras revisar su licencia.
     *
     * Deja constancia de quién la revisó y cuándo. Es lo que se enseña si un
     * inspector pregunta por el expediente de cualificación.
     */
    public function verify(Request $request, string $driver, CurrentActor $current, PermissionChecker $checker): RedirectResponse
    {
        $actor = $current->require();
        $model = $this->find($driver);

        $checker->authorize($actor, 'driver:approve', $this->context($model), $current->policy());

        $data = $request->validate([
            'status' => ['required', 'in:verified,mismatch,failed'],
            'notes' => ['nullable', 'string', 'max:2000'],
        ]);

        // Todo lo que no sea «verificado» exige explicación: es lo que impedirá
        // que a este conductor se le asigne una carga, y quien lo lea después
        // necesita saber por qué.
        if ($data['status'] !== 'verified' && trim((string) ($data['notes'] ?? '')) === '') {
            throw ValidationException::withMessages(['notes' => __('drivers.verify.notesRequired')]);
        }

        DB::transaction(function () use ($model, $data, $actor): void {
            $before = EnumValue::of($model->verification_status, 'not_started');

            $model->verification_status = $data['status'];
            $model->verified_by_user_id = $actor->auditUserId();
            $model->verified_at = now();
            $model->verification_notes = $data['notes'] ?? null;
            $model->save();

            // Audit::record y no un insert a mano: el ayudante guarda además el
            // correo y el rol del actor y, sobre todo, la sesión de
            // suplantación. Un insert directo atribuiría la revisión al usuario
            // suplantado, que es falsificar el registro.
            Audit::record(
                actor: $actor,
                action: AuditAction::DriverVerified,
                entityType: 'driver',
                entityId: $model->id,
                entityLabel: trim("{$model->first_name} {$model->last_name}"),
                before: ['verification_status' => $before],
                after: ['verification_status' => $data['status']],
                reason: $data['notes'] ?? null,
            );
        });

        return back()->with('success', __('drivers.verify.done'));
    }

    // ------------------------------------------------------------------ interno

    /**
     * ¿Puede este actor editar esta ficha?
     *
     * Dos caminos: el permiso general sobre conductores, o ser este conductor.
     * El segundo concede MENOS —ver update()— pero es un camino de verdad: un
     * conductor tiene que poder corregir su propio teléfono sin llamar a nadie.
     *
     * @param  array<string, mixed>|null  $policy
     */
    private function mayEdit(PermissionChecker $checker, Actor $actor, Driver $driver, ?array $policy): bool
    {
        if ($checker->can($actor, 'driver:update', $this->context($driver), $policy)->allowed) {
            return true;
        }

        return $actor->driverId !== null
            && $actor->driverId === $driver->id
            && $checker->can($actor, 'driver:self:update', $this->context($driver), $policy)->allowed;
    }

    /**
     * La licencia es única por empresa y lo impone la base de datos
     * (`drivers_tenant_license_hash_uq`). Se comprueba aquí de todas formas
     * para poder decir DE QUIÉN es, en vez de dejar salir un error de clave
     * duplicada que no le dice nada a nadie.
     */
    private function guardDuplicateLicence(?string $licence, ?string $ignoreId): void
    {
        $hash = $licence === null ? null : SensitiveNumber::hash($licence);

        if ($hash === null) {
            return;
        }

        $existing = Driver::query()
            ->where('license_number_hash', $hash)
            ->when($ignoreId !== null, fn (Builder $q) => $q->whereKeyNot($ignoreId))
            ->first(['id', 'first_name', 'last_name']);

        if ($existing !== null) {
            throw ValidationException::withMessages([
                'license_number' => __('drivers.form.licenceTaken', [
                    'name' => trim("{$existing->first_name} {$existing->last_name}"),
                ]),
            ]);
        }
    }

    /**
     * @return Builder<Driver>
     */
    /**
     * El equipo elegido en el alta, si se eligió.
     *
     * Devuelve la clave del choque, o nada si se guardó (o si no se pidió). Las
     * reglas son las MISMAS que desde la ficha —un camión, un conductor— porque
     * es la misma tabla y el mismo `StandingAssignment` quien escribe: un alta
     * que se las saltara sería la puerta de atrás de una regla que no tiene red
     * debajo en la base.
     */
    private function equipoDelAlta(Request $request, Actor $actor, Driver $driver): ?string
    {
        $camion = $request->input('truck_id');

        if ($camion === null || $camion === '') {
            return null;
        }

        $choques = StandingAssignment::crear(
            (string) $actor->tenantId,
            (string) $driver->id,
            (string) $camion,
            $request->input('trailer_id') ?: null,
            CarbonImmutable::now()->toDateString(),
            null,
            $actor->userId,
        );

        return $choques[0] ?? null;
    }

    /**
     * El equipo habitual de este conductor: lo vigente, lo que viene y lo de antes.
     *
     * El historial se enseña entero y no se borra nunca: una carga de marzo se
     * mira con el camión que se llevó en marzo, y una fila borrada dejaría esa
     * carga sin explicación.
     *
     * ## Tres montones y no dos
     *
     * Había dos —vigente y «antes»— y una asignación que empieza el lunes que
     * viene caía en «antes», debajo de un título que dice que ya pasó. Lo que
     * no ha empezado no es historia, y la diferencia se nota en el botón: lo
     * vigente se termina, lo que viene se cancela.
     *
     * @return array{current: array<string, mixed>|null, upcoming: list<array<string, mixed>>, past: list<array<string, mixed>>}
     */
    private function equipoHabitual(Driver $conductor): array
    {
        $hoy = CarbonImmutable::now()->toDateString();

        $filas = DB::table('driver_equipment_assignments as a')
            ->leftJoin('trucks as t', 't.id', '=', 'a.truck_id')
            ->leftJoin('trailers as r', 'r.id', '=', 'a.trailer_id')
            ->where('a.tenant_id', $conductor->tenant_id)
            ->where('a.driver_id', $conductor->id)
            ->whereNull('a.deleted_at')
            ->orderByDesc('a.starts_on')
            ->limit(20)
            ->get([
                'a.id', 'a.truck_id', 'a.trailer_id', 'a.starts_on', 'a.ends_on', 'a.notes',
                't.unit_number as truck_unit', 'r.unit_number as trailer_unit',
            ]);

        $vigente = null;
        $vienen = [];
        $antes = [];

        foreach ($filas as $fila) {
            $inicio = substr((string) $fila->starts_on, 0, 10);
            $fin = $fila->ends_on === null ? null : substr((string) $fila->ends_on, 0, 10);

            $fila_ = [
                'id' => (string) $fila->id,
                'truckId' => (string) $fila->truck_id,
                'truck' => $fila->truck_unit === null ? null : (string) $fila->truck_unit,
                'trailerId' => $fila->trailer_id === null ? null : (string) $fila->trailer_id,
                'trailer' => $fila->trailer_unit === null ? null : (string) $fila->trailer_unit,
                'startsOn' => $inicio,
                'endsOn' => $fin,
                'notes' => $fila->notes,
            ];

            // Vigente es la que abarca HOY. La más reciente que lo cumpla, que
            // es la primera que se lee: vienen ordenadas de nueva a vieja.
            $abarca = $inicio <= $hoy && ($fin === null || $fin >= $hoy);

            if ($abarca && $vigente === null) {
                $vigente = $fila_;

                continue;
            }

            if ($inicio > $hoy) {
                $vienen[] = $fila_;

                continue;
            }

            $antes[] = $fila_;
        }

        // Las que vienen, de la más próxima a la más lejana: la consulta las
        // trae de nueva a vieja, que para lo que aún no ha pasado es del revés.
        $vienen = array_reverse($vienen);

        return ['current' => $vigente, 'upcoming' => $vienen, 'past' => $antes];
    }

    /**
     * Los camiones y remolques de la empresa, para elegir.
     *
     * Los de la empresa entera y no los del transportista del conductor: un
     * conductor puede trabajar para más de uno —`driver_carrier_relationships`
     * es una relación de varios— y recortar por el primero escondería la mitad
     * de la flota sin decirlo. Cada unidad viaja con SU transportista para que
     * la pantalla ofrezca las del que se acaba de marcar.
     *
     * **Los camiones que ya lleva OTRO conductor no se ofrecen.** La regla de
     * «un camión, un conductor a la vez» los rechazaría al guardar, y ofrecer
     * algo que se va a rechazar es hacer perder el viaje. Se dice cuántos hay
     * escondidos, porque un camión que falta de la lista sin explicación se
     * busca durante un rato.
     *
     * **Otro, y no cualquiera.** Escondía también el camión de ESTE conductor,
     * y hasta que se pudo corregir una asignación daba igual: en un alta el
     * suyo no es ninguno. Al abrir el formulario de corregir, la casilla del
     * camión nacía vacía —el valor estaba puesto y la lista no lo contenía— y
     * el campo es obligatorio: quien fuera a cambiar la nota tenía que volver
     * a elegir el camión, y el que le ofrecía la lista no era el suyo.
     *
     * Los remolques se ofrecen todos: en una flota se sueltan y se recogen, y
     * el mismo remolque pasa por varias manos sin que nadie mienta.
     *
     * @return array{trucks: list<array<string, string>>, trailers: list<array<string, string>>, takenTrucks: int}
     */
    private function unidadesParaElegir(Actor $actor, ?string $driverId = null): array
    {
        $ocupados = DB::table('driver_equipment_assignments')
            ->where('tenant_id', $actor->tenantId)
            ->whereNull('deleted_at')
            ->when($driverId !== null, fn ($q) => $q->where('driver_id', '!=', $driverId))
            ->whereDate('starts_on', '<=', CarbonImmutable::now()->toDateString())
            ->where(fn ($q) => $q->whereNull('ends_on')
                ->orWhereDate('ends_on', '>=', CarbonImmutable::now()->toDateString()))
            ->pluck('truck_id')
            ->map(fn ($v): string => (string) $v)
            ->all();

        $leer = fn (string $tabla, array $fuera): array => DB::table($tabla)
            ->where('tenant_id', $actor->tenantId)
            ->whereNull('deleted_at')
            ->when($fuera !== [], fn ($q) => $q->whereNotIn('id', $fuera))
            ->orderBy('unit_number')
            ->limit(500)
            ->get(['id', 'unit_number', 'make', 'model', 'carrier_id'])
            ->map(fn ($r): array => [
                'id' => (string) $r->id,
                'name' => trim((string) $r->unit_number.' '.trim((string) $r->make.' '.(string) $r->model)),
                'carrierId' => (string) $r->carrier_id,
            ])
            ->all();

        return [
            'trucks' => $leer('trucks', $ocupados),
            'trailers' => $leer('trailers', []),
            'takenTrucks' => count($ocupados),
        ];
    }

    private function scoped(PermissionChecker $checker, Actor $actor, Scope $scope): Builder
    {
        // El alcance vive en `Support\Drivers\DriverScope`, compartido con el
        // tablero de despacho: dos pantallas que enseñan conductores tienen que
        // alcanzar a los MISMOS.
        return DriverScope::apply(Driver::query(), $checker, $actor, $scope);
    }

    /**
     * @param  Builder<Driver>  $query
     * @param  array<string, string>  $filters
     */
    private function applyFilters(Builder $query, array $filters): void
    {
        if ($filters['search'] !== '') {
            $term = '%'.str_replace(['%', '_'], ['\%', '\_'], $filters['search']).'%';

            $query->where(function (Builder $q) use ($term, $filters): void {
                $q->where('first_name', 'like', $term)
                    ->orWhere('last_name', 'like', $term)
                    ->orWhere('email', 'like', $term)
                    ->orWhere('phone', 'like', $term)
                    // Buscar por los últimos cuatro de la licencia es lo que
                    // hace alguien con un papel delante. El número entero no se
                    // puede buscar: está cifrado, y así debe seguir.
                    ->orWhere('license_number_last4', 'like', '%'.$filters['search'].'%');
            });
        }

        if (in_array($filters['status'], DriverStatus::values(), true)) {
            $query->where('status', $filters['status']);
        }

        if ($filters['expiring'] === '1') {
            $limit = ExpiryWindow::limit();

            $query->where(function (Builder $q) use ($limit): void {
                $q->where('license_expires_at', '<=', $limit)
                    ->orWhere('medical_card_expires_at', '<=', $limit);
            });
        }
    }

    /**
     * @return array<string, int>
     */
    /**
     * @param  array<string, string>  $filters
     * @return array<string, int>
     */
    private function facets(PermissionChecker $checker, Actor $actor, Scope $scope, array $filters): array
    {
        return FacetCounts::fila(
            fn (array $f): Builder => tap(
                $this->scoped($checker, $actor, $scope),
                fn (Builder $q) => $this->applyFilters($q, $f),
            ),
            $filters,
            ['status', 'expiring'],
            'status',
            DriverStatus::values(),
            ['expiring' => ['expiring' => '1']],
        );
    }

    private function find(string $id): Driver
    {
        return Driver::query()->findOrFail($id);
    }

    private function context(Driver $driver): ResourceContext
    {
        // Compartido con la asignación de equipo, en `Drivers\DriverScope`:
        // dos sitios que piden permiso sobre el mismo conductor tienen que
        // pedirlo con el mismo contexto.
        return DriverScope::contexto($driver);
    }

    /**
     * Los avisos de vencimiento de una fila.
     *
     * @return array{license: string|null, medical: string|null}
     */
    private function expiries(Driver $d): array
    {
        $flag = static function ($date): ?string {
            if ($date === null) {
                return null;
            }

            return ExpiryWindow::flag($date);
        };

        return [
            'license' => $flag($d->license_expires_at),
            'medical' => $flag($d->medical_card_expires_at),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function row(Driver $d): array
    {
        return [
            'id' => $d->id,
            'name' => trim("{$d->first_name} {$d->last_name}"),
            'email' => $d->email,
            'phone' => $d->phone,
            'status' => EnumValue::of($d->status, 'available'),
            'verificationStatus' => EnumValue::of($d->verification_status, 'not_started'),
            'cdlClass' => $d->cdl_class,
            'licenseState' => $d->license_state,
            'twicCard' => (bool) $d->twic_card,
            'twicNumberLast4' => $d->twic_number_last4,
            // Los días, por el registro. Dos de estos ya salían con
            // `toDateString()` y dos con `toIso8601String()`, en el mismo
            // método: media docena de líneas más abajo la misma clase de dato
            // se mandaba de dos formas. Ver `App\Support\Time\CalendarDates`.
            'twicExpiresAt' => CalendarDates::dia($d->twic_expires_at),
            'twicVerifiedAt' => $d->twic_verified_at?->toIso8601String(),
            'workAuthorization' => EnumValue::of($d->work_authorization),
            'workAuthorizationVerifiedAt' => $d->work_authorization_verified_at?->toIso8601String(),
            'recordCleanYears' => $d->record_clean_years,
            'recordCheckedAt' => CalendarDates::dia($d->record_checked_at),
            'recordNotes' => $d->record_notes,
            'licenseCountry' => $d->license_country,
            // Solo los últimos cuatro. El número entero no sale de la base de
            // datos ni para el admin.
            'licenseLast4' => $d->license_number_last4,
            'licenseExpiresAt' => CalendarDates::dia($d->license_expires_at),
            'medicalCardExpiresAt' => CalendarDates::dia($d->medical_card_expires_at),
            'expiries' => $this->expiries($d),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function detail(Driver $d): array
    {
        $tenantId = $d->tenant_id === null ? null : (string) $d->tenant_id;
        $cuenta = $tenantId === null
            ? null
            : Consent::cuentaDe($tenantId, (string) $d->id);

        return [
            ...$this->row($d),
            'firstName' => $d->first_name,
            'lastName' => $d->last_name,
            'preferredLocale' => EnumValue::of($d->preferred_locale, 'en'),
            'endorsements' => $d->endorsements ?? [],
            'restrictions' => $d->restrictions ?? [],
            'verifiedAt' => $d->verified_at?->toIso8601String(),
            'verificationNotes' => $d->verification_notes,
            // Por qué está en su situación actual, y desde cuándo. Va en la
            // ficha y no solo en la pista de auditoría porque quien mira al
            // conductor tiene que poder leerlo sin irse a otra pantalla.
            'statusNote' => $d->status_note,
            'statusChangedAt' => $d->status_changed_at?->toIso8601String(),
            // Nulo es «no se ha dado de baja», no «no se sabe».
            'rehireEligible' => $d->rehire_eligible,
            // Lo que hay HOY, con la versión de texto de hoy: un consentimiento
            // sobre una redacción que ya cambió no cuenta, así que la fecha de
            // `drivers` sola mentiría en cuanto se subiera la versión. Ver
            // App\Support\Tracking\Consent.
            'trackingConsentAt' => Consent::vigente($tenantId, $cuenta)
                ? $d->tracking_consent_granted_at?->toIso8601String()
                : null,
            // Por la AFILIACIÓN y no por `drivers.user_id`: esa columna la
            // escribe el sembrador y nadie más, así que un conductor invitado
            // por el camino normal salía como «sin cuenta de acceso» teniéndola.
            // Otra frase falsa en pantalla, encontrada al construir la puerta
            // que depende de ella.
            'hasLogin' => $cuenta !== null,
            'notes' => $d->notes,
            'createdAt' => $d->created_at?->toIso8601String(),
        ];
    }

    /**
     * El conductor otorga o retira su consentimiento de rastreo.
     *
     * SOLO ÉL. `tracking:consent` es de ámbito propio y solo lo tiene el rol
     * `driver`; la comprobación de abajo no se apoya en eso y vuelve a exigir
     * que el conductor de la ficha sea quien está pidiendo. Dos cierres para lo
     * mismo a propósito: si mañana alguien concede el permiso a otro rol por
     * error, la ficha ajena sigue sin poder tocarse.
     *
     * Un despachador no puede marcarlo «porque el conductor lo dijo por
     * teléfono». Eso sería el despachador afirmando algo, no el conductor
     * consintiendo, y guardar lo segundo cuando pasó lo primero es la clase de
     * mentira que este lote existe para quitar.
     */
    public function consent(Request $request, string $driver, CurrentActor $current, PermissionChecker $checker): RedirectResponse
    {
        $actor = $current->require();
        $model = $this->find($driver);

        $checker->authorize($actor, 'tracking:consent', $this->context($model), $current->policy());

        // La ficha tiene que ser LA SUYA. `Actor::driverId` sale de su
        // afiliación, que es el vínculo que la aplicación mantiene.
        if ($actor->driverId === null || (string) $actor->driverId !== (string) $model->id) {
            return back()->with('error', __('tracking.consent.ownActionOnly'));
        }

        $data = $request->validate([
            'action' => ['required', 'string', 'in:grant,revoke'],
        ]);

        if ($data['action'] === 'grant') {
            Consent::otorgar($actor, $request);

            return back()->with('success', __('tracking.consent.grantSuccess'));
        }

        Consent::retirar($actor);

        return back()->with('success', __('tracking.consent.revokeSuccess'));
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function carriers(Driver $d, PermissionChecker $checker, Actor $actor, ?array $policy): array
    {
        return DB::table('driver_carrier_relationships as r')
            ->join('carriers as c', 'c.id', '=', 'r.carrier_id')
            ->where('r.driver_id', $d->id)
            ->whereNull('r.deleted_at')
            ->orderByDesc('r.is_primary')
            ->orderBy('c.legal_name')
            ->get(['c.id', 'c.legal_name', 'c.onboarding_status', 'r.is_primary', 'r.start_date', 'r.end_date'])
            ->map(fn ($r): array => [
                'id' => (string) $r->id,
                'name' => (string) $r->legal_name,
                // El conductor abre su propia ficha y no tiene `carrier:read`:
                // el nombre de su transportista era un enlace que le contestaba
                // «Acceso denegado». Ver `App\Support\Links\CrossLink`.
                'href' => CrossLink::para($checker, $actor, 'carrier', $r->id, $policy),
                'onboardingStatus' => (string) $r->onboarding_status,
                'isPrimary' => (bool) $r->is_primary,
                'startDate' => $r->start_date,
                'endDate' => $r->end_date,
            ])
            ->all();
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function recentLoads(Driver $d): array
    {
        return DB::table('loads as l')
            ->join('load_assignments as a', 'a.load_id', '=', 'l.id')
            ->where('a.driver_id', $d->id)
            ->whereNull('a.deleted_at')
            ->whereNull('l.deleted_at')
            ->orderByDesc('l.planned_pickup_at')
            ->limit(10)
            ->get(['l.id', 'l.load_number', 'l.status', 'l.commodity', 'l.planned_pickup_at'])
            ->map(fn ($l): array => [
                'id' => (string) $l->id,
                'loadNumber' => (string) $l->load_number,
                'status' => (string) $l->status,
                'commodity' => $l->commodity,
                'plannedPickupAt' => $l->planned_pickup_at,
            ])
            ->all();
    }

    /**
     * @return list<array{id: string, name: string}>
     */
    private function carrierChoices(Actor $actor): array
    {
        return DB::table('carriers')
            ->where('tenant_id', $actor->tenantId)
            ->whereNull('deleted_at')
            // Un usuario transportista solo puede atar conductores a SU empresa.
            ->when($actor->carrierId !== null, fn ($q) => $q->where('id', $actor->carrierId))
            ->orderBy('legal_name')
            ->get(['id', 'legal_name as name'])
            ->map(fn ($r): array => ['id' => (string) $r->id, 'name' => (string) $r->name])
            ->all();
    }

    /**
     * @param  list<string>  $carrierIds
     */
    private function syncCarriers(Driver $driver, array $carrierIds, Actor $actor): void
    {
        $valid = collect($this->carrierChoices($actor))->pluck('id');
        $wanted = collect($carrierIds)->filter(fn ($id) => $valid->contains($id))->unique()->values();

        // Las relaciones que ya no vienen se CIERRAN con fecha de fin, no se
        // borran: hay que poder decir quién conducía para quién en marzo, sobre
        // todo si hubo un siniestro.
        DB::table('driver_carrier_relationships')
            ->where('driver_id', $driver->id)
            ->whereNull('deleted_at')
            ->whereNull('end_date')
            ->when($wanted->isNotEmpty(), fn ($q) => $q->whereNotIn('carrier_id', $wanted->all()))
            ->update(['end_date' => now()->toDateString(), 'updated_at' => now()]);

        foreach ($wanted as $index => $carrierId) {
            $existing = DB::table('driver_carrier_relationships')
                ->where('driver_id', $driver->id)
                ->where('carrier_id', $carrierId)
                ->whereNull('deleted_at')
                ->first(['id']);

            if ($existing !== null) {
                DB::table('driver_carrier_relationships')->where('id', $existing->id)->update([
                    'end_date' => null,
                    'is_primary' => $index === 0,
                    'updated_at' => now(),
                ]);

                continue;
            }

            DB::table('driver_carrier_relationships')->insert([
                'id' => (string) Str::uuid(),
                'tenant_id' => $driver->tenant_id,
                'driver_id' => $driver->id,
                'carrier_id' => $carrierId,
                'is_primary' => $index === 0,
                'start_date' => now()->toDateString(),
                'approved_by_user_id' => $actor->auditUserId(),
                'approved_at' => now(),
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }
    }

    /**
     * Quién miró el papel, y cuándo.
     *
     * La plataforma NO consulta al TSA ni pide un MVR: alguien mira el
     * documento y deja constancia. Por eso el sello lo pone el guardado, con el
     * usuario que está guardando, y solo cuando el dato CAMBIA — si se
     * re-sellara en cada guardado, la fecha diría «hoy» para siempre y dejaría
     * de significar nada.
     *
     * @param  array<string, mixed>  $columns
     * @return array<string, mixed>
     */
    private function stampVerifications(Actor $actor, ?Driver $antes, array $columns): array
    {
        $ahora = now();
        $usuario = $actor->auditUserId();

        $cambia = static function (?Driver $d, array $campos, array $columns): bool {
            if ($d === null) {
                // Alta: se sella lo que venga con contenido, y nada más.
                foreach ($campos as $campo) {
                    $v = $columns[$campo] ?? null;

                    if ($v !== null && $v !== false && $v !== '') {
                        return true;
                    }
                }

                return false;
            }

            foreach ($campos as $campo) {
                $viejo = EnumValue::of($d->{$campo});
                $nuevo = EnumValue::of($columns[$campo] ?? null);

                if ($viejo !== $nuevo) {
                    return true;
                }
            }

            return false;
        };

        if ($cambia($antes, ['twic_card', 'twic_number_last4', 'twic_expires_at'], $columns)) {
            $columns['twic_verified_at'] = $ahora;
            $columns['twic_verified_by_user_id'] = $usuario;
        }

        if ($cambia($antes, ['work_authorization'], $columns)) {
            $columns['work_authorization_verified_at'] = $ahora;
            $columns['work_authorization_verified_by_user_id'] = $usuario;
        }

        if ($cambia($antes, ['record_clean_years', 'record_checked_at'], $columns)) {
            $columns['record_verified_by_user_id'] = $usuario;
        }

        return $columns;
    }

    /**
     * @param  array<string, mixed>  $data
     * @return array<string, mixed>
     */
    private function columns(array $data): array
    {
        $columns = [
            'first_name' => $data['first_name'],
            'last_name' => $data['last_name'],
            'email' => $data['email'] ?? null,
            'phone' => $data['phone'] ?? null,
            'preferred_locale' => $data['preferred_locale'] ?? 'en',
            'license_state' => $data['license_state'] ?? null,
            'license_country' => $data['license_country'] ?? Regions::DEFAULT_COUNTRY,
            'cdl_class' => $data['cdl_class'] ?? null,
            'endorsements' => $data['endorsements'] ?? [],
            'twic_card' => (bool) ($data['twic_card'] ?? false),
            'twic_number_last4' => ($data['twic_card'] ?? false) ? ($data['twic_number_last4'] ?? null) : null,
            'twic_expires_at' => ($data['twic_card'] ?? false) ? ($data['twic_expires_at'] ?? null) : null,
            'work_authorization' => $data['work_authorization'] ?? null,
            'record_clean_years' => $data['record_clean_years'] ?? null,
            'record_checked_at' => $data['record_checked_at'] ?? null,
            'record_notes' => $data['record_notes'] ?? null,
            'restrictions' => $data['restrictions'] ?? [],
            'license_expires_at' => $data['license_expires_at'] ?? null,
            'medical_card_expires_at' => $data['medical_card_expires_at'] ?? null,
            'status' => $data['status'] ?? 'available',
            'notes' => $data['notes'] ?? null,
        ];

        // Las tres columnas del número se escriben JUNTAS o ninguna. Escribir
        // solo el cifrado dejaría el índice ciego apuntando al número anterior,
        // y la detección de duplicados encontraría a la persona equivocada.
        //
        // Vacío significa «conserva el que ya está», no «bórralo». El formulario
        // NUNCA precarga el número —no se puede leer de vuelta— así que cada
        // edición de un teléfono lo enviaría vacío, y borrarlo destruiría la
        // licencia de un conductor por cambiarle el número de móvil.
        //
        // La cadena vacía se comprueba explícitamente aunque el middleware
        // ConvertEmptyStringsToNull de Laravel ya la convierta a null: eso es
        // configuración que alguien puede quitar, y aquí lo que está en juego
        // es un dato que no se puede recuperar.
        $licence = $data['license_number'] ?? null;

        if (is_string($licence) && trim($licence) !== '') {
            $parts = SensitiveNumber::columns($licence);

            $columns['license_number_encrypted'] = $parts['encrypted'];
            $columns['license_number_last4'] = $parts['last4'];
            $columns['license_number_hash'] = $parts['hash'];
        }

        return $columns;
    }

    /**
     * @return array<string, mixed>
     */
    private function validated(Request $request): array
    {
        return $request->validate([
            'first_name' => ['required', 'string', 'max:100'],
            'last_name' => ['required', 'string', 'max:100'],
            'email' => ['nullable', 'email:rfc', 'max:255'],
            'phone' => ['nullable', 'string', 'max:32'],
            'preferred_locale' => ['nullable', 'in:en,es'],
            'license_country' => ['nullable', 'string', Rule::in(Regions::countryCodes())],
            'license_state' => ['nullable', 'string', 'max:3', new SubdivisionOfCountry($request->input('license_country'))],
            // El número llega en claro por HTTPS y se cifra antes de tocar la
            // base. No se valida su forma: cada estado tiene la suya y una
            // expresión regular «inteligente» rechazaría licencias válidas.
            'license_number' => ['nullable', 'string', 'max:40'],
            'cdl_class' => ['nullable', Rule::in(Cdl::CLASES)],
            'endorsements' => ['array'],
            // Contra el VOCABULARIO, no contra una longitud. `max:4` admitía
            // cualquier cadena de cuatro caracteres: se guardaba `ZZ` y la
            // ficha pintaba una letra que no significa nada y que ningún
            // diccionario sabe nombrar.
            'endorsements.*' => [Rule::in(Cdl::ENDOSOS)],

            // Aptitud. Todo opcional: se puede dar de alta, verificar, asignar
            // y pagar a un conductor sin rellenar nada de esto.
            'twic_card' => ['boolean'],
            'twic_number_last4' => ['nullable', 'string', 'regex:/^[0-9]{4}$/'],
            'twic_expires_at' => ['nullable', 'date'],
            'work_authorization' => ['nullable', Rule::in(WorkAuthorization::values())],
            // Cero es «se miró y hay algo dentro del último año», que NO es lo
            // mismo que no rellenarlo, que es «no se ha mirado». 31 significa
            // «más de treinta».
            'record_clean_years' => ['nullable', 'integer', 'min:0', 'max:31'],
            'record_checked_at' => ['nullable', 'date'],
            'record_notes' => ['nullable', 'string', 'max:2000'],
            'restrictions' => ['array'],
            'restrictions.*' => [Rule::in(Cdl::RESTRICCIONES)],
            'license_expires_at' => ['nullable', 'date'],
            'medical_card_expires_at' => ['nullable', 'date'],
            'status' => ['nullable', 'in:available,on_load,off_duty,inactive'],
            'notes' => ['nullable', 'string', 'max:5000'],
            'carrier_ids' => ['array'],
            'carrier_ids.*' => ['string', 'size:36'],
        ]);
    }
}
