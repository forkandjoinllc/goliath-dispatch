<?php

declare(strict_types=1);

namespace App\Http\Controllers\App;

use App\Authorization\Actor;
use App\Authorization\CurrentActor;
use App\Authorization\PermissionChecker;
use App\Authorization\ResourceContext;
use App\Enums\AuditAction;
use App\Enums\Scope;
use App\Models\CarrierSettlement;
use App\Models\Load;
use App\Support\Audit;
use App\Support\Finance\SettlementBuilder;
use App\Support\InertiaPage;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Inertia\Inertia;
use Inertia\Response;

/**
 * Las liquidaciones al transportista.
 *
 * La otra cara de la factura: lo que se le PAGA por sus cargas, menos la tarifa
 * de despacho que se le cobra, menos sus descuentos, más lo que se le reembolsa.
 *
 * Las cifras salen de la instantánea congelada, no de un cálculo nuevo. Ver
 * SettlementBuilder — ahí está la razón, y no es un detalle de implementación.
 *
 * Igual que las facturas: una liquidación entregada no se edita. Se anula con
 * motivo y se hace otra.
 */
final class SettlementController
{
    use InertiaPage;

    private const PER_PAGE = 25;

    /** @var list<string> */
    private const STATUSES = ['draft', 'issued', 'paid', 'voided'];

    public function index(Request $request, CurrentActor $current, PermissionChecker $checker): Response
    {
        $actor = $current->require();
        $policy = $current->policy();
        $scope = $checker->authorize($actor, 'settlement:read', null, $policy);

        $this->usesDictionary($request, ['settlements', 'nav', 'common']);

        $filters = [
            'search' => trim((string) $request->query('search', '')),
            'status' => in_array($request->query('status'), self::STATUSES, true)
                ? (string) $request->query('status')
                : '',
        ];

        $query = $this->scoped($checker, $actor, $scope);

        if ($filters['search'] !== '') {
            $term = '%'.str_replace(['%', '_'], ['\%', '\_'], $filters['search']).'%';
            $query->where('carrier_settlements.settlement_number', 'like', $term);
        }

        if ($filters['status'] !== '') {
            $query->where('carrier_settlements.status', $filters['status']);
        }

        $page = $query
            ->orderByDesc('carrier_settlements.created_at')
            ->paginate(self::PER_PAGE)
            ->withQueryString();

        $nombres = $this->carrierNames($actor);

        return Inertia::render('App/Settlements/Index', [
            'settlements' => [
                'data' => collect($page->items())
                    ->map(fn (CarrierSettlement $s): array => [
                        ...$this->row($s),
                        'carrierName' => $nombres[(string) $s->carrier_id] ?? null,
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
            'totals' => $this->totals($this->scoped($checker, $actor, $scope), $filters),
            'can' => [
                'manage' => $checker->can($actor, 'settlement:manage', null, $policy)->allowed,
            ],
        ]);
    }

    public function create(Request $request, CurrentActor $current, PermissionChecker $checker): Response
    {
        $actor = $current->require();
        $checker->authorize($actor, 'settlement:manage', null, $current->policy());

        $this->usesDictionary($request, ['settlements', 'nav', 'common']);

        $carrierId = trim((string) $request->query('carrier', ''));

        return Inertia::render('App/Settlements/Create', [
            'carriers' => $this->carriersWithSettleableLoads($actor),
            'carrierId' => $carrierId === '' ? null : $carrierId,
            'loads' => $carrierId === '' ? [] : $this->settleableLoads($actor, $carrierId),
        ]);
    }

    public function store(
        Request $request,
        CurrentActor $current,
        PermissionChecker $checker,
        SettlementBuilder $builder,
    ): RedirectResponse {
        $actor = $current->require();
        $checker->authorize($actor, 'settlement:manage', null, $current->policy());

        $data = $request->validate([
            'carrier_id' => ['required', 'string', 'size:36'],
            'load_ids' => ['required', 'array', 'min:1', 'max:200'],
            'load_ids.*' => ['string', 'size:36'],
        ]);

        // Las cargas se vuelven a buscar por el camino acotado. Una carga de
        // otro transportista —o ya liquidada— enviada a mano no entra.
        $ids = $this->settleableQuery($actor, (string) $data['carrier_id'])
            ->whereIn('l.id', $data['load_ids'])
            ->pluck('l.id')
            ->all();

        if ($ids === []) {
            throw ValidationException::withMessages([
                'load_ids' => __('settlements.errors.nothingToSettle'),
            ]);
        }

        /** @var list<Load> $loads */
        $loads = Load::query()->whereIn('id', $ids)->get()->all();

        $settlementId = DB::transaction(
            fn (): string => $builder->fromLoads($actor, (string) $data['carrier_id'], $loads),
        );

        $model = CarrierSettlement::query()->findOrFail($settlementId);

        Audit::record(
            $actor,
            AuditAction::FinancialChanged,
            entityType: 'carrier_settlement',
            entityId: $settlementId,
            entityLabel: (string) $model->settlement_number,
            after: ['created' => true, 'loads' => count($loads), 'net_amount_cents' => (int) $model->net_amount_cents],
        );

        return redirect()
            ->route('settlements.show', $settlementId)
            ->with('success', __('settlements.flash.created', ['number' => $model->settlement_number]));
    }

    public function show(Request $request, string $settlement, CurrentActor $current, PermissionChecker $checker): Response
    {
        $actor = $current->require();
        $policy = $current->policy();
        $scope = $checker->authorize($actor, 'settlement:read', null, $policy);

        $model = $this->find($checker, $actor, $scope, $settlement);

        $this->usesDictionary($request, ['settlements', 'nav', 'common']);

        return Inertia::render('App/Settlements/Show', [
            'settlement' => [
                ...$this->row($model),
                'carrierName' => $this->carrierNames($actor)[(string) $model->carrier_id] ?? null,
                'factoringName' => $this->factoringName($actor, $model),
                'notes' => $model->notes,
                'lines' => $this->lines($model),
            ],
            'can' => [
                'manage' => $checker->can($actor, 'settlement:manage', $this->context($model), $policy)->allowed,
            ],
        ]);
    }

    /**
     * De borrador a entregada al transportista.
     */
    public function issue(string $settlement, CurrentActor $current, PermissionChecker $checker): RedirectResponse
    {
        $model = $this->manageable($settlement, $current, $checker);

        if ($model->status !== 'draft') {
            throw ValidationException::withMessages([
                'status' => __('settlements.errors.onlyDraftCanBeIssued'),
            ]);
        }

        $ahora = CarbonImmutable::now();

        DB::table('carrier_settlements')->where('id', $model->id)->update([
            'status' => 'issued',
            'issued_at' => $ahora,
            'updated_at' => $ahora,
        ]);

        $this->audit($current->require(), $model, ['status' => 'draft'], ['status' => 'issued']);

        return back()->with('success', __('settlements.flash.issued'));
    }

    /**
     * Marcar que se pagó.
     *
     * Aquí SÍ es un interruptor y no un importe, al revés que en las facturas:
     * una liquidación se paga entera de una vez, y si se pagó a medias es que
     * hay dos liquidaciones. El importe ya está congelado en la cabecera.
     */
    public function pay(Request $request, string $settlement, CurrentActor $current, PermissionChecker $checker): RedirectResponse
    {
        $model = $this->manageable($settlement, $current, $checker);

        if ($model->status !== 'issued') {
            throw ValidationException::withMessages([
                'status' => __('settlements.errors.onlyIssuedCanBePaid'),
            ]);
        }

        $data = $request->validate([
            'factoring_submitted' => ['boolean'],
        ]);

        $ahora = CarbonImmutable::now();

        DB::table('carrier_settlements')->where('id', $model->id)->update([
            'status' => 'paid',
            'paid_at' => $ahora,
            // La plataforma REGISTRA que se mandó al factoring; no manda nada.
            'factoring_submitted_at' => ($data['factoring_submitted'] ?? false) && $model->factoring_company_id !== null
                ? $ahora
                : $model->factoring_submitted_at,
            'updated_at' => $ahora,
        ]);

        $this->audit($current->require(), $model, ['status' => 'issued'], ['status' => 'paid']);

        return back()->with('success', __('settlements.flash.paid'));
    }

    public function void(Request $request, string $settlement, CurrentActor $current, PermissionChecker $checker): RedirectResponse
    {
        $model = $this->manageable($settlement, $current, $checker);

        if ($model->status === 'paid') {
            throw ValidationException::withMessages([
                'reason' => __('settlements.errors.cannotVoidPaid'),
            ]);
        }

        $data = $request->validate([
            'reason' => ['required', 'string', 'min:10', 'max:2000'],
        ]);

        $ahora = CarbonImmutable::now();

        DB::table('carrier_settlements')->where('id', $model->id)->update([
            'status' => 'voided',
            'deletion_reason' => $data['reason'],
            'updated_at' => $ahora,
        ]);

        $this->audit($current->require(), $model, ['status' => (string) $model->status], ['status' => 'voided'], $data['reason']);

        return back()->with('success', __('settlements.flash.voided'));
    }

    // ------------------------------------------------------------------ ayudas

    private function manageable(string $id, CurrentActor $current, PermissionChecker $checker): CarrierSettlement
    {
        $actor = $current->require();
        $policy = $current->policy();
        $scope = $checker->authorize($actor, 'settlement:read', null, $policy);
        $model = $this->find($checker, $actor, $scope, $id);

        $checker->authorize($actor, 'settlement:manage', $this->context($model), $policy);

        return $model;
    }

    /**
     * @param  array<string, mixed>  $before
     * @param  array<string, mixed>  $after
     */
    private function audit(Actor $actor, CarrierSettlement $s, array $before, array $after, ?string $reason = null): void
    {
        Audit::record(
            $actor,
            AuditAction::FinancialChanged,
            entityType: 'carrier_settlement',
            entityId: (string) $s->id,
            entityLabel: (string) $s->settlement_number,
            before: $before,
            after: $after,
            reason: $reason,
        );
    }

    /**
     * @return Builder<CarrierSettlement>
     */
    private function scoped(PermissionChecker $checker, Actor $actor, Scope $scope): Builder
    {
        // El rol transportista tiene `settlement:read` con alcance Carrier: aquí
        // eso es un filtro, no un 403. Que vea lo que se le paga es lo que debe
        // pasar.
        return $checker->scopeFilter($actor, $scope)->apply(
            CarrierSettlement::query()->where('carrier_settlements.tenant_id', $actor->tenantId),
            ['carrier' => 'carrier_id'],
        );
    }

    private function find(PermissionChecker $checker, Actor $actor, Scope $scope, string $id): CarrierSettlement
    {
        $s = $this->scoped($checker, $actor, $scope)->whereKey($id)->first();

        abort_if($s === null, 404);

        return $s;
    }

    private function context(CarrierSettlement $s): ResourceContext
    {
        return new ResourceContext(tenantId: $s->tenant_id, carrierId: $s->carrier_id);
    }

    /**
     * @return array<string, mixed>
     */
    private function row(CarrierSettlement $s): array
    {
        return [
            'id' => (string) $s->id,
            'number' => (string) $s->settlement_number,
            'carrierId' => (string) $s->carrier_id,
            // (string) y no ->value: OJO, CarrierSettlement NO castea `status`
            // a enum —Invoice sí—, así que aquí llega una cadena. Los dos
            // modelos del mismo dominio no se parecen tanto como aparentan.
            'status' => (string) $s->status,
            'grossRateCents' => (int) $s->gross_rate_cents,
            'reimbursementsCents' => (int) $s->reimbursements_cents,
            'dispatchFeesCents' => (int) $s->dispatch_fees_cents,
            'deductionsCents' => (int) $s->deductions_cents,
            'netAmountCents' => (int) $s->net_amount_cents,
            'periodStart' => $s->period_start?->toDateString(),
            'periodEnd' => $s->period_end?->toDateString(),
            'issuedAt' => $s->issued_at?->toIso8601String(),
            'paidAt' => $s->paid_at?->toIso8601String(),
            'factoringCompanyId' => $s->factoring_company_id === null ? null : (string) $s->factoring_company_id,
            'factoringSubmittedAt' => $s->factoring_submitted_at?->toIso8601String(),
        ];
    }

    /**
     * @return array<string, string>
     */
    private function carrierNames(Actor $actor): array
    {
        return DB::table('carriers')
            ->where('tenant_id', $actor->tenantId)
            ->whereNull('deleted_at')
            ->pluck('legal_name', 'id')
            ->map(fn ($n): string => (string) $n)
            ->all();
    }

    private function factoringName(Actor $actor, CarrierSettlement $s): ?string
    {
        if ($s->factoring_company_id === null) {
            return null;
        }

        $n = DB::table('factoring_companies')
            ->where('tenant_id', $actor->tenantId)
            ->where('id', $s->factoring_company_id)
            ->value('name');

        return $n === null ? null : (string) $n;
    }

    /**
     * @param  Builder<CarrierSettlement>  $query
     * @param  array<string, string>  $filters
     * @return array<string, int>
     */
    private function totals(Builder $query, array $filters): array
    {
        if ($filters['status'] !== '') {
            $query->where('carrier_settlements.status', $filters['status']);
        }

        $fila = $query
            ->selectRaw('coalesce(sum(net_amount_cents), 0) as neto, coalesce(sum(dispatch_fees_cents), 0) as tarifas')
            ->reorder()
            ->first();

        return [
            'netCents' => (int) ($fila->neto ?? 0),
            'dispatchFeesCents' => (int) ($fila->tarifas ?? 0),
        ];
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function lines(CarrierSettlement $s): array
    {
        return DB::table('carrier_settlement_lines as sl')
            ->leftJoin('loads as l', 'l.id', '=', 'sl.load_id')
            ->where('sl.tenant_id', $s->tenant_id)
            ->where('sl.settlement_id', $s->id)
            ->whereNull('sl.deleted_at')
            ->orderBy('sl.created_at')
            ->get([
                'sl.id', 'sl.description_en', 'sl.description_es', 'sl.gross_rate_cents',
                'sl.reimbursements_cents', 'sl.dispatch_fee_cents', 'sl.deductions_cents',
                'sl.net_cents', 'sl.load_id', 'l.load_number',
            ])
            ->map(fn ($l): array => [
                'id' => (string) $l->id,
                'descriptionEn' => (string) $l->description_en,
                'descriptionEs' => $l->description_es,
                'grossRateCents' => (int) $l->gross_rate_cents,
                'reimbursementsCents' => (int) $l->reimbursements_cents,
                'dispatchFeeCents' => (int) $l->dispatch_fee_cents,
                'deductionsCents' => (int) $l->deductions_cents,
                'netCents' => (int) $l->net_cents,
                'loadId' => $l->load_id === null ? null : (string) $l->load_id,
                'loadNumber' => $l->load_number,
            ])
            ->all();
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function carriersWithSettleableLoads(Actor $actor): array
    {
        return DB::table('carriers as c')
            ->where('c.tenant_id', $actor->tenantId)
            ->whereNull('c.deleted_at')
            ->whereExists(function ($q) use ($actor): void {
                $q->select(DB::raw(1))
                    ->from('loads as l')
                    ->whereColumn('l.carrier_id', 'c.id')
                    ->where('l.tenant_id', $actor->tenantId)
                    ->whereNull('l.deleted_at')
                    ->where('l.status', 'delivered')
                    ->whereNotExists(fn ($sub) => $this->settledExists($sub, $actor));
            })
            ->orderBy('c.legal_name')
            ->get(['c.id', 'c.legal_name'])
            ->map(fn ($c): array => ['id' => (string) $c->id, 'name' => (string) $c->legal_name])
            ->all();
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function settleableLoads(Actor $actor, string $carrierId): array
    {
        return $this->settleableQuery($actor, $carrierId)
            ->orderBy('l.actual_delivery_at')
            ->limit(200)
            ->get(['l.id', 'l.load_number', 'l.commodity', 'l.actual_delivery_at', 'l.carrier_gross_rate_cents'])
            ->map(fn ($l): array => [
                'id' => (string) $l->id,
                'number' => (string) $l->load_number,
                'commodity' => $l->commodity,
                'deliveredAt' => $l->actual_delivery_at,
                // Lo bruto de la carga. El neto lo calcula el servidor con la
                // instantánea congelada, que puede llevar gastos y descuentos.
                'grossRateCents' => (int) $l->carrier_gross_rate_cents,
            ])
            ->all();
    }

    private function settleableQuery(Actor $actor, string $carrierId): \Illuminate\Database\Query\Builder
    {
        return DB::table('loads as l')
            ->where('l.tenant_id', $actor->tenantId)
            ->where('l.carrier_id', $carrierId)
            ->whereNull('l.deleted_at')
            ->where('l.status', 'delivered')
            ->whereNotExists(fn ($q) => $this->settledExists($q, $actor));
    }

    /**
     * Esta carga ya está en una liquidación VIVA (no anulada).
     *
     * Igual que con las facturas: no hay columna «liquidada» en `loads`. Una
     * columna paralela se desincroniza en cuanto se anula algo.
     */
    private function settledExists(\Illuminate\Database\Query\Builder $q, Actor $actor): void
    {
        $q->select(DB::raw(1))
            ->from('carrier_settlement_lines as sl')
            ->join('carrier_settlements as s', 's.id', '=', 'sl.settlement_id')
            ->whereColumn('sl.load_id', 'l.id')
            ->where('sl.tenant_id', $actor->tenantId)
            ->whereNull('sl.deleted_at')
            ->whereNull('s.deleted_at')
            ->where('s.status', '!=', 'voided');
    }
}
