<?php

declare(strict_types=1);

namespace App\Http\Controllers\App;

use App\Authorization\Actor;
use App\Authorization\CurrentActor;
use App\Authorization\PermissionChecker;
use App\Enums\Scope;
use App\Models\Load;
use App\Support\EnumValue;
use App\Support\Geo\Regions;
use App\Support\InertiaPage;
use App\Support\Loads\LoadScope;
use App\Support\Oversize\Evaluator;
use App\Support\Documents\Attachment;
use App\Support\Oversize\Papers;
use App\Support\Storage\DocumentStore;
use App\Support\Oversize\Rules;
use App\Support\Plural;
use App\Support\Routing\RouteProvider;
use App\Support\Routing\Routes;
use Carbon\CarbonImmutable;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\URL;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Inertia\Inertia;
use Inertia\Response;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * Permisos, escoltas y la evaluación de sobredimensión de una carga.
 *
 * Seis tablas del esquema llevaban vacías desde el primer día —`routes`,
 * `route_states`, `oversize_rules`, `oversize_evaluations`, `permits`,
 * `escorts`— y `loads` tenía cuatro columnas esperándolas:
 * `permit_ready_approved_at`, `oversize_validated_at` y sus dos usuarios.
 *
 * LO QUE ESTE MÓDULO AFIRMA Y LO QUE NO. Afirma que ha comparado las medidas de
 * la carga con unos límites que están escritos en la base de datos de la
 * empresa, y enseña estado por estado qué se excede y por cuánto. NO afirma que
 * haga falta un permiso, ni que no haga falta: las columnas se llaman
 * `permit_likely_required` y `escort_likely_required` en el propio esquema, y la
 * evaluación nace en `pending` porque una persona tiene que firmarla.
 *
 * No es prudencia de más. Al cálculo le faltan cosas que no puede tener: los
 * estados de paso mientras no haya proveedor de rutas, las restricciones
 * horarias y de fin de semana, los puentes, las obras, y las excepciones que
 * cada estado publica y que no caben en cinco números. Un programa que dijera
 * «no hace falta permiso» con esa información sería peor que uno que no dijera
 * nada, porque el que no dice nada no da tranquilidad.
 */
final class PermitController
{
    use InertiaPage;

    /** @var list<string> */
    /**
     * Cuánto puede pesar un papel.
     *
     * Un permiso estatal escaneado son dos o tres megabytes; veinte deja sitio
     * de sobra y sigue frenando a quien suba un vídeo por error.
     */
    private const PAPEL_MAX_KB = 20480;

    private const ESTADOS_PERMISO = ['pending', 'requested', 'issued', 'expired', 'rejected', 'not_required'];

    /** @var list<string> */
    private const ESTADOS_ESCOLTA = ['pending', 'confirmed', 'completed', 'cancelled', 'not_required'];

    /** @var list<string> */
    private const TIPOS_ESCOLTA = ['pilot_car', 'police', 'height_pole', 'route_survey'];

    /** El índice: las cargas que necesitan atención de permisos. */
    public function index(Request $request, CurrentActor $current, PermissionChecker $checker): Response
    {
        $actor = $current->require();
        $policy = $current->policy();
        $scope = $checker->authorize($actor, 'permit:read', null, $policy);

        $this->usesDictionary($request, ['oversize', 'loads', 'nav', 'common', 'validation']);

        $cargas = LoadScope::apply(Load::query(), $checker, $actor, $scope)
            ->where(function ($q): void {
                $q->where('loads.is_oversize', 1)->orWhere('loads.is_overweight', 1);
            })
            ->whereNull('loads.deleted_at')
            ->orderByDesc('loads.created_at')
            ->limit(200)
            ->get(['loads.id', 'loads.load_number', 'loads.status', 'loads.is_oversize', 'loads.is_overweight', 'loads.permit_ready_approved_at', 'loads.oversize_validated_at']);

        $ids = $cargas->pluck('id')->all();

        $permisos = $ids === [] ? collect() : DB::table('permits')
            ->where('tenant_id', $actor->tenantId)
            ->whereIn('load_id', $ids)
            ->whereNull('deleted_at')
            ->selectRaw('load_id, status, count(*) as total')
            ->groupBy('load_id', 'status')
            ->get();

        return Inertia::render('App/Permits/Index', [
            'loads' => $cargas->map(function (Load $l) use ($permisos): array {
                $mios = $permisos->where('load_id', (string) $l->id);

                return [
                    'id' => (string) $l->id,
                    'number' => (string) $l->load_number,
                    'status' => EnumValue::of($l->status),
                    'isOversize' => (bool) $l->is_oversize,
                    'isOverweight' => (bool) $l->is_overweight,
                    'permitsIssued' => (int) $mios->where('status', 'issued')->sum('total'),
                    'permitsPending' => (int) $mios->whereIn('status', ['pending', 'requested'])->sum('total'),
                    'oversizeValidatedAt' => $this->minute($l->oversize_validated_at),
                    'permitReadyAt' => $this->minute($l->permit_ready_approved_at),
                ];
            })->all(),
            'can' => [
                'manage' => $checker->can($actor, 'permit:manage', null, $policy)->allowed,
                'rules' => $checker->can($actor, 'oversize:rule:manage', null, $policy)->allowed,
            ],
        ]);
    }

    /** El detalle de una carga: evaluación, permisos y escoltas. */
    public function show(Request $request, string $load, CurrentActor $current, PermissionChecker $checker): Response
    {
        $actor = $current->require();
        $policy = $current->policy();
        $scope = $checker->authorize($actor, 'permit:read', null, $policy);

        $this->usesDictionary($request, ['oversize', 'loads', 'nav', 'common', 'validation']);

        $carga = $this->findLoad($actor, $checker, $scope, $load);

        $evaluacion = Evaluator::latest((string) $actor->tenantId, (string) $carga->id);
        $ruta = Routes::current((string) $actor->tenantId, (string) $carga->id);

        return Inertia::render('App/Permits/Show', [
            'load' => [
                'id' => (string) $carga->id,
                'number' => (string) $carga->load_number,
                'status' => EnumValue::of($carga->status),
                'widthInches' => $carga->width_inches,
                'heightInches' => $carga->height_inches,
                'lengthInches' => $carga->length_inches,
                'weightPounds' => $carga->weight_pounds,
                'grossWeightPounds' => $carga->gross_vehicle_weight_pounds,
                'axleConfiguration' => $carga->axle_configuration,
                'isOversize' => (bool) $carga->is_oversize,
                'isOverweight' => (bool) $carga->is_overweight,
                'oversizeValidatedAt' => $this->minute($carga->oversize_validated_at),
                'permitReadyAt' => $this->minute($carga->permit_ready_approved_at),
            ],
            'route' => $ruta === null ? null : [
                'provider' => (string) $ruta->provider,
                'calculatedAt' => $this->minute($ruta->calculated_at),
                'totalMiles' => $ruta->total_miles,
                'states' => array_map(static fn (object $e): array => [
                    'state' => (string) $e->state_code,
                    'milesInState' => $e->miles_in_state,
                ], $ruta->states),
            ],
            'evaluation' => $evaluacion === null ? null : [
                'id' => (string) $evaluacion->id,
                'outcome' => (string) $evaluacion->outcome,
                'permitLikely' => (bool) $evaluacion->permit_likely_required,
                'escortLikely' => (bool) $evaluacion->escort_likely_required,
                'policeEscortLikely' => (bool) $evaluacion->police_escort_likely_required,
                'inputs' => json_decode((string) $evaluacion->inputs, true) ?: [],
                'stateResults' => json_decode((string) $evaluacion->state_results, true) ?: [],
                'warnings' => json_decode((string) $evaluacion->missing_data_warnings, true) ?: [],
                'validationStatus' => (string) $evaluacion->human_validation_status,
                'validationNotes' => $evaluacion->validation_notes,
                'validatedAt' => $this->minute($evaluacion->validated_at),
                'evaluatedAt' => $this->minute($evaluacion->evaluated_at),
            ],
            'permits' => DB::table('permits')
                ->where('tenant_id', $actor->tenantId)
                ->where('load_id', $carga->id)
                ->whereNull('deleted_at')
                ->orderBy('state_code')
                ->get()
                ->map(fn (object $p): array => [
                    'id' => (string) $p->id,
                    // Si los papeles están, no CUÁLES son: la pantalla solo
                    // necesita saber si hay que subir algo, y el documento se
                    // pide por su ruta con un enlace firmado.
                    'hasDocument' => $p->document_id !== null,
                    'hasRouteSurvey' => $p->route_survey_document_id !== null,
                    'state' => (string) $p->state_code,
                    'number' => $p->permit_number,
                    'type' => $p->permit_type,
                    'status' => (string) $p->status,
                    'issuedAt' => $this->minute($p->issued_at),
                    'expiresAt' => $this->minute($p->expires_at),
                    'costCents' => (int) $p->cost_cents,
                    'notes' => $p->notes,
                ])->all(),
            'escorts' => DB::table('escorts')
                ->where('tenant_id', $actor->tenantId)
                ->where('load_id', $carga->id)
                ->whereNull('deleted_at')
                ->orderBy('created_at')
                ->get()
                ->map(fn (object $e): array => [
                    'id' => (string) $e->id,
                    'hasDocument' => $e->document_id !== null,
                    'type' => (string) $e->escort_type,
                    'state' => $e->state_code,
                    'provider' => $e->provider_name,
                    'contactName' => $e->contact_name,
                    'contactPhone' => $e->contact_phone,
                    'agency' => $e->agency_name,
                    'scheduledFor' => $this->minute($e->scheduled_for),
                    'status' => (string) $e->status,
                    'costCents' => (int) $e->cost_cents,
                    'notes' => $e->notes,
                ])->all(),
            'options' => [
                'states' => Regions::subdivisionCodes('US'),
                'permitStatuses' => self::ESTADOS_PERMISO,
                'escortStatuses' => self::ESTADOS_ESCOLTA,
                'escortTypes' => self::TIPOS_ESCOLTA,
            ],
            'can' => [
                'evaluate' => $checker->can($actor, 'oversize:evaluate', null, $policy)->allowed,
                'validate' => $checker->can($actor, 'oversize:validate', null, $policy)->allowed,
                'manage' => $checker->can($actor, 'permit:manage', null, $policy)->allowed,
                'approveReady' => $checker->can($actor, 'permit:approve_ready', null, $policy)->allowed,
            ],
        ]);
    }

    /** Calcula el recorrido y evalúa. */
    public function evaluate(Request $request, string $load, CurrentActor $current, PermissionChecker $checker, RouteProvider $provider): RedirectResponse
    {
        $actor = $current->require();
        $policy = $current->policy();
        $scope = $checker->authorize($actor, 'oversize:evaluate', null, $policy);

        $datos = $request->validate([
            // No se guarda en la carga: depende de cómo se cargue el remolque
            // ese día, no de la mercancía. Lo dice el diccionario portado.
            'axle_weight_pounds' => ['nullable', 'integer', 'min:0', 'max:200000'],
        ]);

        $carga = $this->findLoad($actor, $checker, $scope, $load);

        // Las reglas se siembran al primer uso y no en el alta de la empresa:
        // una casa que nunca mueve cargas anchas no necesita cincuenta filas.
        Rules::install((string) $actor->tenantId, app()->getLocale());

        $paradas = DB::table('load_stops as s')
            ->leftJoin('customer_locations as cl', 'cl.id', '=', 's.customer_location_id')
            ->where('s.tenant_id', $actor->tenantId)
            ->where('s.load_id', $carga->id)
            ->whereNull('s.deleted_at')
            ->orderBy('s.sequence')
            ->get(['s.sequence', 's.city', 's.state', 'cl.city as location_city', 'cl.state as location_state'])
            ->map(static fn (object $s): array => [
                'sequence' => (int) $s->sequence,
                'city' => $s->location_city ?? $s->city,
                'state' => $s->location_state ?? $s->state,
            ])
            ->all();

        $ruta = Routes::calculate((string) $actor->tenantId, (string) $carga->id, $paradas, $provider);

        Evaluator::evaluate(
            carga: $carga,
            reglas: Rules::forTenant((string) $actor->tenantId),
            estados: $ruta['states'],
            avisosDeRuta: $ruta['warnings'],
            routeId: $ruta['routeId'],
            axleWeightPounds: $datos['axle_weight_pounds'] ?? null,
        );

        return back()->with('success', __('oversize.evaluation.done'));
    }

    /** Una persona firma la evaluación. */
    public function validateEvaluation(Request $request, string $load, CurrentActor $current, PermissionChecker $checker): RedirectResponse
    {
        $actor = $current->require();
        $policy = $current->policy();
        $scope = $checker->authorize($actor, 'oversize:validate', null, $policy);

        $datos = $request->validate([
            'status' => ['required', Rule::in([Evaluator::VALIDADA, Evaluator::RECHAZADA])],
            'notes' => ['nullable', 'string', 'max:2000', 'required_if:status,'.Evaluator::RECHAZADA],
        ]);

        $carga = $this->findLoad($actor, $checker, $scope, $load);
        $evaluacion = Evaluator::latest((string) $actor->tenantId, (string) $carga->id);

        if ($evaluacion === null) {
            return back()->with('error', __('oversize.evaluation.noEvaluationYet'));
        }

        $usuarioId = $actor->auditUserId();

        if ($usuarioId === null) {
            return back()->with('error', __('oversize.evaluation.needsUser'));
        }

        Evaluator::validate(
            (string) $actor->tenantId,
            (string) $evaluacion->id,
            $datos['status'],
            $datos['notes'] ?? null,
            $usuarioId,
        );

        // `loads.oversize_validated_at` es la columna que llevaba desde el
        // principio esperando esto. Solo se pone al VALIDAR: un rechazo la
        // limpia, porque una carga cuya evaluación se rechazó no está validada.
        DB::table('loads')->where('id', $carga->id)->update([
            'oversize_validated_by_user_id' => $datos['status'] === Evaluator::VALIDADA ? $usuarioId : null,
            'oversize_validated_at' => $datos['status'] === Evaluator::VALIDADA ? CarbonImmutable::now() : null,
            'updated_at' => CarbonImmutable::now(),
        ]);

        return back()->with('success', __('oversize.validation.submitted'));
    }

    /**
     * La compuerta: esta carga está lista de permisos y puede despacharse.
     *
     * Es un permiso aparte (`permit:approve_ready`) y no el de gestionar
     * permisos, y por eso mismo: quien tramita los papeles y quien firma que
     * están todos pueden ser la misma persona, pero la casa debe poder decidir
     * que no lo sean.
     */
    public function approveReady(Request $request, string $load, CurrentActor $current, PermissionChecker $checker): RedirectResponse
    {
        $actor = $current->require();
        $policy = $current->policy();
        $scope = $checker->authorize($actor, 'permit:approve_ready', null, $policy);

        $carga = $this->findLoad($actor, $checker, $scope, $load);

        $evaluacion = Evaluator::latest((string) $actor->tenantId, (string) $carga->id);

        // No se aprueba lo que nadie ha mirado. La evaluación firmada es el
        // requisito, y el esquema lo dice: «Admin sign-off, required before
        // dispatch».
        if ($evaluacion === null || (string) $evaluacion->human_validation_status !== Evaluator::VALIDADA) {
            return back()->with('error', __('oversize.readiness.needsValidation'));
        }

        $pendientes = DB::table('permits')
            ->where('tenant_id', $actor->tenantId)
            ->where('load_id', $carga->id)
            ->whereNull('deleted_at')
            ->whereIn('status', ['pending', 'requested', 'expired', 'rejected'])
            ->count();

        /*
         * Y los papeles, que es lo que esta puerta dice que comprueba.
         *
         * Hasta este lote «los papeles están todos» quería decir «ningún
         * permiso está pendiente». Un permiso marcado como emitido sin su
         * documento contaba como hecho, y el conductor salía sin el papel que
         * le piden en una báscula. Ahora se exige el documento, y que no caduque
         * antes de la entrega planificada.
         */
        $faltas = Papers::faltan(
            (string) $actor->tenantId,
            (string) $carga->id,
            $carga->planned_delivery_at === null
                ? null
                : CarbonImmutable::parse((string) $carga->planned_delivery_at),
        );

        if ($faltas !== []) {
            $primera = $faltas[0];

            return back()->with('error', __(
                'oversize.readiness.'.$primera['reason'],
                ['state' => $primera['state'], 'n' => count($faltas)],
            ));
        }

        if ($pendientes > 0) {
            // Plural::key y no la clave a secas: «1 requisito(s) pendiente(s)»
            // es el plural de barra que la regla del proyecto existe para
            // eliminar, y este mensaje sale justo cuando alguien está
            // bloqueado y leyéndolo con atención.
            return back()->with('error', __(
                Plural::key('oversize.readiness.blocked', $pendientes),
                ['n' => $pendientes],
            ));
        }

        DB::table('loads')->where('id', $carga->id)->update([
            'permit_ready_approved_by_user_id' => $actor->auditUserId(),
            'permit_ready_approved_at' => CarbonImmutable::now(),
            'updated_at' => CarbonImmutable::now(),
        ]);

        return back()->with('success', __('oversize.readiness.success'));
    }

    /**
     * Colgar un papel: el del permiso, el del estudio de ruta o el de la
     * escolta.
     *
     * Una sola puerta para las tres ranuras porque el gesto es el mismo y la
     * lista de ranuras es cerrada — ver `Papers::RANURAS`. La ranura llega del
     * navegador, así que sin esa lista un nombre de columna elegido por el
     * cliente acabaría en un `update()`.
     */
    public function storePaper(
        Request $request,
        string $load,
        string $slot,
        string $row,
        CurrentActor $current,
        PermissionChecker $checker,
        DocumentStore $store,
    ): RedirectResponse {
        $actor = $current->require();
        $policy = $current->policy();
        $scope = $checker->authorize($actor, 'permit:manage', null, $policy);

        $carga = $this->findLoad($actor, $checker, $scope, $load);

        if (! Papers::conoce($slot)) {
            throw new NotFoundHttpException;
        }

        $request->validate([
            'file' => [
                'required',
                'file',
                'max:'.self::PAPEL_MAX_KB,
                // Por MIME real y no por la extensión del nombre. Mismo criterio
                // que los documentos de la carga y el recibo del gasto.
                'mimetypes:application/pdf,image/jpeg,image/png,image/webp,image/heic,image/tiff',
            ],
        ]);

        $colgado = Papers::attach($actor, $slot, (string) $carga->id, $row, $request->file('file'), $store);

        if (! $colgado) {
            throw new NotFoundHttpException;
        }

        return back()->with('success', __('oversize.papers.uploaded'));
    }

    /** Quitar un papel. */
    public function destroyPaper(
        string $load,
        string $slot,
        string $row,
        CurrentActor $current,
        PermissionChecker $checker,
    ): RedirectResponse {
        $actor = $current->require();
        $policy = $current->policy();
        $scope = $checker->authorize($actor, 'permit:manage', null, $policy);

        $carga = $this->findLoad($actor, $checker, $scope, $load);

        return Papers::detach($actor, $slot, (string) $carga->id, $row)
            ? back()->with('success', __('oversize.papers.removed'))
            : back()->with('error', __('oversize.papers.none'));
    }

    /**
     * Ver un papel.
     *
     * Redirige a un enlace FIRMADO y de vida corta: la comprobación de permisos
     * ocurre aquí, una vez, y el visor de PDF del navegador no necesita sesión.
     */
    public function showPaper(
        string $load,
        string $slot,
        string $row,
        CurrentActor $current,
        PermissionChecker $checker,
    ): RedirectResponse {
        $actor = $current->require();
        $policy = $current->policy();
        $scope = $checker->authorize($actor, 'permit:read', null, $policy);

        $carga = $this->findLoad($actor, $checker, $scope, $load);

        if (! Papers::conoce($slot)) {
            throw new NotFoundHttpException;
        }

        ['tabla' => $tabla, 'columna' => $columna] = Papers::RANURAS[$slot];

        $documentId = DB::table($tabla)
            ->where('tenant_id', $actor->tenantId)
            ->where('load_id', $carga->id)
            ->where('id', $row)
            ->whereNull('deleted_at')
            ->value($columna);

        $clave = $documentId === null
            ? null
            : Attachment::storageKey((string) $actor->tenantId, (string) $documentId);

        if ($clave === null) {
            return back()->with('error', __('oversize.papers.none'));
        }

        return redirect()->to(URL::temporarySignedRoute(
            'documents.file',
            now()->addMinutes(5),
            ['key' => base64_encode($clave)],
        ));
    }

    public function storePermit(Request $request, string $load, CurrentActor $current, PermissionChecker $checker): RedirectResponse
    {
        $actor = $current->require();
        $policy = $current->policy();
        $scope = $checker->authorize($actor, 'permit:manage', null, $policy);

        $datos = $request->validate([
            'state_code' => ['required', 'string', 'size:2'],
            'permit_number' => ['nullable', 'string', 'max:80'],
            'permit_type' => ['nullable', 'string', 'max:60'],
            'status' => ['required', Rule::in(self::ESTADOS_PERMISO)],
            'issued_at' => ['nullable', 'date'],
            'expires_at' => ['nullable', 'date', 'after_or_equal:issued_at'],
            'cost_cents' => ['nullable', 'integer', 'min:0'],
            'notes' => ['nullable', 'string', 'max:2000'],
        ]);

        $carga = $this->findLoad($actor, $checker, $scope, $load);

        if (! Regions::isSubdivisionOf('US', $datos['state_code'])) {
            return back()->with('error', __('oversize.permits.unknownState'));
        }

        DB::table('permits')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => (string) $actor->tenantId,
            'load_id' => (string) $carga->id,
            'state_code' => mb_strtoupper($datos['state_code']),
            'permit_number' => $datos['permit_number'] ?? null,
            'permit_type' => $datos['permit_type'] ?? null,
            'status' => $datos['status'],
            'issued_at' => $datos['issued_at'] ?? null,
            'expires_at' => $datos['expires_at'] ?? null,
            'cost_cents' => $datos['cost_cents'] ?? 0,
            'notes' => $datos['notes'] ?? null,
            'created_at' => CarbonImmutable::now(),
            'updated_at' => CarbonImmutable::now(),
        ]);

        // Añadir un permiso pendiente REABRE la compuerta. Si no lo hiciera,
        // una carga aprobada el lunes seguiría aprobada el martes con un permiso
        // nuevo sin tramitar dentro.
        if (in_array($datos['status'], ['pending', 'requested', 'expired', 'rejected'], true)) {
            DB::table('loads')->where('id', $carga->id)->update([
                'permit_ready_approved_by_user_id' => null,
                'permit_ready_approved_at' => null,
                'updated_at' => CarbonImmutable::now(),
            ]);
        }

        return back()->with('success', __('oversize.permits.created'));
    }

    public function updatePermit(Request $request, string $load, string $permit, CurrentActor $current, PermissionChecker $checker): RedirectResponse
    {
        $actor = $current->require();
        $policy = $current->policy();
        $scope = $checker->authorize($actor, 'permit:manage', null, $policy);

        $datos = $request->validate([
            'status' => ['required', Rule::in(self::ESTADOS_PERMISO)],
            'permit_number' => ['nullable', 'string', 'max:80'],
            'issued_at' => ['nullable', 'date'],
            'expires_at' => ['nullable', 'date', 'after_or_equal:issued_at'],
            'cost_cents' => ['nullable', 'integer', 'min:0'],
            'notes' => ['nullable', 'string', 'max:2000'],
        ]);

        $carga = $this->findLoad($actor, $checker, $scope, $load);

        $afectadas = DB::table('permits')
            ->where('tenant_id', $actor->tenantId)
            ->where('load_id', $carga->id)
            ->where('id', $permit)
            ->whereNull('deleted_at')
            ->update([
                'status' => $datos['status'],
                'permit_number' => $datos['permit_number'] ?? null,
                'issued_at' => $datos['issued_at'] ?? null,
                'expires_at' => $datos['expires_at'] ?? null,
                'cost_cents' => $datos['cost_cents'] ?? 0,
                'notes' => $datos['notes'] ?? null,
                'updated_at' => CarbonImmutable::now(),
            ]);

        if ($afectadas === 0) {
            throw new NotFoundHttpException;
        }

        return back()->with('success', __('oversize.permits.updated'));
    }

    public function storeEscort(Request $request, string $load, CurrentActor $current, PermissionChecker $checker): RedirectResponse
    {
        $actor = $current->require();
        $policy = $current->policy();
        $scope = $checker->authorize($actor, 'permit:manage', null, $policy);

        $datos = $request->validate([
            'escort_type' => ['required', Rule::in(self::TIPOS_ESCOLTA)],
            'state_code' => ['nullable', 'string', 'size:2'],
            'provider_name' => ['nullable', 'string', 'max:200'],
            'contact_name' => ['nullable', 'string', 'max:200'],
            'contact_phone' => ['nullable', 'string', 'max:32'],
            'contact_email' => ['nullable', 'email', 'max:255'],
            'agency_name' => ['nullable', 'string', 'max:200'],
            'scheduled_for' => ['nullable', 'date'],
            'status' => ['required', Rule::in(self::ESTADOS_ESCOLTA)],
            'cost_cents' => ['nullable', 'integer', 'min:0'],
            'notes' => ['nullable', 'string', 'max:2000'],
        ]);

        $carga = $this->findLoad($actor, $checker, $scope, $load);

        DB::table('escorts')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => (string) $actor->tenantId,
            'load_id' => (string) $carga->id,
            'escort_type' => $datos['escort_type'],
            'state_code' => isset($datos['state_code']) ? mb_strtoupper($datos['state_code']) : null,
            'provider_name' => $datos['provider_name'] ?? null,
            'contact_name' => $datos['contact_name'] ?? null,
            'contact_phone' => $datos['contact_phone'] ?? null,
            'contact_email' => $datos['contact_email'] ?? null,
            'agency_name' => $datos['agency_name'] ?? null,
            'scheduled_for' => $datos['scheduled_for'] ?? null,
            'status' => $datos['status'],
            'cost_cents' => $datos['cost_cents'] ?? 0,
            'notes' => $datos['notes'] ?? null,
            'created_at' => CarbonImmutable::now(),
            'updated_at' => CarbonImmutable::now(),
        ]);

        return back()->with('success', __('oversize.escorts.created'));
    }

    public function updateEscort(Request $request, string $load, string $escort, CurrentActor $current, PermissionChecker $checker): RedirectResponse
    {
        $actor = $current->require();
        $policy = $current->policy();
        $scope = $checker->authorize($actor, 'permit:manage', null, $policy);

        $datos = $request->validate([
            'status' => ['required', Rule::in(self::ESTADOS_ESCOLTA)],
            'scheduled_for' => ['nullable', 'date'],
            'cost_cents' => ['nullable', 'integer', 'min:0'],
            'notes' => ['nullable', 'string', 'max:2000'],
        ]);

        $carga = $this->findLoad($actor, $checker, $scope, $load);

        $afectadas = DB::table('escorts')
            ->where('tenant_id', $actor->tenantId)
            ->where('load_id', $carga->id)
            ->where('id', $escort)
            ->whereNull('deleted_at')
            ->update([
                'status' => $datos['status'],
                'scheduled_for' => $datos['scheduled_for'] ?? null,
                'cost_cents' => $datos['cost_cents'] ?? 0,
                'notes' => $datos['notes'] ?? null,
                'updated_at' => CarbonImmutable::now(),
            ]);

        if ($afectadas === 0) {
            throw new NotFoundHttpException;
        }

        return back()->with('success', __('oversize.escorts.updated'));
    }

    private function findLoad(Actor $actor, PermissionChecker $checker, Scope $scope, string $load): Load
    {
        $carga = LoadScope::apply(Load::query(), $checker, $actor, $scope)
            ->where('loads.id', $load)
            ->first();

        if ($carga === null) {
            throw new NotFoundHttpException;
        }

        return $carga;
    }

    private function minute(mixed $valor): ?string
    {
        return $valor === null ? null : substr((string) $valor, 0, 16);
    }
}
