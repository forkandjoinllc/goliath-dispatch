<?php

declare(strict_types=1);

namespace App\Http\Controllers\App;

use App\Authorization\Actor;
use App\Authorization\CurrentActor;
use App\Authorization\PermissionChecker;
use App\Enums\Scope;
use App\Support\Finance\CommissionLedger;
use App\Support\InertiaPage;
use App\Support\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Inertia\Inertia;
use Inertia\Response;

/**
 * Lo que se le debe a cada despachador.
 *
 * Se lee con `assignment:read`, que es el permiso de «qué lleva cada
 * despachador»: al despachador se le concede con alcance `own`, así que ve lo
 * SUYO y nada más. Pagar exige `assignment:commission:update`, que es el mismo
 * permiso con el que se fija su porcentaje — quien decide cuánto cobra alguien
 * es quien decide cuándo se le paga.
 *
 * Las cifras NO se recalculan aquí: salen tal cual de `dispatcher_commissions`,
 * que a su vez las copió de la instantánea financiera al facturar. Volver a
 * calcularlas al pagar haría que la comisión de marzo cambiara si en abril
 * alguien aprueba un gasto de esa carga.
 */
final class CommissionController
{
    use InertiaPage;

    /** @var list<string> */
    private const STATUSES = ['accrued', 'approved', 'paid', 'voided'];

    public function index(Request $request, CurrentActor $current, PermissionChecker $checker): Response
    {
        $actor = $current->require();
        $policy = $current->policy();
        $scope = $checker->authorize($actor, 'assignment:read', null, $policy);

        $this->usesDictionary($request, ['commissions', 'nav', 'common']);

        $filters = [
            'status' => in_array($request->query('status'), self::STATUSES, true)
                ? (string) $request->query('status')
                : 'accrued',
            'from' => $this->fecha($request->query('from')),
            'to' => $this->fecha($request->query('to')),
        ];

        $filas = $this->rows($actor, $scope, $filters);
        $ids = $filas->pluck('dispatcher_user_id')->unique()->all();

        return Inertia::render('App/Commissions/Index', [
            'dispatchers' => $this->groupByDispatcher($filas, $this->names($ids)),
            'filters' => $filters,
            'statuses' => self::STATUSES,
            'totals' => [
                'shownCents' => (int) $filas->sum('amount_cents'),
                'rows' => $filas->count(),
            ],
            'onlyMine' => ! $scope->atLeast(Scope::Tenant),
            'can' => [
                'pay' => $checker->can($actor, 'assignment:commission:update', null, $policy)->allowed,
            ],
        ]);
    }

    /**
     * Marcar pagadas las comisiones de un despachador en el periodo mostrado.
     *
     * Va por despachador y periodo y no por fila suelta porque así es como se
     * paga: una transferencia cubre un mes entero. Pagar fila a fila sería
     * pedirle a alguien treinta clics para un solo pago.
     */
    public function pay(Request $request, CurrentActor $current, PermissionChecker $checker): RedirectResponse
    {
        $actor = $current->require();
        $policy = $current->policy();
        $scope = $checker->authorize($actor, 'assignment:read', null, $policy);
        $checker->authorize($actor, 'assignment:commission:update', null, $policy);

        $data = $request->validate([
            'dispatcher_user_id' => ['required', 'string', 'size:36'],
            'from' => ['nullable', 'date'],
            'to' => ['nullable', 'date'],
            'status' => ['nullable', 'string', Rule::in(self::STATUSES)],
        ]);

        // Se recalcula la MISMA consulta que pintó la pantalla y se pagan sus
        // filas. Mandar los ids desde el cliente dejaría que alguien pagara una
        // comisión que la pantalla no le enseñó.
        $filas = $this->rows($actor, $scope, [
            'status' => $data['status'] ?? 'accrued',
            'from' => $this->fecha($data['from'] ?? null),
            'to' => $this->fecha($data['to'] ?? null),
        ])->where('dispatcher_user_id', $data['dispatcher_user_id']);

        $pagadas = CommissionLedger::markPaid($actor, $filas->pluck('id')->map(
            static fn ($id): string => (string) $id
        )->all());

        return back()->with('success', __('commissions.flash.paid', ['n' => (string) $pagadas]));
    }

    // ------------------------------------------------------------------ ayudas

    /**
     * Las comisiones que este actor puede ver, ya filtradas.
     *
     * @param  array{status: string, from: ?string, to: ?string}  $filters
     * @return \Illuminate\Support\Collection<int, object>
     */
    private function rows(Actor $actor, Scope $scope, array $filters)
    {
        $query = DB::table('dispatcher_commissions as c')
            ->leftJoin('loads as l', 'l.id', '=', 'c.load_id')
            ->where('c.tenant_id', $actor->tenantId)
            ->whereNull('c.deleted_at')
            ->where('c.status', $filters['status']);

        // Un despachador ve lo suyo. Sin este estrechamiento vería lo que
        // cobran sus compañeros, que no es asunto de la pantalla.
        if (! $scope->atLeast(Scope::Tenant)) {
            $query->where('c.dispatcher_user_id', $actor->userId);
        }

        if ($filters['from'] !== null) {
            $query->where('c.created_at', '>=', CarbonImmutable::parse($filters['from'])->startOfDay());
        }

        if ($filters['to'] !== null) {
            $query->where('c.created_at', '<=', CarbonImmutable::parse($filters['to'])->endOfDay());
        }

        return $query
            ->orderBy('c.dispatcher_user_id')
            ->orderByDesc('c.created_at')
            ->limit(2000)
            ->get([
                'c.id', 'c.dispatcher_user_id', 'c.amount_cents', 'c.basis',
                'c.basis_amount_cents', 'c.percentage_bps', 'c.status',
                'c.paid_at', 'c.created_at', 'c.load_id', 'l.load_number',
            ]);
    }

    /**
     * @param  \Illuminate\Support\Collection<int, object>  $filas
     * @param  array<string, string>  $nombres
     * @return list<array<string, mixed>>
     */
    private function groupByDispatcher($filas, array $nombres): array
    {
        return $filas
            ->groupBy('dispatcher_user_id')
            ->map(static fn ($grupo, $userId): array => [
                'userId' => (string) $userId,
                'name' => $nombres[(string) $userId] ?? '',
                'totalCents' => (int) $grupo->sum('amount_cents'),
                'lines' => $grupo->map(static fn ($c): array => [
                    'id' => (string) $c->id,
                    'loadId' => $c->load_id === null ? null : (string) $c->load_id,
                    'loadNumber' => $c->load_number,
                    'amountCents' => (int) $c->amount_cents,
                    'basis' => (string) $c->basis,
                    'basisAmountCents' => (int) $c->basis_amount_cents,
                    'percentageBps' => (int) $c->percentage_bps,
                    'status' => (string) $c->status,
                    'accruedOn' => substr((string) $c->created_at, 0, 10),
                    'paidOn' => $c->paid_at === null ? null : substr((string) $c->paid_at, 0, 10),
                ])->values()->all(),
            ])
            ->values()
            ->all();
    }

    /**
     * @param  list<string>  $ids
     * @return array<string, string>
     */
    private function names(array $ids): array
    {
        if ($ids === []) {
            return [];
        }

        // `users` no lleva tenant_id, así que va sin frontera — pero solo con
        // los ids que la consulta estrechada ya devolvió.
        return app(TenantContext::class)->withoutTenant(fn () => DB::table('users')
            ->whereIn('id', $ids)
            ->get(['id', 'first_name', 'last_name'])
            ->mapWithKeys(static fn ($u): array => [
                (string) $u->id => trim("{$u->first_name} {$u->last_name}"),
            ])
            ->all());
    }

    private function fecha(mixed $valor): ?string
    {
        $texto = trim((string) ($valor ?? ''));

        if ($texto === '') {
            return null;
        }

        return preg_match('/^\d{4}-\d{2}-\d{2}$/', $texto) === 1 ? $texto : null;
    }
}
