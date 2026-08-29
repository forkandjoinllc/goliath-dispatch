<?php

declare(strict_types=1);

namespace App\Http\Controllers\App;

use App\Authorization\Actor;
use App\Authorization\CurrentActor;
use App\Authorization\PermissionChecker;
use App\Authorization\ResourceContext;
use App\Enums\AuditAction;
use App\Enums\Scope;
use App\Models\Expense;
use App\Models\Load;
use App\Support\Audit;
use App\Support\InertiaPage;
use App\Support\Loads\LoadScope;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Inertia\Inertia;
use Inertia\Response;

/**
 * Los gastos de una carga.
 *
 * ESTO NO ES UN LISTADO MÁS: es la mitad que le faltaba al cálculo del dinero.
 * `LoadCalculator` ya buscaba gastos APROBADOS agrupados por tratamiento; sin
 * pantalla para darlos de alta, esos cuatro cubos salían siempre en cero y cada
 * factura y cada liquidación se calculaba con medio dato.
 *
 * El tratamiento lo pone la CATEGORÍA y se COPIA al gasto
 * (`expenses.treatment_snapshot`) al darlo de alta. Cambiar mañana el
 * tratamiento de «combustible» no puede reescribir una liquidación cerrada.
 *
 * Un gasto solo cuenta cuando está `approved` o `reimbursed`. Presentarlo no
 * mueve un céntimo: alguien con `expense:approve` tiene que mirarlo.
 */
final class ExpenseController
{
    use InertiaPage;

    private const PER_PAGE = 25;

    /** @var list<string> */
    private const STATUSES = ['submitted', 'approved', 'rejected', 'reimbursed'];

    public function index(Request $request, CurrentActor $current, PermissionChecker $checker): Response|RedirectResponse
    {
        $actor = $current->require();
        $policy = $current->policy();

        // Un conductor tiene `expense:submit` pero NO `expense:read`: puede
        // entregar el recibo del combustible y no puede ver los gastos de nadie.
        // El menú le enseña «Gastos» porque basta un permiso de la entrada, así
        // que sin esto el enlace le contestaría 403 — el enlace roto que
        // `Navigation` existe para evitar. Se le lleva al formulario, que es lo
        // único que este dominio le ofrece.
        if (! $checker->can($actor, 'expense:read', null, $policy)->allowed) {
            return redirect()->route('expenses.create');
        }

        $scope = $checker->authorize($actor, 'expense:read', null, $policy);

        $this->usesDictionary($request, ['expenses', 'nav', 'common']);

        $filters = [
            'status' => in_array($request->query('status'), self::STATUSES, true)
                ? (string) $request->query('status')
                : '',
            'load' => trim((string) $request->query('load', '')),
        ];

        $query = $this->scoped($checker, $actor, $scope);

        if ($filters['status'] !== '') {
            $query->where('expenses.status', $filters['status']);
        }

        if ($filters['load'] !== '') {
            $term = '%'.str_replace(['%', '_'], ['\%', '\_'], $filters['load']).'%';
            $query->whereExists(fn ($q) => $q->select(DB::raw(1))
                ->from('loads')
                ->whereColumn('loads.id', 'expenses.load_id')
                ->where('loads.load_number', 'like', $term));
        }

        $page = $query
            ->orderByDesc('expenses.created_at')
            ->paginate(self::PER_PAGE)
            ->withQueryString();

        $ids = collect($page->items())->map(fn (Expense $e): string => (string) $e->id)->all();
        $extra = $this->context($actor, $ids);

        return Inertia::render('App/Expenses/Index', [
            'expenses' => [
                'data' => collect($page->items())
                    ->map(fn (Expense $e): array => [
                        ...$this->row($e),
                        ...($extra[(string) $e->id] ?? []),
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
            'statuses' => self::STATUSES,
            // Lo que de verdad importa de un listado de gastos: cuánto hay
            // esperando a que alguien lo mire, y cuánto ya cuenta en el dinero.
            'totals' => $this->totals($this->scoped($checker, $actor, $scope)),
            'can' => [
                'submit' => $checker->can($actor, 'expense:submit', null, $policy)->allowed,
                'approve' => $checker->can($actor, 'expense:approve', null, $policy)->allowed,
            ],
        ]);
    }

    public function create(Request $request, CurrentActor $current, PermissionChecker $checker): Response
    {
        $actor = $current->require();
        $checker->authorize($actor, 'expense:submit', null, $current->policy());

        $this->usesDictionary($request, ['expenses', 'nav', 'common']);

        // `loadFrozen` llega por recarga parcial cuando se elige carga. No se
        // manda un mapa de todas: una empresa con mil cargas mandaría kilos de
        // JSON para usar una fila.
        //
        // Se contesta solo por cargas que este actor puede ver. Contestar por
        // cualquier id de la empresa convertiría esta recarga en un oráculo:
        // probando ids se sabría qué cargas existen y cuáles están facturadas.
        $elegida = trim((string) $request->query('load_id', ''));
        $visible = $elegida !== ''
            && $this->scopedLoads($actor, $checker, $current)?->whereKey($elegida)->exists() === true;

        return Inertia::render('App/Expenses/Form', [
            'categories' => $this->categories($actor),
            'loads' => $this->openLoads($actor, $checker, $current),
            'loadFrozen' => $visible && $this->alreadyFrozen($actor, $elegida),
        ]);
    }

    public function store(Request $request, CurrentActor $current, PermissionChecker $checker): RedirectResponse
    {
        $actor = $current->require();
        $checker->authorize($actor, 'expense:submit', null, $current->policy());

        $data = $request->validate([
            'load_id' => ['required', 'string', 'size:36'],
            'category_id' => ['required', 'string', 'size:36'],
            // En centavos y entero, igual que la columna. Nada de flotantes
            // para representar dinero.
            'amount_cents' => ['required', 'integer', 'min:1', 'max:99999999999'],
            'incurred_on' => ['nullable', 'date'],
            'description' => ['nullable', 'string', 'max:2000'],
        ]);

        // Se busca por la consulta ESTRECHADA. Comprobar solo la empresa dejaría
        // que un conductor le colgara un gasto a una carga que no lleva con solo
        // cambiar el id en la petición; el formulario no se lo ofrece, pero el
        // formulario no es quien decide.
        $consulta = $this->scopedLoads($actor, $checker, $current);

        $load = $consulta?->whereKey($data['load_id'])->first(['loads.id', 'loads.carrier_id', 'loads.load_number']);

        if ($load === null) {
            throw ValidationException::withMessages(['load_id' => __('expenses.errors.loadNotFound')]);
        }

        $categoria = DB::table('expense_categories')
            ->where('tenant_id', $actor->tenantId)
            ->where('id', $data['category_id'])
            ->whereNull('deleted_at')
            ->where('active', true)
            ->first(['id', 'treatment', 'label_en']);

        if ($categoria === null) {
            throw ValidationException::withMessages(['category_id' => __('expenses.errors.categoryNotFound')]);
        }

        $ahora = CarbonImmutable::now();
        $id = (string) Str::uuid();

        DB::table('expenses')->insert([
            'id' => $id,
            'tenant_id' => $actor->tenantId,
            'load_id' => $load->id,
            // Se copia de la carga para que el estrechamiento por ámbito
            // funcione sin tener que pasar por `loads` en cada consulta.
            'carrier_id' => $load->carrier_id,
            'category_id' => $categoria->id,
            // El tratamiento se CONGELA aquí. Ver la cabecera de la clase.
            'treatment_snapshot' => $categoria->treatment,
            'amount_cents' => (int) $data['amount_cents'],
            'description' => $data['description'] ?? null,
            'incurred_on' => $data['incurred_on'] ?? null,
            // Nace presentado, nunca aprobado, diga lo que diga el formulario.
            'status' => 'submitted',
            'submitted_by_user_id' => $actor->auditUserId(),
            'created_at' => $ahora,
            'updated_at' => $ahora,
        ]);

        Audit::record(
            $actor,
            AuditAction::FinancialChanged,
            entityType: 'expense',
            entityId: $id,
            entityLabel: (string) $load->load_number,
            after: ['status' => 'submitted', 'amount_cents' => (int) $data['amount_cents']],
        );

        // Mismo motivo: a quien no puede leer el listado se le devuelve al
        // formulario, en blanco y listo para el siguiente recibo.
        $destino = $checker->can($actor, 'expense:read', null, $current->policy())->allowed
            ? 'expenses.index'
            : 'expenses.create';

        return redirect()
            ->route($destino)
            ->with('success', __('expenses.flash.submitted'));
    }

    public function approve(string $expense, CurrentActor $current, PermissionChecker $checker): RedirectResponse
    {
        return $this->decide($expense, $current, $checker, 'approved', null);
    }

    public function reject(Request $request, string $expense, CurrentActor $current, PermissionChecker $checker): RedirectResponse
    {
        $data = $request->validate([
            'reason' => ['required', 'string', 'min:5', 'max:2000'],
        ]);

        return $this->decide($expense, $current, $checker, 'rejected', $data['reason']);
    }

    /**
     * Marcar que ya se le reembolsó al transportista.
     *
     * `reimbursed` sigue contando en el cálculo igual que `approved`: es un
     * aprobado que además ya se pagó.
     */
    public function reimburse(string $expense, CurrentActor $current, PermissionChecker $checker): RedirectResponse
    {
        return $this->decide($expense, $current, $checker, 'reimbursed', null);
    }

    // ------------------------------------------------------------------ ayudas

    private function decide(
        string $id,
        CurrentActor $current,
        PermissionChecker $checker,
        string $nuevo,
        ?string $motivo,
    ): RedirectResponse {
        $actor = $current->require();
        $policy = $current->policy();
        $scope = $checker->authorize($actor, 'expense:read', null, $policy);
        $model = $this->find($checker, $actor, $scope, $id);

        $checker->authorize($actor, 'expense:approve', $this->resourceContext($model), $policy);

        // `$model->status` viene CASTEADO al enum ExpenseStatus, así que
        // compararlo con la cadena 'submitted' es siempre falso y todas las
        // decisiones se rechazaban con «badTransition». Se compara por ->value.
        $actual = $model->status->value;

        $permitido = match ($nuevo) {
            'approved', 'rejected' => $actual === 'submitted',
            'reimbursed' => $actual === 'approved',
            default => false,
        };

        if (! $permitido) {
            throw ValidationException::withMessages([
                'status' => __('expenses.errors.badTransition'),
            ]);
        }

        $ahora = CarbonImmutable::now();
        $antes = $actual;

        DB::table('expenses')->where('id', $model->id)->update([
            'status' => $nuevo,
            'reviewed_by_user_id' => $actor->auditUserId(),
            'reviewed_at' => $ahora,
            'rejection_reason' => $nuevo === 'rejected' ? $motivo : null,
            'updated_at' => $ahora,
        ]);

        Audit::record(
            $actor,
            AuditAction::FinancialChanged,
            entityType: 'expense',
            entityId: (string) $model->id,
            entityLabel: (string) $model->id,
            before: ['status' => $antes],
            after: ['status' => $nuevo],
            reason: $motivo,
        );

        // Si la carga ya está facturada o liquidada, este gasto NO cambia esos
        // documentos: sus cifras están congeladas en `financial_snapshots`. Se
        // dice claramente en vez de dejar que alguien lo descubra cuadrando.
        $congelada = $nuevo !== 'rejected' && $this->alreadyFrozen($actor, (string) $model->load_id);

        return back()->with(
            'success',
            $congelada ? __('expenses.flash.decidedButFrozen') : __('expenses.flash.decided'),
        );
    }

    /**
     * @return Builder<Expense>
     */
    private function scoped(PermissionChecker $checker, Actor $actor, Scope $scope): Builder
    {
        // `expenses` lleva `carrier_id` copiado de la carga, así que el
        // transportista y el despachador con transportistas asignados se
        // resuelven con una columna. `owner` es quien lo presentó.
        return $checker->scopeFilter($actor, $scope)->apply(
            Expense::query()->where('expenses.tenant_id', $actor->tenantId),
            ['carrier' => 'carrier_id', 'owner' => 'submitted_by_user_id'],
        );
    }

    private function find(PermissionChecker $checker, Actor $actor, Scope $scope, string $id): Expense
    {
        $e = $this->scoped($checker, $actor, $scope)->whereKey($id)->first();

        abort_if($e === null, 404);

        return $e;
    }

    private function resourceContext(Expense $e): ResourceContext
    {
        return new ResourceContext(
            tenantId: $e->tenant_id,
            carrierId: $e->carrier_id,
            ownerUserId: $e->submitted_by_user_id,
        );
    }

    /**
     * ¿La carga de este gasto ya tiene una instantánea congelada?
     */
    private function alreadyFrozen(Actor $actor, string $loadId): bool
    {
        if ($loadId === '') {
            return false;
        }

        return DB::table('financial_snapshots')
            ->where('tenant_id', $actor->tenantId)
            ->where('load_id', $loadId)
            ->exists();
    }

    /**
     * @return array<string, mixed>
     */
    private function row(Expense $e): array
    {
        return [
            'id' => (string) $e->id,
            'loadId' => $e->load_id === null ? null : (string) $e->load_id,
            'amountCents' => (int) $e->amount_cents,
            // ->value y no (string): las dos columnas están CASTEADAS a enum en
            // el modelo, y convertir un enum a cadena con (string) es un Error
            // en tiempo de ejecución, no un aviso. Reventaba la pantalla entera
            // en cuanto había un solo gasto que enseñar.
            'treatment' => $e->treatment_snapshot->value,
            'status' => $e->status->value,
            'description' => $e->description,
            'incurredOn' => $e->incurred_on?->toDateString(),
            'rejectionReason' => $e->rejection_reason,
        ];
    }

    /**
     * Nombre de carga, categoría y si su carga ya está congelada, para toda la
     * página de una vez.
     *
     * @param  list<string>  $ids
     * @return array<string, array<string, mixed>>
     */
    private function context(Actor $actor, array $ids): array
    {
        if ($ids === []) {
            return [];
        }

        $filas = DB::table('expenses as e')
            ->leftJoin('loads as l', 'l.id', '=', 'e.load_id')
            ->leftJoin('expense_categories as c', 'c.id', '=', 'e.category_id')
            ->where('e.tenant_id', $actor->tenantId)
            ->whereIn('e.id', $ids)
            ->get(['e.id', 'l.load_number', 'c.label_en', 'c.label_es', 'e.load_id']);

        $congeladas = DB::table('financial_snapshots')
            ->where('tenant_id', $actor->tenantId)
            ->whereIn('load_id', $filas->pluck('load_id')->filter()->all())
            ->distinct()
            ->pluck('load_id')
            ->all();

        $salida = [];

        foreach ($filas as $f) {
            $salida[(string) $f->id] = [
                'loadNumber' => $f->load_number,
                'categoryEn' => $f->label_en,
                'categoryEs' => $f->label_es,
                'loadFrozen' => $f->load_id !== null && in_array($f->load_id, $congeladas, true),
            ];
        }

        return $salida;
    }

    /**
     * @param  Builder<Expense>  $query
     * @return array<string, int>
     */
    private function totals(Builder $query): array
    {
        $filas = $query
            ->selectRaw('status, coalesce(sum(amount_cents), 0) as total')
            ->groupBy('status')
            ->reorder()
            ->pluck('total', 'status');

        return [
            'pendingCents' => (int) ($filas['submitted'] ?? 0),
            // `reimbursed` es un aprobado que además ya se pagó: cuenta igual.
            'countingCents' => (int) ($filas['approved'] ?? 0) + (int) ($filas['reimbursed'] ?? 0),
        ];
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function categories(Actor $actor): array
    {
        return DB::table('expense_categories')
            ->where('tenant_id', $actor->tenantId)
            ->whereNull('deleted_at')
            ->where('active', true)
            ->orderBy('sort_order')
            ->get(['id', 'label_en', 'label_es', 'treatment', 'requires_receipt'])
            ->map(fn ($c): array => [
                'id' => (string) $c->id,
                'labelEn' => (string) $c->label_en,
                'labelEs' => (string) $c->label_es,
                // Se enseña qué le hace al dinero. Elegir «reparación» cuando se
                // quería «combustible» cambia quién paga, y eso no debería
                // descubrirse en la liquidación.
                'treatment' => (string) $c->treatment,
            ])
            ->all();
    }

    /**
     * Las cargas que este actor puede ver, ya estrechadas.
     *
     * Devuelve null cuando no puede ver ninguna, que no es lo mismo que una
     * consulta vacía: quien no tiene `load:read` no debería llegar a preguntar.
     *
     * @return Builder<Load>|null
     */
    private function scopedLoads(Actor $actor, PermissionChecker $checker, CurrentActor $current): ?Builder
    {
        $lectura = $checker->can($actor, 'load:read', null, $current->policy());
        $scope = $lectura->scope;

        if (! $lectura->allowed || $scope === null) {
            return null;
        }

        return LoadScope::apply(
            Load::query()->where('loads.tenant_id', $actor->tenantId),
            $checker,
            $actor,
            $scope,
        );
    }

    /**
     * Cargas a las que se le puede colgar un gasto.
     *
     * ESTRECHADA POR ÁMBITO, y no por empresa a secas. Un desplegable sin
     * filtrar le enseñaría a un conductor los números de carga de toda la
     * oficina y a un transportista los de sus competidores — una fuga que no
     * hace falta ni pulsar nada para provocar. Se pasa por `LoadScope` porque el
     * conductor llega a sus cargas por `load_assignments` y eso no es una
     * columna.
     *
     * @return list<array<string, mixed>>
     */
    private function openLoads(Actor $actor, PermissionChecker $checker, CurrentActor $current): array
    {
        $query = $this->scopedLoads($actor, $checker, $current);

        if ($query === null) {
            return [];
        }

        return $query
            ->whereNotIn('loads.status', ['cancelled'])
            ->orderByDesc('loads.created_at')
            ->limit(300)
            ->get(['loads.id', 'loads.load_number', 'loads.commodity'])
            ->map(fn (Load $l): array => [
                'id' => (string) $l->id,
                'name' => (string) $l->load_number,
                'hint' => $l->commodity,
            ])
            ->all();
    }
}
