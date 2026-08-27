<?php

declare(strict_types=1);

namespace App\Http\Controllers\App;

use App\Authorization\Actor;
use App\Authorization\CurrentActor;
use App\Authorization\PermissionChecker;
use App\Enums\AuditAction;
use App\Enums\FactoringContactPosition;
use App\Enums\Scope;
use App\Exceptions\AuthorizationException;
use App\Models\FactoringCompany;
use App\Support\Audit;
use App\Support\InertiaPage;
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
 * Las empresas de factoring: quien le adelanta el dinero al transportista.
 *
 * La plataforma no mueve un céntimo por aquí y no habla con ninguna API de
 * factoring. Esto es un directorio: a quién llamar, para qué, y qué
 * transportistas trabajan con quién. El flujo real —mandar la carta de cesión,
 * cobrar el adelanto— ocurre fuera, entre el transportista y su factoring.
 *
 * Ámbito único: `factoring:read` y `factoring:manage` solo se conceden con
 * alcance de empresa, a administración y contabilidad. Un despachador no ve
 * esto, y un transportista tampoco — quién financia a quién es información
 * comercial de la casa de despacho.
 */
final class FactoringController
{
    use InertiaPage;

    private const PER_PAGE = 25;

    public function index(Request $request, CurrentActor $current, PermissionChecker $checker): Response
    {
        $actor = $current->require();
        $policy = $current->policy();
        $this->requireTenantScope($checker->authorize($actor, 'factoring:read', null, $policy));

        $this->usesDictionary($request, ['factoring', 'nav']);

        $filters = [
            'search' => trim((string) $request->query('search', '')),
            'status' => $request->query('status') === 'inactive' ? 'inactive' : (
                $request->query('status') === 'active' ? 'active' : ''
            ),
        ];

        $query = $this->scoped($actor);

        if ($filters['search'] !== '') {
            $term = '%'.str_replace(['%', '_'], ['\%', '\_'], $filters['search']).'%';
            $query->where(fn (Builder $q) => $q->where('name', 'like', $term)
                ->orWhere('website', 'like', $term));
        }

        if ($filters['status'] !== '') {
            $query->where('active', $filters['status'] === 'active');
        }

        $page = $query
            ->orderBy('active', 'desc')
            ->orderBy('name')
            ->paginate(self::PER_PAGE)
            ->withQueryString();

        /** @var list<string> $ids */
        $ids = collect($page->items())->map(fn (FactoringCompany $c): string => (string) $c->id)->all();

        // Las dos cuentas se piden UNA vez para la página entera. Dentro del
        // map() serían dos consultas por fila: cincuenta viajes a la base de
        // datos para pintar una tabla de veinticinco líneas.
        $contactCounts = $this->contactCounts($actor, $ids);
        $carrierCounts = $this->carrierCounts($actor, $ids);

        return Inertia::render('App/Factoring/Index', [
            'companies' => [
                'data' => collect($page->items())
                    ->map(fn (FactoringCompany $c): array => [
                        ...$this->row($c),
                        'contactCount' => $contactCounts[(string) $c->id] ?? 0,
                        'carrierCount' => $carrierCounts[(string) $c->id] ?? 0,
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
            'can' => [
                'manage' => $checker->can($actor, 'factoring:manage', null, $policy)->allowed,
            ],
        ]);
    }

    public function create(Request $request, CurrentActor $current, PermissionChecker $checker): Response
    {
        $actor = $current->require();
        $checker->authorize($actor, 'factoring:manage', null, $current->policy());

        $this->usesDictionary($request, ['factoring', 'nav']);

        return Inertia::render('App/Factoring/Form', [
            'company' => null,
            'positions' => FactoringContactPosition::values(),
        ]);
    }

    public function store(Request $request, CurrentActor $current, PermissionChecker $checker): RedirectResponse
    {
        $actor = $current->require();
        $checker->authorize($actor, 'factoring:manage', null, $current->policy());

        $data = $this->validated($request, $actor);

        $company = DB::transaction(function () use ($data, $actor): FactoringCompany {
            $company = new FactoringCompany;
            $company->fill($this->columns($data));
            $company->save();

            $this->syncContacts($company, $data['contacts'] ?? [], $actor);

            Audit::record(
                actor: $actor,
                action: AuditAction::SettingsUpdated,
                entityType: 'factoring_company',
                entityId: (string) $company->id,
                entityLabel: (string) $company->name,
                after: ['created' => true, 'contacts' => count($data['contacts'] ?? [])],
            );

            return $company;
        });

        return redirect()
            ->route('factoring.show', $company->id)
            ->with('success', __('factoring.flash.created', ['name' => $company->name]));
    }

    public function show(Request $request, string $factoring, CurrentActor $current, PermissionChecker $checker): Response
    {
        $actor = $current->require();
        $policy = $current->policy();
        $this->requireTenantScope($checker->authorize($actor, 'factoring:read', null, $policy));

        $company = $this->find($actor, $factoring);

        $this->usesDictionary($request, ['factoring', 'nav']);

        return Inertia::render('App/Factoring/Show', [
            'company' => [
                ...$this->row($company),
                'fundingInstructions' => $company->funding_instructions,
                'contacts' => $this->contacts($company),
            ],
            'carriers' => $this->carriersUsing($actor, $company),
            'can' => [
                'manage' => $checker->can($actor, 'factoring:manage', null, $policy)->allowed,
            ],
        ]);
    }

    public function edit(Request $request, string $factoring, CurrentActor $current, PermissionChecker $checker): Response
    {
        $actor = $current->require();
        $checker->authorize($actor, 'factoring:manage', null, $current->policy());

        $company = $this->find($actor, $factoring);

        $this->usesDictionary($request, ['factoring', 'nav']);

        return Inertia::render('App/Factoring/Form', [
            'company' => [
                ...$this->row($company),
                'fundingInstructions' => $company->funding_instructions,
                'contacts' => $this->contacts($company),
            ],
            'positions' => FactoringContactPosition::values(),
        ]);
    }

    public function update(Request $request, string $factoring, CurrentActor $current, PermissionChecker $checker): RedirectResponse
    {
        $actor = $current->require();
        $checker->authorize($actor, 'factoring:manage', null, $current->policy());

        $company = $this->find($actor, $factoring);
        $data = $this->validated($request, $actor, (string) $company->id);

        DB::transaction(function () use ($company, $data, $actor): void {
            $before = ['name' => $company->name, 'active' => (bool) $company->active];

            $company->fill($this->columns($data));
            $company->save();

            $this->syncContacts($company, $data['contacts'] ?? [], $actor);

            Audit::record(
                actor: $actor,
                action: AuditAction::SettingsUpdated,
                entityType: 'factoring_company',
                entityId: (string) $company->id,
                entityLabel: (string) $company->name,
                before: $before,
                after: ['name' => $company->name, 'active' => (bool) $company->active],
            );
        });

        return redirect()
            ->route('factoring.show', $company->id)
            ->with('success', __('factoring.flash.updated'));
    }

    /**
     * Baja suave, y solo si no la está usando nadie.
     *
     * Una empresa de factoring con transportistas asignados no se borra: la
     * carta de cesión sigue vigente y las liquidaciones históricas la nombran.
     * Lo que se hace en ese caso es marcarla inactiva, que la saca de los
     * desplegables sin romper nada de lo ya firmado.
     */
    public function destroy(Request $request, string $factoring, CurrentActor $current, PermissionChecker $checker): RedirectResponse
    {
        $actor = $current->require();
        $checker->authorize($actor, 'factoring:manage', null, $current->policy());

        $company = $this->find($actor, $factoring);

        $enUso = DB::table('factoring_assignments')
            ->where('tenant_id', $actor->tenantId)
            ->where('factoring_company_id', $company->id)
            ->whereNull('deleted_at')
            ->exists();

        if ($enUso) {
            throw ValidationException::withMessages([
                'company' => __('factoring.errors.inUse'),
            ]);
        }

        $data = $request->validate([
            'reason' => ['nullable', 'string', 'max:500'],
        ]);

        $company->deleted_by = $actor->auditUserId();
        $company->deletion_reason = $data['reason'] ?? null;
        $company->save();
        $company->delete();

        Audit::record(
            actor: $actor,
            action: AuditAction::SettingsUpdated,
            entityType: 'factoring_company',
            entityId: (string) $company->id,
            entityLabel: (string) $company->name,
            after: ['deleted' => true],
            reason: $data['reason'] ?? null,
        );

        return redirect()
            ->route('factoring.index')
            ->with('success', __('factoring.flash.deleted'));
    }

    // ------------------------------------------------------------------ ayudas

    /**
     * Este directorio es de la casa de despacho entera.
     *
     * `factoring:read` NO es exclusivo de administración: la matriz también se
     * lo concede al rol transportista, con alcance Carrier, para que pueda ver
     * SU asignación. Y `can()` devuelve permitido cuando no se le pasa recurso
     * —no hay nada contra lo que estrechar—, así que sin esta comprobación un
     * usuario transportista abriría /factoring y vería a todas las empresas de
     * factoring de la casa de despacho: información comercial que no es suya.
     */
    private function requireTenantScope(Scope $scope): void
    {
        if (! $scope->atLeast(Scope::Tenant)) {
            throw AuthorizationException::forbidden('errors.outOfScope', 'factoring:read');
        }
    }

    /**
     * @return Builder<FactoringCompany>
     */
    private function scoped(Actor $actor): Builder
    {
        // Ámbito de empresa y nada más. Quien llega hasta aquí ya pasó por
        // requireTenantScope(), así que no hay un caso más estrecho que filtrar.
        return FactoringCompany::query()->where('tenant_id', $actor->tenantId);
    }

    private function find(Actor $actor, string $id): FactoringCompany
    {
        $company = $this->scoped($actor)->whereKey($id)->first();

        abort_if($company === null, 404);

        return $company;
    }

    /**
     * @return array<string, mixed>
     */
    private function validated(Request $request, Actor $actor, ?string $ignore = null): array
    {
        return $request->validate([
            // El nombre es único por empresa cliente entre las vivas, y lo es en
            // la base de datos: `factoring_companies_tenant_name_uq` sobre la
            // columna generada `live_name_key`. Sin esta regla el choque llegaría
            // como un error 500 de integridad en vez de como un mensaje bajo el
            // campo.
            'name' => [
                'required', 'string', 'max:200',
                Rule::unique('factoring_companies', 'name')
                    ->where(fn ($q) => $q->where('tenant_id', $actor->tenantId)->whereNull('deleted_at'))
                    ->ignore($ignore),
            ],
            'website' => ['nullable', 'string', 'max:255', 'url'],
            'address_line1' => ['nullable', 'string', 'max:200'],
            'address_city' => ['nullable', 'string', 'max:120'],
            'address_state' => ['nullable', 'string', 'size:2'],
            'address_postal_code' => ['nullable', 'string', 'max:12'],
            'funding_instructions' => ['nullable', 'string', 'max:5000'],
            'active' => ['nullable', 'boolean'],

            'contacts' => ['nullable', 'array', 'max:50'],
            'contacts.*.id' => ['nullable', 'string', 'size:36'],
            'contacts.*.first_name' => ['required', 'string', 'max:100'],
            'contacts.*.last_name' => ['required', 'string', 'max:100'],
            'contacts.*.email' => ['nullable', 'email', 'max:255'],
            'contacts.*.phone' => ['nullable', 'string', 'max:32'],
            'contacts.*.position' => ['required', 'string', 'in:'.implode(',', FactoringContactPosition::values())],
            'contacts.*.notes' => ['nullable', 'string', 'max:2000'],
        ]);
    }

    /**
     * @param  array<string, mixed>  $data
     * @return array<string, mixed>
     */
    private function columns(array $data): array
    {
        return [
            'name' => $data['name'],
            'website' => $data['website'] ?? null,
            'address_line1' => $data['address_line1'] ?? null,
            'address_city' => $data['address_city'] ?? null,
            'address_state' => isset($data['address_state']) ? strtoupper((string) $data['address_state']) : null,
            'address_postal_code' => $data['address_postal_code'] ?? null,
            'funding_instructions' => $data['funding_instructions'] ?? null,
            // Sin decir nada, una empresa nueva está activa: se acaba de dar de
            // alta porque se va a usar.
            'active' => (bool) ($data['active'] ?? true),
        ];
    }

    /**
     * Deja los contactos exactamente como los mandó el formulario.
     *
     * Los que traen id se actualizan, los que no se crean, y los que ya no
     * vienen se borran en suave. No se borran de verdad: un contacto que
     * aparece en el historial de una carta de cesión tiene que poder seguir
     * nombrándose dentro de dos años.
     *
     * @param  list<array<string, mixed>>  $contacts
     */
    private function syncContacts(FactoringCompany $company, array $contacts, Actor $actor): void
    {
        $vistos = [];

        foreach ($contacts as $contact) {
            $id = $contact['id'] ?? null;

            $columnas = [
                'first_name' => trim((string) $contact['first_name']),
                'last_name' => trim((string) $contact['last_name']),
                'email' => $contact['email'] ?? null,
                'phone' => $contact['phone'] ?? null,
                'position' => $contact['position'],
                'notes' => $contact['notes'] ?? null,
                'updated_at' => now(),
            ];

            $existente = $id === null ? null : DB::table('factoring_company_contacts')
                ->where('tenant_id', $company->tenant_id)
                ->where('factoring_company_id', $company->id)
                ->where('id', $id)
                ->whereNull('deleted_at')
                ->first(['id']);

            if ($existente !== null) {
                DB::table('factoring_company_contacts')->where('id', $existente->id)->update($columnas);
                $vistos[] = (string) $existente->id;

                continue;
            }

            $nuevo = (string) Str::uuid();

            DB::table('factoring_company_contacts')->insert([
                ...$columnas,
                'id' => $nuevo,
                'tenant_id' => $company->tenant_id,
                'factoring_company_id' => $company->id,
                'created_at' => now(),
            ]);

            $vistos[] = $nuevo;
        }

        DB::table('factoring_company_contacts')
            ->where('tenant_id', $company->tenant_id)
            ->where('factoring_company_id', $company->id)
            ->whereNull('deleted_at')
            ->when($vistos !== [], fn ($q) => $q->whereNotIn('id', $vistos))
            ->update([
                'deleted_at' => now(),
                'deleted_by' => $actor->auditUserId(),
                'updated_at' => now(),
            ]);
    }

    /**
     * @return array<string, mixed>
     */
    private function row(FactoringCompany $c): array
    {
        return [
            'id' => (string) $c->id,
            'name' => (string) $c->name,
            'website' => $c->website,
            'addressLine1' => $c->address_line1,
            'addressCity' => $c->address_city,
            'addressState' => $c->address_state,
            'addressPostalCode' => $c->address_postal_code,
            'active' => (bool) $c->active,
        ];
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function contacts(FactoringCompany $company): array
    {
        return DB::table('factoring_company_contacts')
            ->where('tenant_id', $company->tenant_id)
            ->where('factoring_company_id', $company->id)
            ->whereNull('deleted_at')
            ->orderBy('last_name')
            ->orderBy('first_name')
            ->get(['id', 'first_name', 'last_name', 'email', 'phone', 'position', 'notes'])
            ->map(fn ($c): array => [
                'id' => (string) $c->id,
                'first_name' => (string) $c->first_name,
                'last_name' => (string) $c->last_name,
                'email' => $c->email,
                'phone' => $c->phone,
                'position' => (string) $c->position,
                'notes' => $c->notes,
            ])
            ->all();
    }

    /**
     * Los transportistas que trabajan con esta factoring.
     *
     * @return list<array<string, mixed>>
     */
    private function carriersUsing(Actor $actor, FactoringCompany $company): array
    {
        return DB::table('factoring_assignments as fa')
            ->join('carriers as c', 'c.id', '=', 'fa.carrier_id')
            ->where('fa.tenant_id', $actor->tenantId)
            ->where('fa.factoring_company_id', $company->id)
            ->whereNull('fa.deleted_at')
            ->whereNull('c.deleted_at')
            ->orderBy('c.legal_name')
            ->limit(100)
            ->get(['c.id', 'c.legal_name', 'c.dot_number', 'fa.verification_status'])
            ->map(fn ($r): array => [
                'id' => (string) $r->id,
                'name' => (string) $r->legal_name,
                'dot' => (string) $r->dot_number,
                'status' => (string) $r->verification_status,
            ])
            ->all();
    }

    /**
     * Cuántos contactos vivos tiene cada empresa de la página.
     *
     * El filtro por empresa cliente va aquí aunque los identificadores ya
     * vengan de una consulta acotada: una consulta que toca una tabla con
     * `tenant_id` y no lo filtra es una que mañana se copia a un sitio donde sí
     * importa.
     *
     * @param  list<string>  $ids
     * @return array<string, int>
     */
    private function contactCounts(Actor $actor, array $ids): array
    {
        if ($ids === []) {
            return [];
        }

        return DB::table('factoring_company_contacts')
            ->where('tenant_id', $actor->tenantId)
            ->whereIn('factoring_company_id', $ids)
            ->whereNull('deleted_at')
            ->groupBy('factoring_company_id')
            ->selectRaw('factoring_company_id as fid, count(*) as n')
            ->pluck('n', 'fid')
            ->map(fn ($n): int => (int) $n)
            ->all();
    }

    /**
     * @param  list<string>  $ids
     * @return array<string, int>
     */
    private function carrierCounts(Actor $actor, array $ids): array
    {
        if ($ids === []) {
            return [];
        }

        return DB::table('factoring_assignments')
            ->where('tenant_id', $actor->tenantId)
            ->whereIn('factoring_company_id', $ids)
            ->whereNull('deleted_at')
            ->groupBy('factoring_company_id')
            ->selectRaw('factoring_company_id as fid, count(*) as n')
            ->pluck('n', 'fid')
            ->map(fn ($n): int => (int) $n)
            ->all();
    }
}
