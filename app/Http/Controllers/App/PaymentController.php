<?php

declare(strict_types=1);

namespace App\Http\Controllers\App;

use App\Authorization\Actor;
use App\Authorization\CurrentActor;
use App\Authorization\PermissionChecker;
use App\Enums\PaymentMethod;
use App\Enums\Scope;
use App\Models\Payment;
use App\Support\Finance\PaymentLedger;
use App\Support\InertiaPage;
use App\Support\TenantContext;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Inertia\Inertia;
use Inertia\Response;

/**
 * El libro de cobros.
 *
 * Es la contrapartida de la pantalla de facturas: allí se ve lo que se DEBE,
 * aquí lo que ENTRÓ y por dónde. Existe porque `invoices.amount_paid_cents` es
 * un número sin historia: dice cuánto, no cuándo, ni con qué método, ni con qué
 * referencia, ni quién lo anotó. Cuadrar un mes contra el extracto del banco se
 * hace con esta lista, no con aquella.
 *
 * No se borra un cobro. Si entró mal, se reembolsa —que es lo que de verdad
 * pasa con el dinero— o se marca en disputa. Un borrado deja la factura
 * cuadrada y el banco descuadrado, y nadie sabe cuál de los dos miente.
 */
final class PaymentController
{
    use InertiaPage;

    private const PER_PAGE = 30;

    /** @var list<string> */
    private const STATUSES = [
        'pending', 'processing', 'succeeded', 'failed',
        'refunded', 'partially_refunded', 'disputed', 'cancelled',
    ];

    public function index(Request $request, CurrentActor $current, PermissionChecker $checker): Response
    {
        $actor = $current->require();
        $policy = $current->policy();
        // Se lee con el permiso de facturas: quien puede ver lo que se debe
        // puede ver lo que se ha cobrado. Anotar y reembolsar son otra cosa.
        $scope = $checker->authorize($actor, 'invoice:read', null, $policy);

        $this->usesDictionary($request, ['payments', 'invoices', 'nav', 'common']);

        $filters = [
            'status' => in_array($request->query('status'), self::STATUSES, true)
                ? (string) $request->query('status')
                : '',
            'method' => in_array($request->query('method'), PaymentMethod::values(), true)
                ? (string) $request->query('method')
                : '',
            'invoice' => trim((string) $request->query('invoice', '')),
        ];

        $query = $this->scoped($checker, $actor, $scope);

        if ($filters['status'] !== '') {
            $query->where('payments.status', $filters['status']);
        }

        if ($filters['method'] !== '') {
            $query->where('payments.method', $filters['method']);
        }

        if ($filters['invoice'] !== '') {
            $term = '%'.str_replace(['%', '_'], ['\%', '\_'], $filters['invoice']).'%';
            $query->whereExists(fn ($q) => $q->select(DB::raw(1))
                ->from('invoices')
                ->whereColumn('invoices.id', 'payments.invoice_id')
                ->where('invoices.invoice_number', 'like', $term));
        }

        $page = $query
            ->orderByDesc('payments.received_at')
            ->orderByDesc('payments.created_at')
            ->paginate(self::PER_PAGE)
            ->withQueryString();

        $extra = $this->context($actor, collect($page->items())->map(
            fn (Payment $p): string => (string) $p->id
        )->all());

        return Inertia::render('App/Payments/Index', [
            'payments' => [
                'data' => collect($page->items())
                    ->map(fn (Payment $p): array => [
                        ...$this->row($p),
                        ...($extra[(string) $p->id] ?? []),
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
            'methods' => PaymentMethod::values(),
            'totals' => $this->totals($this->scoped($checker, $actor, $scope)),
            'can' => [
                'refund' => $checker->can($actor, 'payment:refund', null, $policy)->allowed,
            ],
        ]);
    }

    /**
     * Devolver dinero.
     *
     * Contra un cobro concreto, no contra la factura: el dinero vuelve por
     * donde vino. Y nunca más de lo que ese cobro trajo.
     */
    public function refund(Request $request, string $payment, CurrentActor $current, PermissionChecker $checker): RedirectResponse
    {
        $actor = $current->require();
        $policy = $current->policy();
        $scope = $checker->authorize($actor, 'invoice:read', null, $policy);
        $model = $this->find($checker, $actor, $scope, $payment);

        $checker->authorize($actor, 'payment:refund', null, $policy);

        $data = $request->validate([
            'amount_cents' => ['required', 'integer', 'min:1'],
            'reason' => ['required', 'string', 'min:5', 'max:2000'],
        ]);

        $disponible = (int) $model->amount_cents - (int) $model->refunded_amount_cents;

        if ((int) $data['amount_cents'] > $disponible) {
            throw ValidationException::withMessages([
                'amount_cents' => __('payments.errors.refundTooBig'),
            ]);
        }

        if (! in_array($model->status->value, ['succeeded', 'partially_refunded'], true)) {
            throw ValidationException::withMessages([
                'amount_cents' => __('payments.errors.notRefundable'),
            ]);
        }

        PaymentLedger::refund($actor, $model, (int) $data['amount_cents'], $data['reason']);

        return back()->with('success', __('payments.flash.refunded'));
    }

    /**
     * Marcar un cobro en disputa.
     *
     * Deja de contar como dinero en casa: el banco puede retirarlo. La factura
     * vuelve a deber lo que ese cobro cubría.
     */
    public function dispute(Request $request, string $payment, CurrentActor $current, PermissionChecker $checker): RedirectResponse
    {
        $actor = $current->require();
        $policy = $current->policy();
        $scope = $checker->authorize($actor, 'invoice:read', null, $policy);
        $model = $this->find($checker, $actor, $scope, $payment);

        $checker->authorize($actor, 'payment:refund', null, $policy);

        $data = $request->validate([
            'reason' => ['required', 'string', 'min:5', 'max:2000'],
        ]);

        if ($model->status->value === 'disputed') {
            throw ValidationException::withMessages([
                'reason' => __('payments.errors.alreadyDisputed'),
            ]);
        }

        PaymentLedger::dispute($actor, $model, $data['reason']);

        return back()->with('success', __('payments.flash.disputed'));
    }

    // ------------------------------------------------------------------ ayudas

    /**
     * @return Builder<Payment>
     */
    private function scoped(PermissionChecker $checker, Actor $actor, Scope $scope): Builder
    {
        // `payments` no lleva `carrier_id`: se llega al transportista por la
        // factura. Con alcance de transportista se estrecha con un EXISTS, que
        // es lo que ScopeFilter no sabe expresar por sí solo.
        $query = Payment::query()->where('payments.tenant_id', $actor->tenantId);

        if ($scope->atLeast(Scope::Tenant)) {
            return $query;
        }

        if ($actor->carrierId === null) {
            return $query->whereRaw('1 = 0');
        }

        return $query->whereExists(fn ($q) => $q->select(DB::raw(1))
            ->from('invoices')
            ->whereColumn('invoices.id', 'payments.invoice_id')
            ->where('invoices.carrier_id', $actor->carrierId));
    }

    private function find(PermissionChecker $checker, Actor $actor, Scope $scope, string $id): Payment
    {
        $p = $this->scoped($checker, $actor, $scope)->whereKey($id)->first();

        abort_if($p === null, 404);

        return $p;
    }

    /**
     * @return array<string, mixed>
     */
    private function row(Payment $p): array
    {
        return [
            'id' => (string) $p->id,
            'invoiceId' => (string) $p->invoice_id,
            'amountCents' => (int) $p->amount_cents,
            'refundedCents' => (int) $p->refunded_amount_cents,
            // ->value: las dos columnas están casteadas a enum en el modelo.
            'method' => $p->method->value,
            'status' => $p->status->value,
            'reference' => $p->reference,
            'receivedOn' => $p->received_at?->toDateString(),
            'notes' => $p->notes,
            'disputeReason' => $p->dispute_reason,
        ];
    }

    /**
     * Número de factura y quién lo anotó, para toda la página de una vez.
     *
     * @param  list<string>  $ids
     * @return array<string, array<string, mixed>>
     */
    private function context(Actor $actor, array $ids): array
    {
        if ($ids === []) {
            return [];
        }

        $filas = DB::table('payments as p')
            ->leftJoin('invoices as i', 'i.id', '=', 'p.invoice_id')
            ->where('p.tenant_id', $actor->tenantId)
            ->whereIn('p.id', $ids)
            ->get(['p.id', 'p.recorded_by_user_id', 'i.invoice_number']);

        // `users` no lleva tenant_id, así que va sin frontera — pero solo con
        // los ids que la consulta de arriba ya acotó a esta empresa.
        $personas = app(TenantContext::class)->withoutTenant(fn () => DB::table('users')
            ->whereIn('id', $filas->pluck('recorded_by_user_id')->filter()->unique()->all())
            ->get(['id', 'first_name', 'last_name'])
            ->keyBy('id'));

        $salida = [];

        foreach ($filas as $f) {
            $u = $f->recorded_by_user_id === null ? null : ($personas[$f->recorded_by_user_id] ?? null);

            $salida[(string) $f->id] = [
                'invoiceNumber' => $f->invoice_number,
                'recordedBy' => $u === null ? null : trim("{$u->first_name} {$u->last_name}"),
            ];
        }

        return $salida;
    }

    /**
     * @param  Builder<Payment>  $query
     * @return array<string, int>
     */
    private function totals(Builder $query): array
    {
        $filas = $query
            ->selectRaw('status, coalesce(sum(amount_cents - refunded_amount_cents), 0) as neto')
            ->groupBy('status')
            ->reorder()
            ->pluck('neto', 'status');

        return [
            // Lo que de verdad importa: cuánto entró y sigue en casa, cuánto
            // está anotado pero sin compensar, y cuánto puede irse.
            'settledCents' => (int) ($filas['succeeded'] ?? 0) + (int) ($filas['partially_refunded'] ?? 0),
            'pendingCents' => (int) ($filas['pending'] ?? 0) + (int) ($filas['processing'] ?? 0),
            'disputedCents' => (int) ($filas['disputed'] ?? 0),
        ];
    }
}
