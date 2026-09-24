<?php

declare(strict_types=1);

namespace App\Http\Controllers\App;

use App\Authorization\Actor;
use App\Authorization\CurrentActor;
use App\Authorization\PermissionChecker;
use App\Authorization\ResourceContext;
use App\Enums\EquipmentOwnership;
use App\Enums\Scope;
use App\Enums\VendorType;
use App\Models\Trailer;
use App\Models\Truck;
use App\Models\Vendor;
use App\Rules\SubdivisionOfCountry;
use App\Services\Vin\VinDecoder;
use App\Support\Compliance\ExpiryWindow;
use App\Support\EnumValue;
use App\Support\Equipment\AxleSpacings;
use App\Support\Equipment\Eligibility;
use App\Support\Equipment\Measure;
use App\Support\Equipment\Media;
use App\Support\Equipment\UnitFacts;
use App\Support\Equipment\Verification;
use App\Support\Equipment\Vin;
use App\Support\Geo\Regions;
use App\Support\InertiaPage;
use App\Support\Links\CrossLink;
use App\Support\Lists\FacetCounts;
use App\Support\Plural;
use App\Support\Storage\DocumentStore;
use App\Support\Time\CalendarDates;
use Carbon\CarbonImmutable;
use Closure;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Inertia\Inertia;
use Inertia\Response;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

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
    /** Tope por foto. Una foto de móvil moderna ronda los 4 MB. */
    private const MAX_FOTO_KB = 15360;

    use InertiaPage;

    private const PER_PAGE = 25;

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
            'facets' => $this->facets($checker, $actor, $scope, $type, $filters),
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

        $this->usesDictionary($request, ['equipment', 'nav', 'validation']);

        return Inertia::render('App/Equipment/Show', [
            'type' => $type,
            'unit' => $this->detail($model, $type, $checker, $actor, $policy),
            'loads' => $checker->can($actor, 'load:read', null, $policy)->allowed
                ? $this->recentLoads($model, $type)
                : null,
            // Lo que impide que esta unidad vaya a una carga, HOY, con la misma
            // regla que usa la puerta. Si esta pantalla dijera otra cosa que la
            // asignación, volveríamos al defecto que este lote existe para
            // cerrar. Ver App\Support\Equipment\Eligibility.
            'blockingKeys' => Eligibility::reasons(UnitFacts::fromRow((object) [
                'unit_number' => $model->unit_number,
                'status' => $model->status->value,
                'next_inspection_due_at' => $model->next_inspection_due_at,
                'registration_expires_at' => $model->registration_expires_at,
            ], Media::missingAngles(
                (string) $actor->tenantId,
                $this->singular($type),
                (string) $model->id,
            ))),
            'media' => [
                'photos' => Media::forUnit((string) $actor->tenantId, $this->singular($type), (string) $model->id),
                'missingAngles' => Media::missingAngles((string) $actor->tenantId, $this->singular($type), (string) $model->id),
                'angles' => [...Media::ANGULOS, ...Media::OPCIONALES],
            ],
            'verification' => $this->verification($model, $type),
            'can' => [
                'update' => $checker->can($actor, 'equipment:update', $context, $policy)->allowed,
                'changeStatus' => $checker->can($actor, 'equipment:status:update', $context, $policy)->allowed,
                'override' => $checker->can($actor, 'equipment:verification:override', $context, $policy)->allowed,
                'uploadMedia' => $checker->can($actor, 'equipment:media:upload', $context, $policy)->allowed,
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
            'choices' => $this->choices($actor, $type),
        ]);
    }

    /**
     * Lo que un VIN dice de sí mismo, para el formulario.
     *
     * Lo pide la pantalla en cuanto el número está completo, y devuelve marca,
     * modelo y año — los que se sepan. Tres cosas que este método hace a
     * propósito:
     *
     *  - **Exige el permiso de dar de alta o editar.** Es una consulta barata,
     *    pero es una consulta a un servicio de fuera hecha con el servidor de
     *    la empresa: sin permiso, cualquiera con una sesión podría usarla de
     *    pasarela.
     *  - **No guarda nada.** Contesta y ya. Lo que se guarde lo decide la
     *    persona al enviar el formulario, no esta llamada.
     *  - **Nunca falla con error.** Un VIN que no se puede decodificar es una
     *    respuesta normal —`decoded: null`— y no un 422: el alta tiene que
     *    poder seguir escribiendo los campos a mano.
     */
    public function decodeVin(
        Request $request,
        string $type,
        string $vin,
        CurrentActor $current,
        PermissionChecker $checker,
        VinDecoder $decoder,
    ): JsonResponse {
        $this->assertType($type);

        $actor = $current->require();
        $policy = $current->policy();

        $puede = $checker->can($actor, 'equipment:create', null, $policy)->allowed
            || $checker->can($actor, 'equipment:update', null, $policy)->allowed;

        abort_unless($puede, 403);

        $normalizado = Vin::normalizar($vin);

        return response()->json([
            'vin' => $normalizado,
            'wellFormed' => Vin::tieneForma($normalizado),
            // El dígito de control se dice aparte: un VIN con la forma buena y
            // el dígito malo es casi siempre una errata al copiarlo, y merece
            // un aviso distinto de «esto no es un VIN».
            'checksumOk' => Vin::sumaBien($normalizado),
            'live' => $decoder->isLive(),
            'decoded' => $decoder->decode($normalizado)?->toArray(),
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

        $this->guardarEjes($type, (string) $actor->tenantId, (string) $model->id, $data);

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
            'unit' => $this->detail($model, $type, $checker, $actor, $current->policy()),
            'choices' => $this->choices($actor, $type),
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

        $this->guardarEjes($type, (string) $actor->tenantId, (string) $model->id, $data);

        return redirect()->route('equipment.show', [$type, $model->id])
            ->with('success', __('equipment.flash.updated', ['unit' => $model->unit_number]));
    }

    /**
     * Las distancias tal y como llegaron, con los huecos en blanco como nulos.
     *
     * Un mismo sitio para leerlas, porque la validación y el guardado tienen
     * que estar mirando exactamente la misma lista: si una contara los blancos
     * y la otra no, la comprobación aprobaría un conjunto que después se
     * guarda a medias.
     *
     * @param  array<string, mixed>  $data
     * @return list<int|null>
     */
    private static function distanciasDe(array $data): array
    {
        $salida = [];

        /** @var array<int, array<string, mixed>> $crudas */
        $crudas = $data['axle_spacings'] ?? [];

        foreach ($crudas as $fila) {
            $salida[] = Measure::aPulgadas(
                self::cifra($fila['feet'] ?? null),
                self::cifra($fila['inches'] ?? null),
            );
        }

        return $salida;
    }

    /** Una casilla en blanco es nula, no cero. */
    private static function cifra(mixed $valor): ?int
    {
        return $valor === null || $valor === '' ? null : (int) $valor;
    }

    /**
     * Guarda las distancias entre ejes, o no guarda ninguna.
     *
     * Enteras o nada: un conjunto con tres huecos de cuatro rellenos no sirve
     * para calcular nada, y dejarlo a medias es peor que dejarlo vacío porque
     * parece un dato. La validación de forma ya obligó a que sean enteros; lo
     * que se comprueba aquí es la relación con el número de ejes, que la
     * validación de un campo suelto no puede ver.
     *
     * @param  array<string, mixed>  $data
     */
    private function guardarEjes(string $type, string $tenantId, string $id, array $data): void
    {
        /** @var list<int> $distancias */
        $distancias = array_values(array_filter(
            self::distanciasDe($data),
            static fn (?int $v): bool => $v !== null,
        ));

        AxleSpacings::guardar(
            $tenantId,
            $type === 'trucks' ? AxleSpacings::CAMION : AxleSpacings::REMOLQUE,
            $id,
            $distancias,
        );
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

        // Poner una unidad EN SERVICIO exige que alguien la haya verificado.
        //
        // Sin esto, la puerta del lote 57 —`pending_verification` impide ponerla
        // en una carga— tenía una llave que era un desplegable: se cambiaba el
        // estado a «activa» y ya estaba, sin que constara qué se había mirado ni
        // quién lo dijo. Una puerta cuya llave la tiene cualquiera y no deja
        // rastro es decoración.
        //
        // Solo se exige al SUBIR. Una unidad que ya estaba activa antes de que
        // esto existiera no se cae de servicio sola: se le exige verificación la
        // próxima vez que alguien la mueva, no hoy y por sorpresa. Misma regla
        // de trato que los topes del plan del lote 56.
        if ($data['status'] === 'active'
            && $model->status->value !== 'active'
            && ! Verification::habilita((string) $actor->tenantId, $this->singular($type), (string) $model->id)) {
            throw ValidationException::withMessages([
                'status' => __('equipment.verification.requiredToActivate'),
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

    /**
     * Verificar la unidad contra el certificado de seguro del transportista.
     *
     * Dos acciones en una ruta porque son la misma decisión con dos salidas:
     * «lo he visto» y «no está, y aun así entra». La segunda pide permiso aparte
     * (`equipment:verification:override`) y motivo escrito — que es toda la
     * diferencia entre una excepción y un atajo.
     */
    public function verify(Request $request, string $type, string $unit, CurrentActor $current, PermissionChecker $checker): RedirectResponse
    {
        $this->assertType($type);

        $actor = $current->require();
        $model = $this->find($type, $unit);
        $contexto = $this->context($model);

        $data = $request->validate([
            'action' => ['required', 'string', 'in:confirm,override'],
            'reason' => ['nullable', 'string', 'max:2000'],
        ]);

        if ($data['action'] === 'override') {
            $checker->authorize($actor, 'equipment:verification:override', $contexto, $current->policy());

            $motivo = trim((string) ($data['reason'] ?? ''));

            if (mb_strlen($motivo) < 5) {
                throw ValidationException::withMessages([
                    'reason' => __('equipment.verification.reasonRequired'),
                ]);
            }

            Verification::anular(
                $actor,
                $this->singular($type),
                (string) $model->id,
                (string) $model->carrier_id,
                $motivo,
            );

            return back()->with('success', __('equipment.verification.overridden'));
        }

        // Confirmar es un acto de cumplimiento, no de edición: se pide el mismo
        // permiso que para poner la unidad en servicio, porque es lo que
        // habilita a ponerla.
        $checker->authorize($actor, 'equipment:status:update', $contexto, $current->policy());

        try {
            Verification::confirmar(
                $actor,
                $this->singular($type),
                (string) $model->id,
                (string) $model->carrier_id,
                (string) $model->vin,
            );
        } catch (\RuntimeException) {
            // Sin certificado vigente no hay nada contra lo que confirmar. Se
            // contesta con el motivo concreto —no hay ninguno, o el que hay está
            // vencido— porque son dos llamadas de teléfono distintas.
            $impedimentos = Verification::impedimentos((string) $actor->tenantId, (string) $model->carrier_id);

            throw ValidationException::withMessages([
                'action' => __('equipment.verification.'.($impedimentos[0] ?? Verification::SIN_SEGURO)),
            ]);
        }

        return back()->with('success', __('equipment.verification.confirmed'));
    }

    /**
     * Subir una foto de la unidad.
     *
     * El sitio público promete cuatro; se piden los cuatro LADOS. Ver
     * App\Support\Equipment\Media para por qué el mínimo es por ángulo y no un
     * número de ficheros.
     */
    public function storeMedia(
        Request $request,
        string $type,
        string $unit,
        CurrentActor $current,
        PermissionChecker $checker,
        DocumentStore $store,
    ): RedirectResponse {
        $this->assertType($type);

        $actor = $current->require();
        $model = $this->find($type, $unit);

        $checker->authorize($actor, 'equipment:media:upload', $this->context($model), $current->policy());

        $data = $request->validate([
            'angle' => ['required', 'string', Rule::in([...Media::ANGULOS, ...Media::OPCIONALES])],
            'caption' => ['nullable', 'string', 'max:200'],
            'file' => [
                'required',
                'file',
                'max:'.self::MAX_FOTO_KB,
                // Por MIME real y no por la extensión del nombre: `mimetypes:`
                // mira el contenido con finfo, no la cadena que mandó el
                // navegador. Mismo criterio que la subida de documentos.
                'mimetypes:image/jpeg,image/png,image/webp,image/heic',
            ],
        ]);

        Media::add(
            $store,
            (string) $actor->tenantId,
            $this->singular($type),
            (string) $model->id,
            $data['angle'],
            $request->file('file'),
            $data['caption'] ?? null,
            $actor->auditUserId(),
        );

        return back()->with('success', __('equipment.media.added'));
    }

    /**
     * Quitar una foto.
     *
     * Se marca como borrada y el fichero lo retira el barrido de huérfanos del
     * lote 53. Una foto que documenta el estado de un camión el día que salió es
     * exactamente el dato que alguien reclama nueve meses después.
     */
    /**
     * Enseña una foto del equipo.
     *
     * ## El defecto
     *
     * No existía. Había ruta para SUBIR una foto y ruta para BORRARLA, y
     * ninguna para verla: la ficha del camión pintaba «Frontal · 12/03/2026» y
     * un botón de quitar, y la foto no se podía abrir desde ningún sitio.
     *
     * Y esto no es una molestia de pantalla. Los cuatro ángulos son la puerta
     * de `Equipment\Eligibility` —sin ellos la unidad no se puede asignar— y la
     * página pública promete que «cada unidad documenta sus cuatro lados antes
     * de poder asignarse». Una foto que nadie puede mirar no documenta nada:
     * documenta que alguien subió un fichero de ese tamaño.
     *
     * Es el mismo defecto que los adjuntos de mensaje, en la segunda tabla del
     * inventario de ficheros. Lo encontró el guardián que este lote añade.
     *
     * ## Quién puede
     *
     * `equipment:read` con el contexto de la unidad, que es el mismo permiso
     * que abre la ficha donde la foto se anuncia. Pedir `media:upload` para
     * MIRARLA dejaría fuera justo a quien tiene que comprobarla.
     */
    public function showMedia(
        string $type,
        string $unit,
        string $media,
        CurrentActor $current,
        PermissionChecker $checker,
        DocumentStore $store,
    ): RedirectResponse {
        $this->assertType($type);

        $actor = $current->require();
        $model = $this->find($type, $unit);

        $checker->authorize($actor, 'equipment:read', $this->context($model), $current->policy());

        // Cruzada con SU unidad, no cogida por su id suelto: si no, el id de
        // una foto de otro camión emparejado con una ficha que sí se puede
        // abrir serviría el fichero.
        $fila = DB::table('equipment_media')
            ->where('tenant_id', $actor->tenantId)
            ->where('id', $media)
            ->where('equipment_type', $this->singular($type))
            ->where('equipment_id', $model->id)
            ->whereNull('deleted_at')
            ->first(['id', 'storage_key', 'angle', 'content_type']);

        if ($fila === null) {
            throw new NotFoundHttpException;
        }

        if (! $store->exists((string) $fila->storage_key)) {
            return back()->with('error', __('equipment.media.fileMissing'));
        }

        // `inline`: una foto se MIRA. Servirla como adjunto baja un fichero en
        // vez de enseñarla, y «ver la foto» que descarga algo con nombre
        // aleatorio no es ver la foto.
        //
        // El nombre lo arma el ángulo, que es lo que esa foto es. La tabla no
        // guarda el original a propósito —una foto de camión no se identifica
        // por cómo la llamó el móvil que la hizo— y «frente.jpg» dice más que
        // «IMG_20260914_093312.jpg».
        return redirect()->away($store->temporaryUrl(
            (string) $fila->storage_key,
            filename: $fila->angle.'.'.(pathinfo((string) $fila->storage_key, PATHINFO_EXTENSION) ?: 'jpg'),
            inline: true,
        ));
    }

    public function destroyMedia(
        Request $request,
        string $type,
        string $unit,
        string $media,
        CurrentActor $current,
        PermissionChecker $checker,
    ): RedirectResponse {
        $this->assertType($type);

        $actor = $current->require();
        $model = $this->find($type, $unit);

        $checker->authorize($actor, 'equipment:media:upload', $this->context($model), $current->policy());

        $data = $request->validate([
            'reason' => ['nullable', 'string', 'max:2000'],
        ]);

        Media::remove(
            (string) $actor->tenantId,
            $media,
            $actor->auditUserId(),
            trim((string) ($data['reason'] ?? '')),
        );

        return back()->with('success', __('equipment.media.removed'));
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
     * El estado de verificación de esta unidad, para la pantalla.
     *
     * @return array<string, mixed>
     */
    private function verification(Truck|Trailer $model, string $type): array
    {
        $tenantId = (string) $model->tenant_id;
        $ultima = Verification::ultima($tenantId, $this->singular($type), (string) $model->id);
        $coi = Verification::certificado($tenantId, (string) $model->carrier_id);

        $nombre = static function (?string $userId): ?string {
            if ($userId === null) {
                return null;
            }

            $u = DB::table('users')->where('id', $userId)->first(['first_name', 'last_name']);

            return $u === null ? null : trim($u->first_name.' '.$u->last_name);
        };

        return [
            'status' => $ultima === null ? null : (string) $ultima->status,
            'at' => $ultima === null
                ? null
                : substr((string) ($ultima->verified_at ?? $ultima->overridden_at ?? $ultima->created_at), 0, 10),
            'by' => $ultima === null ? null : $nombre($ultima->overridden_by_user_id),
            'reason' => $ultima === null ? null : $ultima->override_reason,
            // El certificado contra el que se puede mirar AHORA, con enlace: sin
            // él la pantalla pediría confirmar algo que no se puede consultar.
            'coiDocumentId' => $coi === null ? null : (string) $coi->id,
            'coiExpiresOn' => $coi === null || $coi->expiration_date === null
                ? null
                : substr((string) $coi->expiration_date, 0, 10),
            'obstacles' => Verification::impedimentos($tenantId, (string) $model->carrier_id),
        ];
    }

    /**
     * `trucks` → `truck`. La ruta habla en plural y `equipment_verifications`
     * en singular, con un CHECK que solo admite `truck` y `trailer`.
     */
    private function singular(string $type): string
    {
        return $type === 'trucks' ? 'truck' : 'trailer';
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
            $limit = ExpiryWindow::limit();

            $query->where(function (Builder $q) use ($limit): void {
                $q->where('next_inspection_due_at', '<=', $limit)
                    ->orWhere('registration_expires_at', '<=', $limit);
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
    private function facets(PermissionChecker $checker, Actor $actor, Scope $scope, string $type, array $filters): array
    {
        return FacetCounts::fila(
            fn (array $f): Builder => tap(
                $this->scoped($checker, $actor, $scope, $type),
                fn (Builder $q) => $this->applyFilters($q, $f),
            ),
            $filters,
            ['status', 'expiring'],
            'status',
            ['pending_verification', 'active', 'out_of_service', 'archived'],
            ['expiring' => ['expiring' => '1']],
        );
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
     * @param  Collection<int, Model>  $rows
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

            return ExpiryWindow::flag($date);
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
            'plateCountry' => $g('plate_country'),
            'status' => EnumValue::of($g('status'), 'pending_verification'),
            // Días, no instantes: los teclea una persona en un selector de
            // fecha y la matrícula de un camión vence un día, no a una hora.
            // Ver `App\Support\Time\CalendarDates`.
            'nextInspectionDueAt' => CalendarDates::dia($g('next_inspection_due_at')),
            'registrationExpiresAt' => CalendarDates::dia($g('registration_expires_at')),
            'expiries' => $this->expiries($u),
            'type' => $type,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function detail(Model $u, string $type, PermissionChecker $checker, Actor $actor, ?array $policy): array
    {
        $g = fn (string $c) => $u->getAttribute($c);

        $common = [
            ...$this->row($u, $this->carrierNames(collect([$u])), $type),
            // El nombre del transportista siempre; el enlace, solo si quien
            // mira puede abrir esa ficha. Un conductor tiene `equipment:read`
            // de alcance propio y no tiene `carrier:read`. Ver
            // `App\Support\Links\CrossLink`.
            'carrierHref' => CrossLink::para($checker, $actor, 'carrier', $g('carrier_id'), $policy),
            'equipmentTypeId' => $g('equipment_type_id'),
            'registrationNumber' => $g('registration_number'),
            'lastInspectionAt' => CalendarDates::dia($g('last_inspection_at')),
            'lastMaintenanceAt' => CalendarDates::dia($g('last_maintenance_at')),
            'nextMaintenanceDueAt' => CalendarDates::dia($g('next_maintenance_due_at')),
            'coiVerificationStatus' => EnumValue::of($g('coi_verification_status'), 'not_started'),
            'outOfServiceReason' => $g('out_of_service_reason'),
            'notes' => $g('notes'),
            'createdAt' => $this->iso($g('created_at')),
        ];

        $propiedad = [
            'ownership' => EnumValue::of($g('ownership'), EquipmentOwnership::Owned->value),
            'lessorName' => $g('lessor_name'),
            /*
             * La ficha del arrendador, si la unidad apunta a una.
             *
             * `lessorName` se queda al lado y no se borra: es lo único que hay
             * escrito en todas las unidades dadas de alta antes de que
             * existieran los proveedores. La pantalla enseña el nombre
             * tecleado diciendo que no tiene ficha, con el desplegable al lado
             * para enlazarlo. Borrarlo al ganar la columna nueva habría
             * tirado en silencio el único dato que existe sobre el arrendador
             * de cada unidad, a cambio de nada.
             */
            'lessorVendorId' => $g('lessor_vendor_id'),
            // Y su nombre, para poder enlazar la ficha sin que la pantalla
            // tenga que ir a buscarlo. Sale de la ficha DE VERDAD y no de
            // `lessor_name`: si los dos existen y no coinciden, el que manda
            // es el que está enlazado.
            'lessorVendorName' => $g('lessor_vendor_id') === null ? null : DB::table('vendors')
                ->where('id', $g('lessor_vendor_id'))
                ->whereNull('deleted_at')
                ->value('company_name'),
            'leaseEndsOn' => CalendarDates::dia($g('lease_ends_on')),
            // Las distancias entre ejes, en orden y en pulgadas. La pantalla
            // las parte en pies y pulgadas; la base guarda una sola cifra.
            'axleSpacings' => AxleSpacings::de(
                $type === 'trucks' ? AxleSpacings::CAMION : AxleSpacings::REMOLQUE,
                (string) $u->getAttribute('id'),
            ),
        ];

        if ($type === 'trucks') {
            return [
                ...$common,
                ...$propiedad,
                'lengthInches' => $g('length_inches') === null ? null : (int) $g('length_inches'),
                'widthInches' => $g('width_inches') === null ? null : (int) $g('width_inches'),
                'heightInches' => $g('height_inches') === null ? null : (int) $g('height_inches'),
                'axleCount' => $g('axle_count') === null ? null : (int) $g('axle_count'),
                'axleConfiguration' => $g('axle_configuration'),
            ];
        }

        return [
            ...$common,
            ...$propiedad,
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
    /**
     * @param  'trucks'|'trailers'|null  $type  Null solo para comprobar el
     *                                          transportista, donde el tipo de
     *                                          equipo no pinta nada.
     * @return array<string, mixed>
     */
    /**
     * Los transportistas para los que quien mira puede dar de alta equipo.
     *
     * Aparte de `choices()` porque la validación lo necesita SIN saber de qué
     * clase es la unidad, y mientras eso era un argumento opcional de
     * `choices()` la lista de tipos podía salir sin filtrar por categoría con
     * solo olvidarse de pasarlo.
     *
     * @return list<array{id: string, name: string}>
     */
    private function carrierOptions(Actor $actor): array
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

    private function choices(Actor $actor, string $type): array
    {
        return [
            'carriers' => $this->carrierOptions($actor),

            // Los tipos de ESTA clase de unidad, no todos.
            //
            // El formulario recibía los nueve y el de un tractor ofrecía
            // «Lowboy» y «Step deck», que son remolques. La columna `category`
            // existía desde el principio y nadie la miraba: elegir un tipo
            // imposible guardaba una ficha que después no cuadra con nada — y
            // la pantalla de sobredimensión mira el tipo del REMOLQUE.
            'equipmentTypes' => DB::table('equipment_types')
                ->where('tenant_id', $actor->tenantId)
                ->whereNull('deleted_at')
                ->where('category', $type === 'trucks' ? 'truck' : 'trailer')
                ->orderBy('sort_order')
                ->get(['id', 'code', 'label_en', 'label_es'])
                ->map(fn ($r): array => [
                    'id' => (string) $r->id,
                    'code' => (string) $r->code,
                    'labelEn' => (string) $r->label_en,
                    'labelEs' => (string) $r->label_es,
                ])
                ->all(),

            /*
             * Los arrendadores entre los que elegir.
             *
             * Solo los proveedores de tipo `leasing` y activos: ofrecer un
             * taller como arrendador de un camión es ofrecer un dato que
             * después nadie sabe leer. Si falta el que hace falta, se da de
             * alta en Finanzas → Proveedores; esta pantalla no crea fichas de
             * proveedor, porque entonces habría dos sitios donde nacen y el
             * segundo se quedaría sin los contactos y sin el W-9.
             */
            'lessors' => DB::table('vendors')
                ->where('tenant_id', $actor->tenantId)
                ->whereNull('deleted_at')
                ->where('vendor_type', VendorType::Leasing->value)
                ->where('status', 'active')
                ->orderBy('company_name')
                ->get(['id', 'company_name as name'])
                ->map(fn ($r): array => ['id' => (string) $r->id, 'name' => (string) $r->name])
                ->all(),
        ];
    }

    /**
     * Qué medidas tiene cada clase de unidad.
     *
     * En un solo sitio: la validación, el formulario y el guardián preguntan
     * aquí. Escrita tres veces, el día que se añada una medida se añadiría en
     * dos — y la tercera la dejaría pasar sin validar.
     *
     * @return list<string>
     */
    public static function medidasDe(string $type): array
    {
        return $type === 'trucks'
            ? ['length', 'width', 'height']
            : ['length', 'width', 'deck_height', 'well_length'];
    }

    /**
     * @param  array<string, mixed>  $data
     * @return array<string, mixed>
     */
    private function columns(array $data, string $type): array
    {
        // Una sola lectura de la propiedad, porque la columna y las dos que
        // dependen de ella tienen que estar mirando el MISMO valor. Leerla tres
        // veces con tres valores por omisión distintos guardaba «propia» con
        // arrendador puesto cuando el campo no venía.
        $propiedad = $data['ownership'] ?? EquipmentOwnership::Owned->value;
        $esPropia = $propiedad === EquipmentOwnership::Owned->value;

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
            'plate_country' => $data['plate_country'] ?? Regions::DEFAULT_COUNTRY,
            'registration_number' => $data['registration_number'] ?? null,
            'registration_expires_at' => $data['registration_expires_at'] ?? null,
            'last_inspection_at' => $data['last_inspection_at'] ?? null,
            'next_inspection_due_at' => $data['next_inspection_due_at'] ?? null,
            'notes' => $data['notes'] ?? null,
            'ownership' => $propiedad,
            // Solo si de verdad está arrendada. Guardar el nombre del
            // arrendador de una unidad propia deja un dato que contradice al
            // de al lado, y quien lo lea después no sabrá cuál vale.
            'lessor_name' => $esPropia ? null : ($data['lessor_name'] ?? null),
            'lessor_vendor_id' => $esPropia ? null : ($data['lessor_vendor_id'] ?? null),
            'lease_ends_on' => $esPropia ? null : ($data['lease_ends_on'] ?? null),
        ];

        if ($type === 'trucks') {
            $columns += [
                'length_inches' => Measure::aPulgadas($data['length_feet'] ?? null, $data['length_inches'] ?? null),
                'width_inches' => Measure::aPulgadas($data['width_feet'] ?? null, $data['width_inches'] ?? null),
                'height_inches' => Measure::aPulgadas($data['height_feet'] ?? null, $data['height_inches'] ?? null),
                'axle_count' => $data['axle_count'] ?? null,
                'axle_configuration' => $data['axle_configuration'] ?? null,
            ];
        }

        if ($type === 'trailers') {
            $columns += [
                // Igual que en los tractores: la pantalla las pide en pies y
                // pulgadas y aquí se juntan en una sola cifra. Ver
                // `Equipment\Measure` para por qué no son dos columnas.
                'length_inches' => Measure::aPulgadas($data['length_feet'] ?? null, $data['length_inches'] ?? null),
                'width_inches' => Measure::aPulgadas($data['width_feet'] ?? null, $data['width_inches'] ?? null),
                'deck_height_inches' => Measure::aPulgadas($data['deck_height_feet'] ?? null, $data['deck_height_inches'] ?? null),
                'well_length_inches' => Measure::aPulgadas($data['well_length_feet'] ?? null, $data['well_length_inches'] ?? null),
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
            'plate_country' => ['nullable', 'string', Rule::in(Regions::countryCodes())],
            'plate_state' => ['nullable', 'string', 'max:3', new SubdivisionOfCountry($request->input('plate_country'))],
            'registration_number' => ['nullable', 'string', 'max:60'],
            'registration_expires_at' => ['nullable', 'date'],
            'last_inspection_at' => ['nullable', 'date'],
            'next_inspection_due_at' => ['nullable', 'date'],
            'status' => ['nullable', 'in:pending_verification,active,out_of_service,archived'],
            'notes' => ['nullable', 'string', 'max:5000'],
            'ownership' => ['nullable', Rule::in(EquipmentOwnership::values())],
            'lessor_name' => ['nullable', 'string', 'max:160'],
            /*
             * Y que sea un proveedor DE ESTA EMPRESA.
             *
             * `size:36` deja pasar el identificador de un proveedor de otra
             * empresa: el ámbito global impide LEERLO, no impide escribirlo
             * aquí. Sin esta comprobación, la ficha de la unidad enseñaría el
             * nombre de una empresa ajena en cuanto alguien lo pegara en la
             * petición. Es la misma comprobación que hace el alta de carga con
             * el sitio del cliente.
             */
            'lessor_vendor_id' => ['nullable', 'uuid', function (string $attribute, mixed $value, Closure $fail): void {
                if ($value === null || $value === '') {
                    return;
                }

                $existe = Vendor::query()->whereKey($value)->exists();

                if (! $existe) {
                    $fail(__('equipment.form.lessorNotFound'));
                }
            }],
            'lease_ends_on' => ['nullable', 'date'],
            'axle_count' => ['nullable', 'integer', 'min:1', 'max:20'],
            'axle_configuration' => ['nullable', 'string', 'max:60'],
            // Las distancias entre ejes, en orden y cada una en pies y
            // pulgadas como el resto de las medidas. El tope de 19 es el de
            // `axle_count` menos uno.
            'axle_spacings' => ['nullable', 'array', 'max:19'],
            'axle_spacings.*' => ['array'],
            // Las dos casillas en blanco son un hueco sin medir, y caben: una
            // ficha vieja tiene ejes y no tiene distancias.
            'axle_spacings.*.feet' => ['nullable', 'integer', 'min:0', 'max:100'],
            'axle_spacings.*.inches' => ['nullable', 'integer', 'min:0', 'max:'.(Measure::PULGADAS_POR_PIE - 1)],
        ];

        // Los pies van aparte de las pulgadas en TODAS las medidas, y se juntan
        // en `columns()`. Las pulgadas se limitan a once: doce pulgadas son un
        // pie, y admitirlas dejaría dos formas de escribir la misma medida.
        foreach (self::medidasDe($type) as $medida) {
            $rules[$medida.'_feet'] = ['nullable', 'integer', 'min:0', 'max:200'];
            $rules[$medida.'_inches'] = ['nullable', 'integer', 'min:0', 'max:'.(Measure::PULGADAS_POR_PIE - 1)];
        }

        if ($type === 'trailers') {
            $rules += [
                'capacity_pounds' => ['nullable', 'integer', 'min:0', 'max:500000'],
                'removable_gooseneck' => ['boolean'],
                'is_extendable' => ['boolean'],
            ];
        }

        $data = $request->validate($rules);

        // Las distancias tienen que ser n-1 para n ejes. Es una relación entre
        // DOS campos, y por eso no cabe en la regla de ninguno de los dos.
        $ejes = $data['axle_count'] ?? null;
        $distancias = self::distanciasDe($data);

        // Un hueco de cero pulgadas no existe. Se escribe cuando alguien pone
        // un cero en las dos casillas creyendo que así lo deja en blanco, y
        // guardarlo daría una distancia que ninguna fórmula puede usar.
        foreach ($distancias as $i => $pulgadas) {
            if ($pulgadas !== null && $pulgadas < 1) {
                throw ValidationException::withMessages([
                    'axle_spacings.'.$i.'.inches' => __('equipment.form.axleSpacingZero'),
                ]);
            }
        }

        if (! AxleSpacings::cuadran($ejes === null ? null : (int) $ejes, $distancias)) {
            $esperadas = max(0, (int) ($ejes ?? 0) - 1);

            // Sin ejes suficientes no hay ningún hueco que pedir, y el mensaje
            // que toca no es «faltan 0 distancias» sino el que dice por dónde
            // se empieza. Y con uno solo, la frase va en singular: durante seis
            // lotes esta aplicación decía «1 facturas». Ver `Support\Plural`.
            throw ValidationException::withMessages([
                'axle_spacings' => $esperadas === 0
                    ? __('equipment.form.axleSpacingsNeedCount')
                    : __(Plural::key('equipment.form.axleSpacingsMismatch', $esperadas), [
                        'axles' => (string) ($ejes ?? 0),
                        'n' => (string) $esperadas,
                    ]),
            ]);
        }

        // El transportista tiene que ser de esta empresa, y si quien edita es un
        // usuario transportista, tiene que ser el suyo. La validación de formato
        // no lo garantiza.
        $allowed = collect($this->carrierOptions($actor))->pluck('id');

        if (! $allowed->contains($data['carrier_id'])) {
            throw ValidationException::withMessages([
                'carrier_id' => __('equipment.form.carrierNotAllowed'),
            ]);
        }

        return $data;
    }
}
