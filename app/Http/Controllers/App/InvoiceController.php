<?php

declare(strict_types=1);

namespace App\Http\Controllers\App;

use App\Authorization\Actor;
use App\Authorization\CurrentActor;
use App\Authorization\PermissionChecker;
use App\Authorization\ResourceContext;
use App\Enums\AuditAction;
use App\Models\Invoice;
use App\Models\Load;
use App\Support\Audit;
use App\Support\Finance\InvoiceBuilder;
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
 * Las facturas de la casa de despacho al transportista.
 *
 * Lo que se factura es la TARIFA DE DESPACHO. El cliente lo factura el
 * transportista; nosotros le cobramos a él nuestro porcentaje. Por eso
 * `invoices.carrier_id` es obligatorio en el esquema.
 *
 * Tres cosas que rigen todo lo de abajo:
 *
 *  • **Una factura emitida no se toca.** Se anula y se hace otra. Corregir
 *    importes de una factura que ya salió por correo es la manera de que dos
 *    partes tengan dos versiones del mismo documento.
 *  • **Los números se congelan al facturar**, en `financial_snapshots`. Ver
 *    InvoiceBuilder.
 *  • **El transportista ve las suyas.** `invoice:read` se le concede con
 *    alcance Carrier, y aquí eso se traduce en un filtro, no en un 403: que un
 *    transportista vea lo que se le cobra es exactamente lo que debe pasar.
 */
final class InvoiceController
{
    use InertiaPage;

    private const PER_PAGE = 25;

    public function index(Request $request, CurrentActor $current, PermissionChecker $checker): Response
    {
        $actor = $current->require();
        $policy = $current->policy();
        $scope = $checker->authorize($actor, 'invoice:read', null, $policy);

        $this->usesDictionary($request, ['invoices', 'nav', 'common']);

        $filters = [
            'search' => trim((string) $request->query('search', '')),
            'status' => in_array($request->query('status'), self::STATUSES, true)
                ? (string) $request->query('status')
                : '',
        ];

        $query = $this->scoped($checker, $actor, $scope);

        if ($filters['search'] !== '') {
            $term = '%'.str_replace(['%', '_'], ['\%', '\_'], $filters['search']).'%';
            $query->where(fn (Builder $q) => $q->where('invoices.invoice_number', 'like', $term));
        }

        if ($filters['status'] !== '') {
            $query->where('invoices.status', $filters['status']);
        }

        $page = $query
            ->orderByDesc('invoices.created_at')
            ->paginate(self::PER_PAGE)
            ->withQueryString();

        $ids = collect($page->items())->map(fn (Invoice $i): string => (string) $i->id)->all();
        $nombres = $this->carrierNames($actor, $ids);

        return Inertia::render('App/Invoices/Index', [
            'invoices' => [
                'data' => collect($page->items())
                    ->map(fn (Invoice $i): array => [
                        ...$this->row($i),
                        'carrierName' => $nombres[(string) $i->carrier_id] ?? null,
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
            // Los totales se calculan sobre TODO el filtro, no sobre la página.
            // Una suma que cambia al pasar de página no es una suma.
            'totals' => $this->totals($this->scoped($checker, $actor, $scope), $filters),
            'can' => [
                'create' => $checker->can($actor, 'invoice:create', null, $policy)->allowed,
            ],
        ]);
    }

    /**
     * Elegir transportista y marcar qué cargas entran.
     */
    public function create(Request $request, CurrentActor $current, PermissionChecker $checker): Response
    {
        $actor = $current->require();
        $checker->authorize($actor, 'invoice:create', null, $current->policy());

        $this->usesDictionary($request, ['invoices', 'nav', 'common']);

        $carrierId = trim((string) $request->query('carrier', ''));

        return Inertia::render('App/Invoices/Create', [
            'carriers' => $this->carriersWithBillableLoads($actor),
            'carrierId' => $carrierId === '' ? null : $carrierId,
            'loads' => $carrierId === '' ? [] : $this->billableLoads($actor, $carrierId),
        ]);
    }

    public function store(
        Request $request,
        CurrentActor $current,
        PermissionChecker $checker,
        InvoiceBuilder $builder,
    ): RedirectResponse {
        $actor = $current->require();
        $checker->authorize($actor, 'invoice:create', null, $current->policy());

        $data = $request->validate([
            'carrier_id' => ['required', 'string', 'size:36'],
            'load_ids' => ['required', 'array', 'min:1', 'max:200'],
            'load_ids.*' => ['string', 'size:36'],
            'payment_terms_days' => ['nullable', 'integer', 'min:0', 'max:365'],
        ]);

        // Las cargas se vuelven a buscar por el camino acotado, no se fían del
        // formulario: una carga de otro transportista —o ya facturada— enviada
        // a mano no puede colarse en una factura.
        $loads = $this->billableLoadModels($actor, (string) $data['carrier_id'], $data['load_ids']);

        if ($loads === []) {
            throw ValidationException::withMessages([
                'load_ids' => __('invoices.errors.nothingToBill'),
            ]);
        }

        $invoiceId = DB::transaction(fn (): string => $builder->fromLoads(
            $actor,
            (string) $data['carrier_id'],
            $loads,
            (int) ($data['payment_terms_days'] ?? 30),
        ));

        $invoice = Invoice::query()->findOrFail($invoiceId);

        Audit::record(
            $actor,
            AuditAction::FinancialChanged,
            entityType: 'invoice',
            entityId: $invoiceId,
            entityLabel: (string) $invoice->invoice_number,
            after: ['created' => true, 'loads' => count($loads), 'total_cents' => (int) $invoice->total_cents],
        );

        return redirect()
            ->route('invoices.show', $invoiceId)
            ->with('success', __('invoices.flash.created', ['number' => $invoice->invoice_number]));
    }

    public function show(Request $request, string $invoice, CurrentActor $current, PermissionChecker $checker): Response
    {
        $actor = $current->require();
        $policy = $current->policy();
        $scope = $checker->authorize($actor, 'invoice:read', null, $policy);

        $model = $this->find($checker, $actor, $scope, $invoice);

        $this->usesDictionary($request, ['invoices', 'nav', 'common']);

        return Inertia::render('App/Invoices/Show', [
            'invoice' => [
                ...$this->row($model),
                'carrierName' => $this->carrierNames($actor, [(string) $model->id])[(string) $model->carrier_id] ?? null,
                'notes' => $model->notes,
                'voidReason' => $model->void_reason,
                'lines' => $this->lines($model),
            ],
            'can' => [
                'send' => $checker->can($actor, 'invoice:send', $this->context($model), $policy)->allowed,
                'pay' => $checker->can($actor, 'invoice:pay', $this->context($model), $policy)->allowed,
                'changeStatus' => $checker->can($actor, 'invoice:status:update', $this->context($model), $policy)->allowed,
            ],
        ]);
    }

    /**
     * De borrador a enviada. Aquí es donde nacen las fechas.
     */
    public function send(string $invoice, CurrentActor $current, PermissionChecker $checker): RedirectResponse
    {
        $actor = $current->require();
        $policy = $current->policy();
        $scope = $checker->authorize($actor, 'invoice:read', null, $policy);
        $model = $this->find($checker, $actor, $scope, $invoice);

        $checker->authorize($actor, 'invoice:send', $this->context($model), $policy);

        if ($model->status !== 'draft') {
            throw ValidationException::withMessages([
                'status' => __('invoices.errors.onlyDraftCanBeSent'),
            ]);
        }

        $ahora = CarbonImmutable::now();

        DB::table('invoices')->where('id', $model->id)->update([
            'status' => 'sent',
            'issue_date' => $ahora,
            // El vencimiento se calcula al EMITIR, no al crear: los días de
            // pago cuentan desde que la factura sale, no desde que alguien
            // empezó a prepararla.
            'due_date' => $ahora->addDays((int) $model->payment_terms_days),
            'sent_at' => $ahora,
            'updated_at' => $ahora,
        ]);

        Audit::record(
            $actor,
            AuditAction::FinancialChanged,
            entityType: 'invoice',
            entityId: (string) $model->id,
            entityLabel: (string) $model->invoice_number,
            before: ['status' => 'draft'],
            after: ['status' => 'sent', 'due_date' => $ahora->addDays((int) $model->payment_terms_days)->toDateString()],
        );

        return back()->with('success', __('invoices.flash.sent'));
    }

    /**
     * Anotar un cobro.
     *
     * Se anota lo COBRADO y se recalcula el saldo; no se marca «pagada» a mano.
     * Un botón de «marcar como pagada» sin importe deja facturas cuadradas en la
     * pantalla y descuadradas en el banco.
     */
    public function pay(Request $request, string $invoice, CurrentActor $current, PermissionChecker $checker): RedirectResponse
    {
        $actor = $current->require();
        $policy = $current->policy();
        $scope = $checker->authorize($actor, 'invoice:read', null, $policy);
        $model = $this->find($checker, $actor, $scope, $invoice);

        $checker->authorize($actor, 'invoice:pay', $this->context($model), $policy);

        if (in_array($model->status, ['draft', 'voided'], true)) {
            throw ValidationException::withMessages([
                'amount_cents' => __('invoices.errors.cannotPayThis'),
            ]);
        }

        $data = $request->validate([
            'amount_cents' => ['required', 'integer', 'min:1'],
        ]);

        $cobrado = (int) $model->amount_paid_cents + (int) $data['amount_cents'];

        if ($cobrado > (int) $model->total_cents) {
            throw ValidationException::withMessages([
                'amount_cents' => __('invoices.errors.overpaid'),
            ]);
        }

        $ahora = CarbonImmutable::now();
        $saldo = (int) $model->total_cents - $cobrado;

        DB::table('invoices')->where('id', $model->id)->update([
            'amount_paid_cents' => $cobrado,
            'balance_cents' => $saldo,
            'status' => $saldo === 0 ? 'paid' : $model->status,
            'paid_at' => $saldo === 0 ? $ahora : null,
            'updated_at' => $ahora,
        ]);

        Audit::record(
            $actor,
            AuditAction::FinancialChanged,
            entityType: 'invoice',
            entityId: (string) $model->id,
            entityLabel: (string) $model->invoice_number,
            before: ['amount_paid_cents' => (int) $model->amount_paid_cents],
            after: ['amount_paid_cents' => $cobrado, 'balance_cents' => $saldo],
        );

        return back()->with('success', __('invoices.flash.paid'));
    }

    /**
     * Anular. NO borrar.
     *
     * Una factura que salió existe aunque estuviera mal. Se anula con motivo y
     * se emite otra; las cargas vuelven a quedar facturables porque lo
     * facturado se mira en las líneas de facturas VIVAS.
     */
    public function void(Request $request, string $invoice, CurrentActor $current, PermissionChecker $checker): RedirectResponse
    {
        $actor = $current->require();
        $policy = $current->policy();
        $scope = $checker->authorize($actor, 'invoice:read', null, $policy);
        $model = $this->find($checker, $actor, $scope, $invoice);

        $checker->authorize($actor, 'invoice:status:update', $this->context($model), $policy);

        if ((int) $model->amount_paid_cents > 0) {
            throw ValidationException::withMessages([
                'reason' => __('invoices.errors.cannotVoidPaid'),
            ]);
        }

        $data = $request->validate([
            'reason' => ['required', 'string', 'min:10', 'max:2000'],
        ]);

        $ahora = CarbonImmutable::now();

        DB::table('invoices')->where('id', $model->id)->update([
            'status' => 'voided',
            'voided_at' => $ahora,
            'void_reason' => $data['reason'],
            'balance_cents' => 0,
            'updated_at' => $ahora,
        ]);

        Audit::record(
            $actor,
            AuditAction::FinancialChanged,
            entityType: 'invoice',
            entityId: (string) $model->id,
            entityLabel: (string) $model->invoice_number,
            before: ['status' => (string) $model->status],
            after: ['status' => 'voided'],
            reason: $data['reason'],
        );

        return back()->with('success', __('invoices.flash.voided'));
    }

    // ------------------------------------------------------------------ ayudas

    /** @var list<string> */
    private const STATUSES = [
        'draft', 'sent', 'due', 'paid', 'overdue', 'disputed', 'voided', 'uncollectable',
    ];

    /**
     * @return Builder<Invoice>
     */
    private function scoped(PermissionChecker $checker, Actor $actor, \App\Enums\Scope $scope): Builder
    {
        // El rol transportista tiene `invoice:read` con alcance Carrier. Aquí
        // eso es un filtro por `carrier_id`, no un 403: que vea lo que se le
        // cobra es lo que debe pasar.
        return $checker->scopeFilter($actor, $scope)->apply(
            Invoice::query()->where('invoices.tenant_id', $actor->tenantId),
            ['carrier' => 'carrier_id'],
        );
    }

    private function find(PermissionChecker $checker, Actor $actor, \App\Enums\Scope $scope, string $id): Invoice
    {
        $invoice = $this->scoped($checker, $actor, $scope)->whereKey($id)->first();

        abort_if($invoice === null, 404);

        return $invoice;
    }

    private function context(Invoice $i): ResourceContext
    {
        return new ResourceContext(tenantId: $i->tenant_id, carrierId: $i->carrier_id);
    }

    /**
     * @return array<string, mixed>
     */
    private function row(Invoice $i): array
    {
        return [
            'id' => (string) $i->id,
            'number' => (string) $i->invoice_number,
            'carrierId' => (string) $i->carrier_id,
            'status' => (string) $i->status,
            'subtotalCents' => (int) $i->subtotal_cents,
            'totalCents' => (int) $i->total_cents,
            'amountPaidCents' => (int) $i->amount_paid_cents,
            'balanceCents' => (int) $i->balance_cents,
            'paymentTermsDays' => (int) $i->payment_terms_days,
            'issueDate' => $i->issue_date?->toDateString(),
            'dueDate' => $i->due_date?->toDateString(),
            'paidAt' => $i->paid_at?->toIso8601String(),
            'voidedAt' => $i->voided_at?->toIso8601String(),
        ];
    }

    /**
     * @param  list<string>  $invoiceIds
     * @return array<string, string>
     */
    private function carrierNames(Actor $actor, array $invoiceIds): array
    {
        if ($invoiceIds === []) {
            return [];
        }

        return DB::table('carriers')
            ->where('tenant_id', $actor->tenantId)
            ->whereIn('id', DB::table('invoices')
                ->where('tenant_id', $actor->tenantId)
                ->whereIn('id', $invoiceIds)
                ->select('carrier_id'))
            ->pluck('legal_name', 'id')
            ->map(fn ($n): string => (string) $n)
            ->all();
    }

    /**
     * @param  Builder<Invoice>  $query
     * @param  array<string, string>  $filters
     * @return array<string, int>
     */
    private function totals(Builder $query, array $filters): array
    {
        if ($filters['status'] !== '') {
            $query->where('invoices.status', $filters['status']);
        }

        $fila = $query
            ->selectRaw('coalesce(sum(total_cents), 0) as total, coalesce(sum(balance_cents), 0) as saldo')
            ->reorder()
            ->first();

        return [
            'totalCents' => (int) ($fila->total ?? 0),
            'outstandingCents' => (int) ($fila->saldo ?? 0),
        ];
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function lines(Invoice $i): array
    {
        return DB::table('invoice_line_items as l')
            ->leftJoin('loads as ld', 'ld.id', '=', 'l.load_id')
            ->where('l.tenant_id', $i->tenant_id)
            ->where('l.invoice_id', $i->id)
            ->whereNull('l.deleted_at')
            ->orderBy('l.sequence')
            ->get(['l.id', 'l.sequence', 'l.description_en', 'l.description_es', 'l.amount_cents', 'l.kind', 'ld.id as load_id', 'ld.load_number'])
            ->map(fn ($l): array => [
                'id' => (string) $l->id,
                'sequence' => (int) $l->sequence,
                // Las dos descripciones se guardaron al emitir. Se manda la que
                // toca según el idioma de quien mira, pero ninguna se traduce
                // ahora: la factura dice lo que decía.
                'descriptionEn' => (string) $l->description_en,
                'descriptionEs' => $l->description_es,
                'amountCents' => (int) $l->amount_cents,
                'kind' => (string) $l->kind,
                'loadId' => $l->load_id === null ? null : (string) $l->load_id,
                'loadNumber' => $l->load_number,
            ])
            ->all();
    }

    /**
     * Transportistas con algo que facturar, para el primer paso del alta.
     *
     * @return list<array<string, mixed>>
     */
    private function carriersWithBillableLoads(Actor $actor): array
    {
        return DB::table('carriers as c')
            ->where('c.tenant_id', $actor->tenantId)
            ->whereNull('c.deleted_at')
            ->whereExists(fn ($q) => $this->billableExists($q, $actor, 'c.id'))
            ->orderBy('c.legal_name')
            ->get(['c.id', 'c.legal_name'])
            ->map(fn ($c): array => ['id' => (string) $c->id, 'name' => (string) $c->legal_name])
            ->all();
    }

    /**
     * Las cargas entregadas de un transportista que todavía no están en ninguna
     * factura viva.
     *
     * @return list<array<string, mixed>>
     */
    private function billableLoads(Actor $actor, string $carrierId): array
    {
        return $this->billableQuery($actor, $carrierId)
            ->orderBy('l.actual_delivery_at')
            ->limit(200)
            ->get(['l.id', 'l.load_number', 'l.commodity', 'l.actual_delivery_at', 'l.customer_charge_cents', 'l.carrier_gross_rate_cents', 'l.carrier_dispatch_fee_bps'])
            ->map(fn ($l): array => [
                'id' => (string) $l->id,
                'number' => (string) $l->load_number,
                'commodity' => $l->commodity,
                'deliveredAt' => $l->actual_delivery_at,
                // El importe definitivo lo calcula el servidor al facturar, con
                // los gastos aprobados incluidos. Esto es una estimación para
                // que quien marca las casillas sepa de qué tamaño hablamos.
                'estimatedFeeCents' => (int) round(
                    ((int) $l->carrier_gross_rate_cents) * ((int) $l->carrier_dispatch_fee_bps) / 10000,
                ),
            ])
            ->all();
    }

    /**
     * @param  list<string>  $ids
     * @return list<Load>
     */
    private function billableLoadModels(Actor $actor, string $carrierId, array $ids): array
    {
        $encontradas = $this->billableQuery($actor, $carrierId)
            ->whereIn('l.id', $ids)
            ->pluck('l.id')
            ->all();

        return Load::query()->whereIn('id', $encontradas)->get()->all();
    }

    private function billableQuery(Actor $actor, string $carrierId): \Illuminate\Database\Query\Builder
    {
        return DB::table('loads as l')
            ->where('l.tenant_id', $actor->tenantId)
            ->where('l.carrier_id', $carrierId)
            ->whereNull('l.deleted_at')
            ->where('l.status', 'delivered')
            ->whereNotExists(fn ($q) => $this->invoicedExists($q, $actor));
    }

    /**
     * Existe una carga facturable de este transportista.
     */
    private function billableExists(\Illuminate\Database\Query\Builder $q, Actor $actor, string $carrierColumn): void
    {
        $q->select(DB::raw(1))
            ->from('loads as l')
            ->whereColumn('l.carrier_id', $carrierColumn)
            ->where('l.tenant_id', $actor->tenantId)
            ->whereNull('l.deleted_at')
            ->where('l.status', 'delivered')
            ->whereNotExists(fn ($sub) => $this->invoicedExists($sub, $actor));
    }

    /**
     * Esta carga ya está en una factura VIVA (no anulada).
     *
     * No hay columna «facturada» en `loads` a propósito: una columna paralela se
     * desincroniza en cuanto se anula una factura.
     */
    private function invoicedExists(\Illuminate\Database\Query\Builder $q, Actor $actor): void
    {
        $q->select(DB::raw(1))
            ->from('invoice_line_items as li')
            ->join('invoices as inv', 'inv.id', '=', 'li.invoice_id')
            ->whereColumn('li.load_id', 'l.id')
            ->where('li.tenant_id', $actor->tenantId)
            ->whereNull('li.deleted_at')
            ->whereNull('inv.deleted_at')
            ->where('inv.status', '!=', 'voided');
    }
}
