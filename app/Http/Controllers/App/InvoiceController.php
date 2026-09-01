<?php

declare(strict_types=1);

namespace App\Http\Controllers\App;

use App\Authorization\Actor;
use App\Authorization\CurrentActor;
use App\Authorization\PermissionChecker;
use App\Authorization\ResourceContext;
use App\Enums\AuditAction;
use App\Enums\PaymentMethod;
use App\Models\Invoice;
use App\Models\Load;
use App\Support\Audit;
use App\Support\Finance\Billable;
use App\Support\Finance\InvoiceBuilder;
use App\Support\Finance\InvoiceLink;
use App\Support\Finance\PaymentLedger;
use App\Support\InertiaPage;
use App\Support\Tenancy\TenantPolicy;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
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
            'overdue' => $request->query('overdue') === '1' ? '1' : '',
        ];

        $query = $this->scoped($checker, $actor, $scope);

        if ($filters['search'] !== '') {
            $term = '%'.str_replace(['%', '_'], ['\%', '\_'], $filters['search']).'%';
            $query->where(fn (Builder $q) => $q->where('invoices.invoice_number', 'like', $term));
        }

        if ($filters['status'] !== '') {
            $query->where('invoices.status', $filters['status']);
        }

        if ($filters['overdue'] === '1') {
            self::applyOverdue($query);
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
            // El plazo por defecto es el de la EMPRESA. Antes era un `?? 30` y
            // `default_payment_terms_days` no lo leía nadie.
            (int) ($data['payment_terms_days'] ?? TenantPolicy::for($actor->tenantId)->paymentTermsDays),
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

        // `payments` porque la ficha pinta el formulario de anotar un cobro y el
        // historial de cobros con las claves de ESE diccionario. Sin él la
        // pantalla enseñaba «payments.fields.method» en crudo — y no se veía en
        // el primer render porque el formulario está detrás de un botón.
        $this->usesDictionary($request, ['invoices', 'payments', 'nav', 'common']);

        return Inertia::render('App/Invoices/Show', [
            'invoice' => [
                ...$this->row($model),
                'carrierName' => $this->carrierNames($actor, [(string) $model->id])[(string) $model->carrier_id] ?? null,
                'notes' => $model->notes,
                'voidReason' => $model->void_reason,
                'lines' => $this->lines($model),
            ],
            'methods' => PaymentMethod::values(),
            'payments' => $this->payments($actor, (string) $model->id),
            'can' => [
                'send' => $checker->can($actor, 'invoice:send', $this->context($model), $policy)->allowed,
                'pay' => $checker->can($actor, 'payment:record', $this->context($model), $policy)->allowed,
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

        // ->value: `status` está casteado a InvoiceStatus, y un enum nunca es
        // idéntico a una cadena. Tal cual estaba, esta condición era SIEMPRE
        // cierta y no se podía enviar ninguna factura, nunca.
        if ($model->status->value !== 'draft') {
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

        // Y AHORA SALE DE VERDAD. Hasta el lote 62 esto solo la marcaba como
        // enviada —la pantalla lo decía con cuidado, así que no mentía— y el
        // despachador la mandaba por su cuenta desde su correo. Ver
        // App\Support\Finance\InvoiceLink: va al contacto de facturación del
        // transportista, en su idioma y con la cara de la empresa.
        //
        // Fuera de la escritura de arriba a propósito: mandar un correo dentro
        // de una transacción abierta la mantiene viva hablando con un SMTP, y si
        // algo la revierte el correo ya se fue.
        $envio = InvoiceLink::send($model->fresh());

        if ($envio['to'] !== null) {
            DB::table('invoices')->where('id', $model->id)->update([
                'sent_to' => $envio['to'],
                'updated_at' => $ahora,
            ]);
        }

        Audit::record(
            $actor,
            AuditAction::InvoiceSent,
            entityType: 'invoice',
            entityId: (string) $model->id,
            entityLabel: (string) $model->invoice_number,
            before: ['status' => 'draft'],
            after: [
                'status' => 'sent',
                'due_date' => $ahora->addDays((int) $model->payment_terms_days)->toDateString(),
                'sentTo' => $envio['to'],
                'emailed' => $envio['sent'],
            ],
        );

        // Se dice si SALIÓ o no. «Marcada como enviada» cuando el correo falló
        // dejaría a alguien esperando un pago de una factura que nadie recibió.
        return back()->with(
            $envio['sent'] ? 'success' : 'error',
            $envio['sent']
                ? __('invoices.flash.emailed', ['email' => $envio['to']])
                : __($envio['to'] === null ? 'invoices.flash.noRecipient' : 'invoices.flash.notEmailed'),
        );
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

        // `payment:record` y NO `invoice:pay`. Este endpoint ANOTA lo cobrado,
        // que es un acto de la oficina; `invoice:pay` («pagar una factura») solo
        // lo tiene el rol transportista, así que tal cual estaba ni el
        // administrador ni contabilidad podían registrar un cobro — y en cambio
        // el transportista podía dar por pagada su propia factura.
        $checker->authorize($actor, 'payment:record', $this->context($model), $policy);

        // Y aquí al revés: era SIEMPRE falsa, así que se podían anotar cobros
        // contra una factura en borrador o anulada.
        if (in_array($model->status->value, ['draft', 'voided'], true)) {
            throw ValidationException::withMessages([
                'amount_cents' => __('invoices.errors.cannotPayThis'),
            ]);
        }

        $data = $request->validate([
            'amount_cents' => ['required', 'integer', 'min:1'],
            'method' => ['required', 'string', Rule::in(PaymentMethod::values())],
            // Un cheque anotado el día que llega y todavía sin compensar es
            // `pending`: queda registrado y NO cuenta como cobrado.
            'status' => ['required', 'string', Rule::in(['pending', 'succeeded'])],
            'reference' => ['nullable', 'string', 'max:120'],
            'received_at' => ['nullable', 'date'],
            'notes' => ['nullable', 'string', 'max:2000'],
        ]);

        // El tope se calcula sobre lo que YA cuenta más lo que se anota ahora, y
        // solo si lo que se anota cuenta. Un cobro pendiente no puede pasarse de
        // la factura porque todavía no suma.
        $suma = (int) $model->amount_paid_cents
            + ($data['status'] === 'succeeded' ? (int) $data['amount_cents'] : 0);

        if ($suma > (int) $model->total_cents) {
            throw ValidationException::withMessages([
                'amount_cents' => __('invoices.errors.overpaid'),
            ]);
        }

        // Se ANOTA UNA FILA en `payments` y la factura se recalcula desde sus
        // cobros. Antes esto sumaba sobre la columna y no escribía nada: la
        // factura decía cuánto se había cobrado y no había forma de saber
        // cuándo, cómo, con qué referencia ni quién lo anotó.
        PaymentLedger::record($actor, $model, [
            'amount_cents' => (int) $data['amount_cents'],
            'method' => (string) $data['method'],
            'status' => (string) $data['status'],
            'reference' => $data['reference'] ?? null,
            'received_at' => $data['received_at'] ?? null,
            'notes' => $data['notes'] ?? null,
        ]);

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
            before: ['status' => $model->status->value],
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
     * Los cobros de esta factura, el más reciente primero.
     *
     * Se enseñan aquí y no solo en el libro de cobros porque la pregunta «¿esta
     * factura está cobrada?» y la pregunta «¿cuándo y cómo?» se hacen en el
     * mismo momento y delante del mismo papel.
     *
     * @return list<array<string, mixed>>
     */
    private function payments(Actor $actor, string $invoiceId): array
    {
        return DB::table('payments')
            ->where('tenant_id', $actor->tenantId)
            ->where('invoice_id', $invoiceId)
            ->whereNull('deleted_at')
            ->orderByDesc('received_at')
            ->get(['id', 'amount_cents', 'refunded_amount_cents', 'method', 'status', 'reference', 'received_at'])
            ->map(static fn ($p): array => [
                'id' => (string) $p->id,
                'amountCents' => (int) $p->amount_cents,
                'refundedCents' => (int) $p->refunded_amount_cents,
                'method' => (string) $p->method,
                'status' => (string) $p->status,
                'reference' => $p->reference,
                'receivedOn' => $p->received_at === null ? null : substr((string) $p->received_at, 0, 10),
            ])
            ->all();
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
            // ->value y no (string): la columna está CASTEADA a enum en el
            // modelo, y convertir un enum a cadena con (string) es un Error en
            // ejecución. Ver docs/testing.md — la suite lo destapó.
            'status' => $i->status->value,
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
    /**
     * La regla vive en `Support\Finance\Billable`, no aquí.
     *
     * El panel cuenta lo mismo, y dos copias de esta regla se separan: el día
     * que difieran, el panel diría que hay tres cargas por facturar y esta
     * pantalla ofrecería dos.
     */
    private function invoicedExists(\Illuminate\Database\Query\Builder $q, Actor $actor): void
    {
        Billable::invoicedExists($q, (string) $actor->tenantId, 'l.id');
    }

    /**
     * Lo que de verdad está vencido, calculado por fecha y no por el estado.
     *
     * `invoices.status` solo pasa a `overdue` cuando `PaymentLedger::resync()`
     * corre, y eso solo ocurre al anotar o reembolsar un cobro. Una factura que
     * simplemente cruza su fecha de vencimiento sin que nadie la toque se queda
     * en `sent` para siempre: en los datos de demostración hay una vencida y
     * ninguna con el estado `overdue`. Contar por estado diría cero.
     *
     * Mientras no haya nada que corra solo —hoy `routes/console.php` no tiene ni
     * un comando programado— este cálculo por fecha es la única respuesta
     * honesta, y es la que usan por igual esta pantalla y el panel.
     *
     * @param  Builder<Invoice>  $query
     */
    public static function applyOverdue(Builder $query): Builder
    {
        return $query
            ->where('invoices.balance_cents', '>', 0)
            ->whereNotNull('invoices.due_date')
            ->whereDate('invoices.due_date', '<', CarbonImmutable::now()->toDateString())
            // Una anulada o un borrador no deben nada aunque tengan fecha; una
            // incobrable ya se dio por perdida y no es trabajo pendiente.
            ->whereNotIn('invoices.status', ['draft', 'voided', 'paid', 'uncollectable']);
    }

}
