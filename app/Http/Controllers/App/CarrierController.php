<?php

declare(strict_types=1);

namespace App\Http\Controllers\App;

use App\Authorization\Actor;
use App\Authorization\CurrentActor;
use App\Authorization\PermissionChecker;
use App\Authorization\ResourceContext;
use App\Enums\AuditAction;
use App\Enums\CarrierContactPosition;
use App\Enums\Locale;
use App\Enums\OnboardingStatus;
use App\Enums\VerificationStatus;
use App\Models\Carrier;
use App\Rules\SubdivisionOfCountry;
use App\Services\Fmcsa\FmcsaDirectory;
use App\Services\Fmcsa\FmcsaVerifier;
use App\Support\Audit;
use App\Support\EnumValue;
use App\Support\Geo\Regions;
use App\Support\InertiaPage;
use App\Support\Locales;
use App\Support\Plans\Limits;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Inertia\Inertia;
use Inertia\Response;

/**
 * Los transportistas: listar, ver, crear y editar.
 *
 * Lo que hay que entender de este controlador es de dónde sale lo que cada
 * usuario ve. NO se traen los transportistas y luego se filtran: el ámbito que
 * devuelve `authorize()` se convierte en un estrechamiento de la CONSULTA (ver
 * ScopeFilter). La diferencia importa aunque el resultado visible sea el mismo —
 * si se filtrara después, los contadores, los totales y la paginación ya habrían
 * contado filas que el usuario no puede ver, y eso es una fuga.
 *
 * Un despachador con dos transportistas asignados y una empresa con seiscientos
 * ve «2», no «600 de los que puedes ver 2».
 */
final class CarrierController
{
    use InertiaPage;

    private const PER_PAGE = 20;

    /** Columnas por las que se puede ordenar. Lista blanca: el parámetro va a SQL. */
    private const SORTABLE = [
        'legal_name' => 'legal_name',
        'dot_number' => 'dot_number',
        'onboarding_status' => 'onboarding_status',
        'fmcsa_status' => 'fmcsa_status',
        'last_activity_at' => 'last_activity_at',
        'created_at' => 'created_at',
    ];

    public function index(
        Request $request,
        CurrentActor $current,
        PermissionChecker $checker,
    ): Response {
        $actor = $current->require();
        $policy = $current->policy();

        // El ámbito concedido gobierna la consulta. Si el permiso falta, esto
        // lanza y el manejador devuelve un 403 con el motivo traducido.
        $scope = $checker->authorize($actor, 'carrier:read', null, $policy);

        $this->usesDictionary($request, ['carriers', 'nav']);

        $filters = [
            'search' => trim((string) $request->query('search', '')),
            'onboarding' => (string) $request->query('onboarding', ''),
            'fmcsa' => (string) $request->query('fmcsa', ''),
            'sort' => (string) $request->query('sort', 'legal_name'),
            'direction' => $request->query('direction') === 'desc' ? 'desc' : 'asc',
        ];

        $query = $checker->scopeFilter($actor, $scope)->apply(
            Carrier::query(),
            // En esta tabla el «transportista» del ámbito es la fila misma.
            ['carrier' => 'id'],
        );

        $this->applyFilters($query, $filters);

        $sort = self::SORTABLE[$filters['sort']] ?? 'legal_name';

        $page = $query
            ->orderBy($sort, $filters['direction'])
            // Desempate estable: sin él, dos transportistas con el mismo estado
            // pueden intercambiarse entre páginas y uno no aparecer en ninguna.
            ->orderBy('id')
            ->paginate(self::PER_PAGE)
            ->withQueryString();

        /** @var Locale $locale */
        $locale = $request->attributes->get('locale', Locales::default());

        return Inertia::render('App/Carriers/Index', [
            'carriers' => [
                'data' => collect($page->items())->map(fn (Carrier $c): array => $this->row($c))->all(),
                'meta' => [
                    'total' => $page->total(),
                    'perPage' => $page->perPage(),
                    'currentPage' => $page->currentPage(),
                    'lastPage' => $page->lastPage(),
                ],
            ],
            'filters' => $filters,
            'facets' => $this->facets($checker, $actor, $scope),
            // El ámbito viaja a la pantalla para poder DECIRLO, no para decidir
            // nada: un despachador tiene derecho a saber que está viendo su
            // cartera y no la empresa entera.
            'scope' => $scope->value,
            'can' => [
                'create' => $checker->can($actor, 'carrier:create', null, $policy)->allowed,
                'readOnboarding' => $checker->can($actor, 'carrier:onboarding:read', null, $policy)->allowed,
            ],
            'locale' => $locale->value,
        ]);
    }

    public function show(
        Request $request,
        string $carrier,
        CurrentActor $current,
        PermissionChecker $checker,
    ): Response {
        $actor = $current->require();
        $policy = $current->policy();

        $model = $this->find($carrier);

        // El registro concreto entra en la comprobación. Sin esto, un
        // despachador con `carrier:read` de ámbito `assigned` podría abrir por
        // URL directa un transportista que no lleva: el listado no se lo
        // enseñaría, pero el enlace escrito a mano sí.
        $checker->authorize($actor, 'carrier:read', $this->context($model), $policy);

        $this->usesDictionary($request, ['carriers', 'nav']);

        return Inertia::render('App/Carriers/Show', [
            'carrier' => $this->detail($model),
            'onboarding' => $checker->can($actor, 'carrier:onboarding:read', $this->context($model), $policy)->allowed
                ? $this->onboarding($model)
                : null,
            'verification' => $checker->can($actor, 'carrier:verification:read', $this->context($model), $policy)->allowed
                ? $this->verification($model)
                : null,
            'documents' => $checker->can($actor, 'document:read', $this->context($model), $policy)->allowed
                ? $this->documents($model)
                : null,
            'fleet' => $checker->can($actor, 'equipment:read', $this->context($model), $policy)->allowed
                ? $this->fleet($model)
                : null,
            'can' => [
                'update' => $checker->can($actor, 'carrier:update', $this->context($model), $policy)->allowed,
                'updateFee' => $checker->can($actor, 'carrier:fee:update', $this->context($model), $policy)->allowed,
                'delete' => $checker->can($actor, 'carrier:delete', $this->context($model), $policy)->allowed,
                'submitOnboarding' => $checker->can($actor, 'carrier:onboarding:submit', $this->context($model), $policy)->allowed,
                'reviewOnboarding' => $checker->can($actor, 'carrier:onboarding:review', $this->context($model), $policy)->allowed,
                'approveOnboarding' => $checker->can($actor, 'carrier:onboarding:approve', $this->context($model), $policy)->allowed,
                'runVerification' => $checker->can($actor, 'carrier:verification:run', $this->context($model), $policy)->allowed,
                'overrideVerification' => $checker->can($actor, 'carrier:verification:override', $this->context($model), $policy)->allowed,
            ],
        ]);
    }

    /**
     * El alta empieza por el número, no por el nombre.
     *
     * Un transportista ya EXISTE en el registro federal antes de existir aquí.
     * Pedir primero el USDOT y traerse la ficha evita las tres cosas que
     * estropean un alta escrita a mano: el nombre legal que no es el legal, la
     * dirección vieja, y —la peor— dar de alta por segunda vez a alguien que ya
     * estaba, con el nombre escrito de otra manera.
     *
     * La consulta viaja en el GET y no en un POST aparte para que la pantalla
     * sea una sola: `?dot=` recarga esta misma ruta con la ficha dentro. Así
     * volver atrás en el navegador funciona, y el enlace es compartible.
     */
    public function create(
        Request $request,
        CurrentActor $current,
        PermissionChecker $checker,
        FmcsaDirectory $directory,
    ): Response|RedirectResponse {
        $actor = $current->require();
        $checker->authorize($actor, 'carrier:create', null, $current->policy());

        // Igual que en las cargas: se avisa antes del formulario, y el muro de
        // verdad sigue en store().
        if (Limits::isFull((string) $actor->tenantId, Limits::CARRIERS)) {
            return redirect('/carriers')->with('error', __('billing.limits.reached.carriers'));
        }

        $this->usesDictionary($request, ['carriers', 'nav', 'validation']);

        $dot = trim((string) $request->query('dot', ''));
        $mc = trim((string) $request->query('mc', ''));

        return Inertia::render('App/Carriers/Form', [
            'carrier' => null,
            'canSetFee' => $checker->can($actor, 'carrier:fee:update', null, $current->policy())->allowed,
            'factoringCompanies' => $this->factoringOptions($actor),
            'contactPositions' => CarrierContactPosition::values(),
            'lookup' => $this->lookup($actor, $directory, $dot, $mc),
        ]);
    }

    /**
     * Deja constancia de lo que el registro federal decía el día del alta.
     *
     * Solo cuando la consulta fue REAL. Con el adaptador simulado no se escribe
     * nada: una fila `verified` fabricada por un simulacro, puesta ahí sola sin
     * que nadie la pidiera, es exactamente la clase de dato que dentro de un año
     * alguien lee como si significara algo.
     *
     * Y aun siendo real, esto NO aprueba a nadie. El transportista nace en
     * borrador; lo que esto guarda es la foto del registro, para que la revisión
     * de incorporación empiece con algo delante en vez de en blanco.
     */
    private function recordFmcsaSnapshot(
        Carrier $carrier,
        FmcsaDirectory $directory,
        FmcsaVerifier $verifier,
    ): void {
        if (! $directory->isLive()) {
            return;
        }

        $resultado = $verifier->verify(
            (string) $carrier->dot_number,
            $carrier->mc_number === null ? null : (string) $carrier->mc_number,
            (string) $carrier->legal_name,
        );

        $ahora = now();

        DB::table('fmcsa_verifications')->insert([
            'id' => (string) \Illuminate\Support\Str::uuid(),
            'tenant_id' => $carrier->tenant_id,
            'carrier_id' => $carrier->id,
            'provider' => $verifier->name(),
            'dot_number' => $carrier->dot_number,
            'mc_number' => $carrier->mc_number,
            'status' => $resultado->status->value,
            'normalized' => json_encode($resultado->normalized),
            // Solo el digest, nunca el cuerpo entero: la respuesta cruda trae
            // direcciones y nombres, y esta tabla se conserva años.
            'raw_payload_digest' => $resultado->rawDigest,
            'attempt' => 1,
            'error_message' => $resultado->errorMessage,
            'created_at' => $ahora,
            'updated_at' => $ahora,
        ]);

        DB::table('carriers')->where('id', $carrier->id)->update([
            'fmcsa_status' => $resultado->status->value,
            'fmcsa_last_verified_at' => $ahora,
            'fmcsa_next_verification_at' => $resultado->status === VerificationStatus::Verified
                ? $ahora->copy()->addYear()
                : null,
            'updated_at' => $ahora,
        ]);
    }

    /**
     * Consulta el registro y prepara lo que la pantalla necesita saber.
     *
     * Devuelve `null` cuando no se pidió nada: el formulario arranca en el paso
     * uno, con el campo del número y nada más.
     *
     * @return array<string, mixed>|null
     */
    private function lookup(Actor $actor, FmcsaDirectory $directory, string $dot, string $mc): ?array
    {
        if ($dot === '' && $mc === '') {
            return [
                'status' => 'idle',
                'live' => $directory->isLive(),
                'provider' => $directory->name(),
                'carrier' => null,
                'existing' => null,
                'message' => null,
            ];
        }

        // Un tope por usuario. FMCSA es un servicio público y gratuito: pegarle
        // sin freno desde un formulario es la forma más rápida de que dejen de
        // contestarnos. Treinta consultas por minuto son de sobra para un alta
        // y poco para un bucle.
        $llave = 'fmcsa-lookup:'.($actor->userId ?? 'anon');

        if (RateLimiter::tooManyAttempts($llave, 30)) {
            return [
                'status' => 'throttled',
                'live' => $directory->isLive(),
                'provider' => $directory->name(),
                'carrier' => null,
                'existing' => null,
                'message' => null,
                'retryAfter' => RateLimiter::availableIn($llave),
            ];
        }

        RateLimiter::hit($llave, 60);

        $resultado = $dot !== '' ? $directory->byDot($dot) : $directory->byDocket($mc);

        $ficha = $resultado->carrier;

        return [
            'status' => $resultado->status->value,
            'live' => $resultado->live,
            'provider' => $resultado->provider,
            'carrier' => $ficha?->toForm(),
            // Lo más útil que puede devolver esta consulta no es la ficha: es
            // «este ya lo tienes». Un transportista duplicado ensucia las
            // liquidaciones durante meses.
            //
            // Se busca por lo que se ESCRIBIÓ, no por lo que devolvió el
            // registro: si FMCSA no contesta, el duplicado sigue siendo un
            // duplicado y hay que avisarlo igual.
            'existing' => $this->existingByDot($actor, $ficha?->dotNumber ?? $dot),
            'message' => $resultado->message,
        ];
    }

    /**
     * @return array<string, string>|null
     */
    private function existingByDot(Actor $actor, string $dot): ?array
    {
        if (trim($dot) === '') {
            return null;
        }

        $fila = DB::table('carriers')
            ->where('tenant_id', $actor->tenantId)
            ->where('dot_number', $dot)
            ->whereNull('deleted_at')
            ->first(['id', 'legal_name']);

        return $fila === null ? null : [
            'id' => (string) $fila->id,
            'legalName' => (string) $fila->legal_name,
        ];
    }

    public function store(
        Request $request,
        CurrentActor $current,
        PermissionChecker $checker,
        FmcsaDirectory $directory,
        FmcsaVerifier $verifier,
    ): RedirectResponse {
        $actor = $current->require();
        $policy = $current->policy();
        $checker->authorize($actor, 'carrier:create', null, $policy);

        // El tope de transportistas del plan. Antes de validar nada: el mensaje
        // que hay que dar no es «este campo está mal», es «no cabe otro».
        if (Limits::isFull((string) $actor->tenantId, Limits::CARRIERS)) {
            return back()->withInput()->with('error', __('billing.limits.reached.carriers'));
        }

        $data = $this->validated($request, null);

        // `factoring_company_id` no es una columna de `carriers`: la asignación
        // vive en su propia tabla, con fechas y carta de cesión. Sale de $data
        // ANTES del fill(), porque fuera de producción Eloquent está en modo
        // estricto y un atributo no rellenable ahí es una excepción, no un
        // silencio.
        $factoring = $this->pullFactoring($data);
        $contacts = $this->pullContacts($data);

        // La tarifa de despacho es dinero y tiene permiso propio. Quien no lo
        // tenga no la fija ni enviándola en el formulario: se descarta aquí y se
        // queda el valor por omisión de la columna.
        if (! $checker->can($actor, 'carrier:fee:update', null, $policy)->allowed) {
            unset($data['dispatch_fee_bps']);
        }

        $carrier = new Carrier;
        $carrier->fill($data);
        // Nace en borrador y sin verificar, pase lo que pase en el formulario.
        // Que un transportista entre ya aprobado es exactamente lo que el alta
        // existe para impedir.
        $carrier->onboarding_status = OnboardingStatus::Draft;
        $carrier->fmcsa_status = VerificationStatus::NotStarted;
        $carrier->save();

        DB::table('carrier_onboardings')->insert([
            'id' => (string) \Illuminate\Support\Str::uuid(),
            'tenant_id' => $carrier->tenant_id,
            'carrier_id' => $carrier->id,
            'status' => OnboardingStatus::Draft->value,
            'required_document_types' => json_encode(['certificate_of_authority', 'certificate_of_insurance', 'carrier_agreement']),
            'checklist' => json_encode([]),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->syncFactoring($actor, $carrier, $factoring);

        // Un transportista siempre tiene al menos un contacto. Si el formulario
        // no mandó la lista —una integración vieja, una prueba— se fabrica el
        // principal a partir de las columnas, para que la ficha no se abra con
        // una lista vacía al lado de un contacto que sí está en la cabecera.
        $this->syncContacts($actor, $carrier, $contacts ?? [$this->primaryFromColumns($carrier)]);

        $this->recordFmcsaSnapshot($carrier, $directory, $verifier);

        return redirect()
            ->route('carriers.show', $carrier->id)
            ->with('success', __('carriers.flash.created', ['name' => $carrier->legal_name]));
    }

    public function edit(
        Request $request,
        string $carrier,
        CurrentActor $current,
        PermissionChecker $checker,
    ): Response {
        $actor = $current->require();
        $model = $this->find($carrier);
        $checker->authorize($actor, 'carrier:update', $this->context($model), $current->policy());

        $this->usesDictionary($request, ['carriers', 'nav', 'validation']);

        return Inertia::render('App/Carriers/Form', [
            'carrier' => $this->detail($model),
            'canSetFee' => $checker->can($actor, 'carrier:fee:update', $this->context($model), $current->policy())->allowed,
            'factoringCompanies' => $this->factoringOptions($actor),
            'factoringCompanyId' => $this->currentFactoring($actor, (string) $model->id),
            'contactPositions' => CarrierContactPosition::values(),
        ]);
    }

    public function update(
        Request $request,
        string $carrier,
        CurrentActor $current,
        PermissionChecker $checker,
    ): RedirectResponse {
        $actor = $current->require();
        $policy = $current->policy();
        $model = $this->find($carrier);
        $checker->authorize($actor, 'carrier:update', $this->context($model), $policy);

        $data = $this->validated($request, $model->id);

        // `factoring_company_id` no es una columna de `carriers`: la asignación
        // vive en su propia tabla, con fechas y carta de cesión. Sale de $data
        // ANTES del fill(), porque fuera de producción Eloquent está en modo
        // estricto y un atributo no rellenable ahí es una excepción, no un
        // silencio.
        $factoring = $this->pullFactoring($data);
        $contacts = $this->pullContacts($data);

        $feeBefore = (int) $model->dispatch_fee_bps;
        $feeRequested = $data['dispatch_fee_bps'] ?? $feeBefore;
        $mayChangeFee = $checker->can($actor, 'carrier:fee:update', $this->context($model), $policy)->allowed;

        if (! $mayChangeFee) {
            unset($data['dispatch_fee_bps']);
        }

        $model->fill($data);
        $model->save();

        $this->syncFactoring($actor, $model, $factoring);

        // null es «no toques los contactos», que no es lo mismo que «bórralos».
        if ($contacts !== null) {
            $this->syncContacts($actor, $model, $contacts);
        }

        // Cambiar el porcentaje de despacho cambia lo que cobra la empresa en
        // cada carga futura de este transportista. Va a la pista de auditoría
        // con el antes y el después, que es lo que alguien va a querer mirar
        // cuando una liquidación no cuadre.
        if ($mayChangeFee && $feeRequested !== $feeBefore) {
            Audit::record(
                $actor,
                AuditAction::FinancialChanged,
                entityType: 'carrier',
                entityId: $model->id,
                entityLabel: $model->legal_name,
                before: ['dispatch_fee_bps' => $feeBefore],
                after: ['dispatch_fee_bps' => (int) $model->dispatch_fee_bps],
            );
        }

        return redirect()
            ->route('carriers.show', $model->id)
            ->with('success', __('carriers.flash.updated', ['name' => $model->legal_name]));
    }

    public function destroy(
        string $carrier,
        CurrentActor $current,
        PermissionChecker $checker,
    ): RedirectResponse {
        $actor = $current->require();
        $model = $this->find($carrier);
        $checker->authorize($actor, 'carrier:delete', $this->context($model), $current->policy());

        // Borrado suave. La política de retención decide cuándo se purga de
        // verdad; hasta entonces las cargas históricas siguen pudiendo nombrar a
        // su transportista, que es lo que exige una factura de hace dos años.
        $model->deleted_by = $actor->userId;
        $model->save();
        $model->delete();

        return redirect()
            ->route('carriers.index')
            ->with('success', __('carriers.flash.deleted', ['name' => $model->legal_name]));
    }

    // ------------------------------------------------------------------ interno

    /**
     * @param  Builder<Carrier>  $query
     * @param  array{search: string, onboarding: string, fmcsa: string}  $filters
     */
    private function applyFilters(Builder $query, array $filters): void
    {
        if ($filters['search'] !== '') {
            $term = '%'.str_replace(['%', '_'], ['\%', '\_'], $filters['search']).'%';

            $query->where(function (Builder $q) use ($term): void {
                $q->where('legal_name', 'like', $term)
                    ->orWhere('dba', 'like', $term)
                    ->orWhere('dot_number', 'like', $term)
                    ->orWhere('mc_number', 'like', $term)
                    ->orWhere('email', 'like', $term);
            });
        }

        if (OnboardingStatus::tryFrom($filters['onboarding']) !== null) {
            $query->where('onboarding_status', $filters['onboarding']);
        }

        if (VerificationStatus::tryFrom($filters['fmcsa']) !== null) {
            $query->where('fmcsa_status', $filters['fmcsa']);
        }
    }

    /**
     * Cuántos hay en cada estado de alta, DENTRO del ámbito del actor.
     *
     * Se recuenta con el mismo estrechamiento que el listado. Un recuento global
     * junto a un listado estrecho sería una fuga discreta: diría cuántos
     * transportistas tiene la empresa a quien solo puede ver dos.
     *
     * @return array<string, int>
     */
    private function facets(PermissionChecker $checker, \App\Authorization\Actor $actor, \App\Enums\Scope $scope): array
    {
        $rows = $checker->scopeFilter($actor, $scope)
            ->apply(Carrier::query(), ['carrier' => 'id'])
            ->select('onboarding_status', DB::raw('count(*) as total'))
            ->groupBy('onboarding_status')
            ->pluck('total', 'onboarding_status');

        $out = [];

        foreach (OnboardingStatus::cases() as $case) {
            $out[$case->value] = (int) ($rows[$case->value] ?? 0);
        }

        return $out;
    }

    /**
     * Encuentra el transportista DENTRO de la empresa activa.
     *
     * El scope global de tenant ya lo garantiza; `findOrFail` sobre él devuelve
     * 404 para un id de otra empresa, que es la respuesta correcta: un 403 diría
     * «existe pero no es tuyo», y eso ya es información.
     */
    private function find(string $id): Carrier
    {
        return Carrier::query()->findOrFail($id);
    }

    private function context(Carrier $carrier): ResourceContext
    {
        // A mano y no con fromModel(): en esta tabla el id del transportista ES
        // la clave primaria, y fromModel() buscaría una columna `carrier_id` que
        // aquí no existe. Con el contexto vacío, los ámbitos `assigned` y
        // `carrier` no podrían demostrarse y denegarían siempre.
        return new ResourceContext(
            tenantId: $carrier->tenant_id,
            carrierId: $carrier->id,
        );
    }

    /**
     * @return array<string, mixed>
     */
    private function row(Carrier $c): array
    {
        return [
            'id' => $c->id,
            'legalName' => $c->legal_name,
            'dba' => $c->dba,
            'dotNumber' => $c->dot_number,
            'mcNumber' => $c->mc_number,
            'city' => $c->physical_city,
            'state' => $c->physical_state,
            'contact' => trim("{$c->contact_first_name} {$c->contact_last_name}"),
            'email' => $c->email,
            'phone' => $c->phone,
            'preferredLocale' => EnumValue::of($c->preferred_locale, 'en'),
            'onboardingStatus' => EnumValue::of($c->onboarding_status),
            'fmcsaStatus' => EnumValue::of($c->fmcsa_status),
            'dispatchFeeBps' => (int) $c->dispatch_fee_bps,
            'lastActivityAt' => $c->last_activity_at?->toIso8601String(),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function detail(Carrier $c): array
    {
        return [
            ...$this->row($c),
            'physical' => [
                'line1' => $c->physical_line1,
                'line2' => $c->physical_line2,
                'city' => $c->physical_city,
                'state' => $c->physical_state,
                'postalCode' => $c->physical_postal_code,
                'country' => $c->physical_country,
            ],
            'mailingSameAsPhysical' => (bool) $c->mailing_same_as_physical,
            'mailing' => [
                'line1' => $c->mailing_line1,
                'line2' => $c->mailing_line2,
                'city' => $c->mailing_city,
                'state' => $c->mailing_state,
                'postalCode' => $c->mailing_postal_code,
                'country' => $c->mailing_country,
            ],
            'contacts' => $this->contacts($c),
            'website' => $c->website,
            'usesFactoring' => (bool) $c->uses_factoring,
            'notes' => $c->notes,
            'approvedAt' => $c->approved_at?->toIso8601String(),
            'suspendedAt' => $c->suspended_at?->toIso8601String(),
            'suspensionReason' => $c->suspension_reason,
            'fmcsaLastVerifiedAt' => $c->fmcsa_last_verified_at?->toIso8601String(),
            'fmcsaNextVerificationAt' => $c->fmcsa_next_verification_at?->toIso8601String(),
            'createdAt' => $c->created_at?->toIso8601String(),
        ];
    }

    /**
     * @return array<string, mixed>|null
     */
    private function onboarding(Carrier $c): ?array
    {
        $row = DB::table('carrier_onboardings')
            ->where('carrier_id', $c->id)
            ->whereNull('deleted_at')
            ->first();

        if ($row === null) {
            return null;
        }

        return [
            'status' => $row->status,
            'submittedAt' => $row->submitted_at,
            'reviewStartedAt' => $row->review_started_at,
            'decidedAt' => $row->decided_at,
            'correctionNotes' => $row->correction_notes,
            'rejectionReason' => $row->rejection_reason,
            'requiredDocumentTypes' => json_decode((string) $row->required_document_types, true) ?: [],
            'checklist' => json_decode((string) $row->checklist, true) ?: [],
        ];
    }

    /**
     * @return array<string, mixed>|null
     */
    private function verification(Carrier $c): ?array
    {
        $row = DB::table('fmcsa_verifications')
            ->where('carrier_id', $c->id)
            ->orderByDesc('created_at')
            ->first();

        if ($row === null) {
            return null;
        }

        return [
            'status' => $row->status,
            'provider' => $row->provider,
            'attempt' => (int) $row->attempt,
            'errorMessage' => $row->error_message,
            'normalized' => json_decode((string) $row->normalized, true),
            'overriddenAt' => $row->overridden_at,
            'overrideReason' => $row->override_reason,
            'checkedAt' => $row->created_at,
        ];
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function documents(Carrier $c): array
    {
        return DB::table('documents')
            ->where('owner_type', 'carrier')
            ->where('owner_id', $c->id)
            ->whereNull('deleted_at')
            ->orderBy('document_type')
            ->get(['id', 'document_type', 'title', 'review_status', 'expiration_date', 'is_required'])
            ->map(fn ($d): array => [
                'id' => (string) $d->id,
                'type' => (string) $d->document_type,
                'title' => $d->title,
                'reviewStatus' => (string) $d->review_status,
                'expirationDate' => $d->expiration_date,
                'isRequired' => (bool) $d->is_required,
            ])
            ->all();
    }

    /**
     * @return array{trucks: list<array<string, mixed>>, trailers: list<array<string, mixed>>}
     */
    private function fleet(Carrier $c): array
    {
        $map = fn ($r): array => [
            'id' => (string) $r->id,
            'unitNumber' => (string) $r->unit_number,
            'year' => $r->year === null ? null : (int) $r->year,
            'make' => $r->make,
            'model' => $r->model,
            'status' => (string) $r->status,
        ];

        return [
            'trucks' => DB::table('trucks')->where('carrier_id', $c->id)->whereNull('deleted_at')
                ->orderBy('unit_number')->get(['id', 'unit_number', 'year', 'make', 'model', 'status'])
                ->map($map)->all(),
            'trailers' => DB::table('trailers')->where('carrier_id', $c->id)->whereNull('deleted_at')
                ->orderBy('unit_number')->get(['id', 'unit_number', 'year', 'make', 'model', 'status'])
                ->map($map)->all(),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function validated(Request $request, ?string $ignoreId): array
    {
        $this->mirrorPrimaryContact($request);

        return $request->validate([
            'legal_name' => ['required', 'string', 'max:200'],
            'dba' => ['nullable', 'string', 'max:200'],
            // El USDOT es la identidad del transportista ante el gobierno y no
            // puede repetirse dentro de una empresa. La unicidad se comprueba
            // aquí Y en la base de datos: esta da un mensaje entendible, la otra
            // es la que de verdad lo impide bajo concurrencia.
            'dot_number' => [
                'required', 'string', 'max:12', 'regex:/^[0-9]{5,12}$/',
                Rule::unique('carriers', 'dot_number')
                    ->where('tenant_id', app(\App\Support\TenantContext::class)->id())
                    ->whereNull('deleted_at')
                    ->ignore($ignoreId),
            ],
            'mc_number' => ['nullable', 'string', 'max:12', 'regex:/^[0-9]{1,12}$/'],
            // Estas cuatro son el ESPEJO del contacto principal. Siguen siendo
            // obligatorias porque las columnas lo son y medio sistema las lee;
            // lo que ha cambiado es de dónde salen: si el formulario manda
            // `contacts`, se rellenan solas desde el primero. Ver
            // mirrorPrimaryContact().
            'contact_first_name' => ['required', 'string', 'max:100'],
            'contact_last_name' => ['required', 'string', 'max:100'],
            'email' => ['required', 'email:rfc', 'max:255'],
            'phone' => ['required', 'string', 'max:32'],

            // La lista completa. El primero es el principal.
            'contacts' => ['nullable', 'array', 'max:20'],
            'contacts.*.id' => ['nullable', 'string', 'size:36'],
            'contacts.*.first_name' => ['required', 'string', 'max:100'],
            'contacts.*.last_name' => ['required', 'string', 'max:100'],
            // El correo del principal es obligatorio porque la columna
            // `carriers.email` lo es. Los demás pueden no tenerlo: el de
            // guardia a las tres de la mañana es un teléfono, no un buzón.
            //
            // `required_with:contacts` y NO `required` a secas. Con un índice
            // explícito —`contacts.0.email`, no el comodín— Laravel exige el
            // campo aunque `contacts` no venga en la petición: quien mandara
            // solo los cuatro campos sueltos recibía «The contacts.0.email
            // field is required» y no había forma de contentarlo. Los comodines
            // `contacts.*` no tienen ese problema porque solo se expanden sobre
            // lo que llega.
            'contacts.0.email' => ['required_with:contacts', 'email:rfc', 'max:255'],
            'contacts.*.email' => ['nullable', 'email:rfc', 'max:255'],
            'contacts.*.phone' => ['nullable', 'string', 'max:32'],
            // El cargo responde «¿a quién llamo para esto?». Lista cerrada:
            // con texto libre acaban conviviendo «dispatch», «Despacho» y «OPS».
            'contacts.*.position' => ['required', Rule::in(CarrierContactPosition::values())],
            // El idioma es POR PERSONA. El dueño puede llevar el negocio en
            // inglés y el de guardia contestar solo en español.
            'contacts.*.preferred_locale' => ['required', Rule::in(Locales::all())],

            'website' => ['nullable', 'url', 'max:255'],
            'preferred_locale' => ['required', Rule::in(Locales::all())],
            'physical_line1' => ['nullable', 'string', 'max:200'],
            'physical_line2' => ['nullable', 'string', 'max:200'],
            'physical_city' => ['nullable', 'string', 'max:120'],
            'physical_country' => ['nullable', 'string', Rule::in(Regions::countryCodes())],
            'physical_state' => ['nullable', 'string', 'max:3', new SubdivisionOfCountry($request->input('physical_country'))],
            'physical_postal_code' => ['nullable', 'string', 'max:12'],

            // Dirección postal. La casilla viene marcada: lo normal es que sea
            // la misma, y pedir dos veces la misma dirección es la forma más
            // segura de que la segunda acabe desactualizada.
            'mailing_same_as_physical' => ['boolean'],
            'mailing_line1' => ['nullable', 'string', 'max:200'],
            'mailing_line2' => ['nullable', 'string', 'max:200'],
            'mailing_city' => ['nullable', 'string', 'max:120'],
            'mailing_country' => ['nullable', 'string', Rule::in(Regions::countryCodes())],
            'mailing_state' => ['nullable', 'string', 'max:3', new SubdivisionOfCountry($request->input('mailing_country'))],
            'mailing_postal_code' => ['nullable', 'string', 'max:12'],

            // 0 a 10.000 puntos básicos = 0 % a 100 %. El mismo rango que impone
            // el CHECK de la columna, para que el error salga como mensaje de
            // formulario y no como una excepción de base de datos.
            'dispatch_fee_bps' => ['nullable', 'integer', 'min:0', 'max:10000'],
            'uses_factoring' => ['boolean'],
            'factoring_company_id' => ['nullable', 'string', 'size:36'],
            'notes' => ['nullable', 'string', 'max:5000'],
        ]);
    }

    /**
     * Copia el primer contacto a las columnas `contact_*` de `carriers`.
     *
     * Se hace ANTES de validar, no después, para que un error en el nombre del
     * contacto principal salga en el campo que el usuario está mirando —el de
     * la lista— y no en una columna que la pantalla nueva ya no enseña.
     *
     * Si el formulario no manda `contacts` no se toca nada: las pruebas y
     * cualquier integración que siga mandando los cuatro campos sueltos siguen
     * funcionando igual.
     */
    private function mirrorPrimaryContact(Request $request): void
    {
        $contacts = $request->input('contacts');

        if (! is_array($contacts) || $contacts === []) {
            return;
        }

        $principal = $contacts[array_key_first($contacts)];

        if (! is_array($principal)) {
            return;
        }

        $merge = [
            'contact_first_name' => $principal['first_name'] ?? null,
            'contact_last_name' => $principal['last_name'] ?? null,
            'email' => $principal['email'] ?? null,
            'phone' => $principal['phone'] ?? null,
        ];

        // `carriers.preferred_locale` pasa a ser el espejo del idioma del
        // principal. Tener dos controles —uno de empresa y otro por persona—
        // garantizaba que un día dijeran cosas distintas y nadie supiera cuál
        // manda.
        if (isset($principal['preferred_locale'])) {
            $merge['preferred_locale'] = $principal['preferred_locale'];
        }

        $request->merge($merge);
    }

    /**
     * Saca la lista de contactos de $data antes del fill().
     *
     * `contacts` no es una columna de `carriers`. Igual que
     * `factoring_company_id`, si se queda dentro el modo estricto de Eloquent
     * convierte el guardado en una excepción.
     *
     * Devuelve null cuando el formulario no mandó la lista: eso es «no toques
     * los contactos», que no es lo mismo que «bórralos todos».
     *
     * @param  array<string, mixed>  $data
     * @return list<array<string, mixed>>|null
     */
    private function pullContacts(array &$data): ?array
    {
        if (! array_key_exists('contacts', $data)) {
            return null;
        }

        $contacts = $data['contacts'];
        unset($data['contacts']);

        return is_array($contacts) ? array_values($contacts) : [];
    }

    /**
     * Deja los contactos como los mandó el formulario.
     *
     * Los que traen id se actualizan, los que no se crean, y los que ya no
     * vienen se borran EN SUAVE: un contacto que aparece en el historial de una
     * carga o en un correo de incorporación tiene que poder seguir nombrándose.
     *
     * El principal se marca primero como no-principal en todos y luego se pone
     * en uno solo. El índice único de la base de datos no admite dos vivos, así
     * que hacerlo al revés fallaría a mitad.
     *
     * @param  list<array<string, mixed>>  $contacts
     */
    private function syncContacts(Actor $actor, Carrier $carrier, array $contacts): void
    {
        $ahora = now();
        $vistos = [];

        DB::table('carrier_contacts')
            ->where('tenant_id', $carrier->tenant_id)
            ->where('carrier_id', $carrier->id)
            ->whereNull('deleted_at')
            ->update(['is_primary' => false, 'updated_at' => $ahora]);

        foreach (array_values($contacts) as $indice => $contacto) {
            $columnas = [
                'first_name' => trim((string) ($contacto['first_name'] ?? '')),
                'last_name' => trim((string) ($contacto['last_name'] ?? '')),
                'email' => $contacto['email'] ?? null,
                'phone' => $contacto['phone'] ?? null,
                'position' => $contacto['position'] ?? CarrierContactPosition::Other->value,
                'preferred_locale' => $contacto['preferred_locale'] ?? 'en',
                'is_primary' => $indice === 0,
                'updated_at' => $ahora,
            ];

            $id = $contacto['id'] ?? null;

            $existente = $id === null ? null : DB::table('carrier_contacts')
                ->where('tenant_id', $carrier->tenant_id)
                ->where('carrier_id', $carrier->id)
                ->where('id', $id)
                ->whereNull('deleted_at')
                ->first(['id']);

            if ($existente !== null) {
                DB::table('carrier_contacts')->where('id', $existente->id)->update($columnas);
                $vistos[] = (string) $existente->id;

                continue;
            }

            $nuevo = (string) \Illuminate\Support\Str::uuid();

            DB::table('carrier_contacts')->insert([
                ...$columnas,
                'id' => $nuevo,
                'tenant_id' => $carrier->tenant_id,
                'carrier_id' => $carrier->id,
                'created_at' => $ahora,
            ]);

            $vistos[] = $nuevo;
        }

        DB::table('carrier_contacts')
            ->where('tenant_id', $carrier->tenant_id)
            ->where('carrier_id', $carrier->id)
            ->whereNull('deleted_at')
            ->when($vistos !== [], fn ($q) => $q->whereNotIn('id', $vistos))
            ->update([
                'deleted_at' => $ahora,
                'deleted_by' => $actor->auditUserId(),
                'updated_at' => $ahora,
            ]);
    }

    /**
     * El contacto principal reconstruido desde las columnas de `carriers`.
     *
     * @return array<string, mixed>
     */
    private function primaryFromColumns(Carrier $carrier): array
    {
        return [
            'first_name' => (string) $carrier->contact_first_name,
            'last_name' => (string) $carrier->contact_last_name,
            'email' => $carrier->email,
            'phone' => $carrier->phone,
            'position' => CarrierContactPosition::Other->value,
            // ->value: aquí `$carrier` es un modelo de Eloquent y
            // `preferred_locale` está casteado a Locale. Un `(string)` sobre un
            // enum es un Error en ejecución. Ojo: en contacts(), justo debajo,
            // las filas vienen de DB::table() y ahí (string) SÍ es lo correcto.
            'preferred_locale' => $carrier->preferred_locale->value,
        ];
    }

    /**
     * Los contactos vivos de un transportista, el principal primero.
     *
     * @return list<array<string, mixed>>
     */
    private function contacts(Carrier $carrier): array
    {
        return DB::table('carrier_contacts')
            ->where('tenant_id', $carrier->tenant_id)
            ->where('carrier_id', $carrier->id)
            ->whereNull('deleted_at')
            ->orderByDesc('is_primary')
            ->orderBy('last_name')
            ->orderBy('first_name')
            ->get(['id', 'first_name', 'last_name', 'email', 'phone', 'position', 'preferred_locale', 'is_primary'])
            ->map(fn ($c): array => [
                'id' => (string) $c->id,
                'first_name' => (string) $c->first_name,
                'last_name' => (string) $c->last_name,
                'email' => $c->email,
                'phone' => $c->phone,
                'position' => (string) $c->position,
                'preferred_locale' => (string) $c->preferred_locale,
                'isPrimary' => (bool) $c->is_primary,
            ])
            ->all();
    }

    /**
     * Saca del formulario lo que hace falta para la asignación de factoring.
     *
     * Devuelve `present: false` cuando el formulario no traía ninguno de los
     * dos campos: eso es «no toques nada», que no es lo mismo que «desmarcado».
     *
     * @param  array<string, mixed>  $data
     * @return array{present: bool, uses: bool, id: string|null}
     */
    private function pullFactoring(array &$data): array
    {
        $present = array_key_exists('factoring_company_id', $data)
            || array_key_exists('uses_factoring', $data);

        $uses = (bool) ($data['uses_factoring'] ?? false);
        $id = $data['factoring_company_id'] ?? null;
        $id = ($id === null || $id === '') ? null : (string) $id;

        unset($data['factoring_company_id']);

        return ['present' => $present, 'uses' => $uses, 'id' => $id];
    }

    /**
     * Ata —o suelta— la empresa de factoring del transportista.
     *
     * La asignación vive en `factoring_assignments` y no en una columna de
     * `carriers` porque tiene vida propia: fechas de vigencia, la carta de
     * cesión, el cambio de beneficiario y quién lo verificó. Un transportista
     * cambia de factoring y las dos asignaciones tienen que poder convivir en el
     * historial.
     *
     * Desmarcar la casilla no borra la fila: la cierra en suave. La carta de
     * cesión que se firmó el mes pasado siguió existiendo.
     *
     * @param  array{present: bool, uses: bool, id: string|null}  $factoring
     */
    private function syncFactoring(Actor $actor, Carrier $carrier, array $factoring): void
    {
        if (! $factoring['present']) {
            return;
        }

        $elegida = $factoring['uses'] ? $factoring['id'] : null;

        $vigente = DB::table('factoring_assignments')
            ->where('tenant_id', $actor->tenantId)
            ->where('carrier_id', $carrier->id)
            ->whereNull('deleted_at')
            ->orderByDesc('created_at')
            ->first(['id', 'factoring_company_id']);

        if ($elegida !== null) {
            $existe = DB::table('factoring_companies')
                ->where('tenant_id', $actor->tenantId)
                ->where('id', $elegida)
                ->whereNull('deleted_at')
                ->exists();

            // Un identificador de otra empresa cliente pasa la validación de
            // formato: el scope global impide LEERLO, pero no impediría
            // escribirlo aquí.
            if (! $existe) {
                throw ValidationException::withMessages([
                    'factoring_company_id' => __('carriers.errors.factoringNotFound'),
                ]);
            }
        }

        if ($vigente !== null && (string) $vigente->factoring_company_id === (string) $elegida) {
            return;
        }

        if ($vigente !== null) {
            DB::table('factoring_assignments')->where('id', $vigente->id)->update([
                'effective_to' => now(),
                'deleted_at' => now(),
                'deleted_by' => $actor->auditUserId(),
                'updated_at' => now(),
            ]);
        }

        if ($elegida === null) {
            return;
        }

        DB::table('factoring_assignments')->insert([
            'id' => (string) \Illuminate\Support\Str::uuid(),
            'tenant_id' => $actor->tenantId,
            'carrier_id' => $carrier->id,
            'factoring_company_id' => $elegida,
            'verification_status' => 'not_started',
            'effective_from' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    /**
     * Las empresas de factoring ACTIVAS, para el desplegable del formulario.
     *
     * Solo las activas: una empresa marcada inactiva sigue valiendo para los
     * transportistas que ya la tienen —la carta de cesión no se anula porque
     * nosotros cambiemos una casilla— pero no debe poder elegirse de nuevo.
     *
     * @return list<array<string, string>>
     */
    private function factoringOptions(Actor $actor): array
    {
        return DB::table('factoring_companies')
            ->where('tenant_id', $actor->tenantId)
            ->whereNull('deleted_at')
            ->where('active', true)
            ->orderBy('name')
            ->limit(500)
            ->get(['id', 'name'])
            ->map(fn ($f): array => ['id' => (string) $f->id, 'name' => (string) $f->name])
            ->all();
    }

    /**
     * La factoring que este transportista tiene asignada ahora mismo, si alguna.
     */
    private function currentFactoring(Actor $actor, string $carrierId): ?string
    {
        $id = DB::table('factoring_assignments')
            ->where('tenant_id', $actor->tenantId)
            ->where('carrier_id', $carrierId)
            ->whereNull('deleted_at')
            ->orderByDesc('created_at')
            ->value('factoring_company_id');

        return $id === null ? null : (string) $id;
    }
}
