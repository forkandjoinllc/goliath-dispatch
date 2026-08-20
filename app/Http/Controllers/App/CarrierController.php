<?php

declare(strict_types=1);

namespace App\Http\Controllers\App;

use App\Authorization\CurrentActor;
use App\Authorization\PermissionChecker;
use App\Authorization\ResourceContext;
use App\Enums\AuditAction;
use App\Enums\Locale;
use App\Enums\OnboardingStatus;
use App\Enums\VerificationStatus;
use App\Models\Carrier;
use App\Support\Audit;
use App\Support\InertiaPage;
use App\Support\Locales;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
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

    public function create(Request $request, CurrentActor $current, PermissionChecker $checker): Response
    {
        $actor = $current->require();
        $checker->authorize($actor, 'carrier:create', null, $current->policy());

        $this->usesDictionary($request, ['carriers', 'nav', 'validation']);

        return Inertia::render('App/Carriers/Form', [
            'carrier' => null,
            'canSetFee' => $checker->can($actor, 'carrier:fee:update', null, $current->policy())->allowed,
        ]);
    }

    public function store(Request $request, CurrentActor $current, PermissionChecker $checker): RedirectResponse
    {
        $actor = $current->require();
        $policy = $current->policy();
        $checker->authorize($actor, 'carrier:create', null, $policy);

        $data = $this->validated($request, null);

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

        $feeBefore = (int) $model->dispatch_fee_bps;
        $feeRequested = $data['dispatch_fee_bps'] ?? $feeBefore;
        $mayChangeFee = $checker->can($actor, 'carrier:fee:update', $this->context($model), $policy)->allowed;

        if (! $mayChangeFee) {
            unset($data['dispatch_fee_bps']);
        }

        $model->fill($data);
        $model->save();

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
            'preferredLocale' => $c->preferred_locale instanceof Locale
                ? $c->preferred_locale->value
                : (string) $c->preferred_locale,
            'onboardingStatus' => $this->enumValue($c->onboarding_status),
            'fmcsaStatus' => $this->enumValue($c->fmcsa_status),
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
            'contact_first_name' => ['required', 'string', 'max:100'],
            'contact_last_name' => ['required', 'string', 'max:100'],
            'email' => ['required', 'email:rfc', 'max:255'],
            'phone' => ['required', 'string', 'max:32'],
            'website' => ['nullable', 'url', 'max:255'],
            'preferred_locale' => ['required', Rule::in(Locales::all())],
            'physical_line1' => ['nullable', 'string', 'max:200'],
            'physical_line2' => ['nullable', 'string', 'max:200'],
            'physical_city' => ['nullable', 'string', 'max:120'],
            'physical_state' => ['nullable', 'string', 'size:2'],
            'physical_postal_code' => ['nullable', 'string', 'max:12'],
            // 0 a 10.000 puntos básicos = 0 % a 100 %. El mismo rango que impone
            // el CHECK de la columna, para que el error salga como mensaje de
            // formulario y no como una excepción de base de datos.
            'dispatch_fee_bps' => ['nullable', 'integer', 'min:0', 'max:10000'],
            'uses_factoring' => ['boolean'],
            'notes' => ['nullable', 'string', 'max:5000'],
        ]);
    }

    private function enumValue(mixed $value): ?string
    {
        return $value instanceof \BackedEnum ? (string) $value->value : ($value === null ? null : (string) $value);
    }
}
