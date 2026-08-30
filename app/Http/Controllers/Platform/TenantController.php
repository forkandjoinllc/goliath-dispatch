<?php

declare(strict_types=1);

namespace App\Http\Controllers\Platform;

use App\Authorization\Actor;
use App\Authorization\CurrentActor;
use App\Authorization\PermissionChecker;
use App\Enums\AuditAction;
use App\Support\Audit;
use App\Support\InertiaPage;
use App\Support\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Inertia\Inertia;
use Inertia\Response;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * Quién usa Goliath, en qué plan y desde cuándo.
 *
 * `tenant_subscriptions` se escribía UNA vez —al darse alguien de alta— y no la
 * leía nadie. Los periodos de prueba no terminaban nunca, no había forma de ver
 * quién estaba en qué plan, y `tenants.status = 'suspended'` tampoco significaba
 * nada. Es decir: el negocio que sostiene todo lo demás no tenía pantalla.
 *
 * Esto es explícitamente de PLATAFORMA, no de empresa:
 *
 *  - Todas las consultas van `withoutTenant()`, y es de los poquísimos sitios
 *    donde saltarse el ámbito es lo correcto. Se pide a la cara y con el
 *    permiso `platform:*` delante, que solo tiene el super administrador.
 *  - Suspender y reactivar dejan rastro de auditoría con motivo obligatorio.
 *    Es la acción más grave que existe en el producto —deja a una empresa
 *    entera fuera— y «quién lo hizo y por qué» no puede depender de que alguien
 *    se acuerde de apuntarlo.
 *
 * Lo que esta pantalla NO hace: cobrar. Los identificadores de Stripe están en
 * el esquema y aquí solo se muestran; conectar el cobro es otro lote, con su
 * interfaz de proveedor y su adaptador simulado, como se hizo con FMCSA.
 */
final class TenantController
{
    use InertiaPage;

    private const PER_PAGE = 30;

    /** @var list<string> */
    private const STATUSES = ['provisioning', 'trialing', 'active', 'past_due', 'suspended', 'cancelled'];

    public function index(Request $request, CurrentActor $current, PermissionChecker $checker): Response
    {
        $actor = $current->require();
        $checker->authorize($actor, 'platform:tenant:read', null, $current->policy());

        $this->usesDictionary($request, ['platform', 'nav', 'common']);

        $filters = [
            'status' => in_array($request->query('status'), self::STATUSES, true)
                ? (string) $request->query('status')
                : '',
            'q' => trim((string) $request->query('q', '')),
        ];

        $page = app(TenantContext::class)->withoutTenant(function () use ($filters) {
            $query = DB::table('tenants as t')
                ->leftJoin('tenant_subscriptions as s', 's.tenant_id', '=', 't.id')
                ->leftJoin('saas_plans as p', 'p.id', '=', 's.plan_id')
                ->whereNull('t.deleted_at');

            if ($filters['status'] !== '') {
                $query->where('t.status', $filters['status']);
            }

            if ($filters['q'] !== '') {
                $termino = '%'.str_replace(['%', '_'], ['\%', '\_'], $filters['q']).'%';
                $query->where(function ($q) use ($termino): void {
                    $q->where('t.display_name', 'like', $termino)
                        ->orWhere('t.legal_name', 'like', $termino)
                        ->orWhere('t.slug', 'like', $termino);
                });
            }

            return $query
                ->orderByDesc('t.created_at')
                ->paginate(self::PER_PAGE, [
                    't.id', 't.slug', 't.display_name', 't.legal_name', 't.status', 't.created_at',
                    's.status as subscription_status', 's.trial_ends_at', 's.past_due_since',
                    'p.code as plan_code', 'p.monthly_price_cents',
                ])
                ->withQueryString();
        });

        return Inertia::render('Platform/Tenants/Index', [
            'tenants' => [
                'data' => collect($page->items())->map(fn (object $t): array => $this->row($t))->all(),
                'meta' => [
                    'total' => $page->total(),
                    'perPage' => self::PER_PAGE,
                    'currentPage' => $page->currentPage(),
                    'lastPage' => $page->lastPage(),
                ],
            ],
            'filters' => $filters,
            'statuses' => self::STATUSES,
            'counts' => $this->countsByStatus(),
        ]);
    }

    public function show(Request $request, string $tenant, CurrentActor $current, PermissionChecker $checker): Response
    {
        $actor = $current->require();
        $policy = $current->policy();
        $checker->authorize($actor, 'platform:tenant:read', null, $policy);

        $this->usesDictionary($request, ['platform', 'nav', 'common', 'validation']);

        $fila = $this->find($tenant);

        return Inertia::render('Platform/Tenants/Show', [
            'tenant' => [
                ...$this->row($fila),
                'legalName' => (string) $fila->legal_name,
                'customDomain' => $fila->custom_domain,
                'customDomainVerified' => $fila->custom_domain_verified_at !== null,
                'stripeCustomerId' => $fila->stripe_customer_id,
                'periodEnd' => $fila->current_period_end === null
                    ? null
                    : substr((string) $fila->current_period_end, 0, 10),
            ],
            'usage' => $this->usage((string) $fila->id, $fila),
            'can' => [
                'suspend' => $checker->can($actor, 'platform:tenant:suspend', null, $policy)->allowed,
            ],
        ]);
    }

    /**
     * Suspender o reactivar.
     *
     * Con motivo obligatorio, y no por burocracia: es la acción que deja fuera a
     * una empresa entera, y dentro de seis meses la única forma de saber por qué
     * se hizo será esto. La transición se valida contra el estado actual para
     * que un doble clic no escriba dos veces lo mismo en la pista.
     */
    public function suspend(Request $request, string $tenant, CurrentActor $current, PermissionChecker $checker): RedirectResponse
    {
        $actor = $current->require();
        $policy = $current->policy();
        $checker->authorize($actor, 'platform:tenant:read', null, $policy);
        $checker->authorize($actor, 'platform:tenant:suspend', null, $policy);

        $fila = $this->find($tenant);

        $data = $request->validate([
            'action' => ['required', 'string', Rule::in(['suspend', 'reactivate'])],
            'reason' => ['required', 'string', 'min:5', 'max:2000'],
        ]);

        $antes = (string) $fila->status;
        $despues = $data['action'] === 'suspend' ? 'suspended' : 'active';

        if ($antes === $despues) {
            return back();
        }

        app(TenantContext::class)->withoutTenant(fn () => DB::table('tenants')
            ->where('id', $fila->id)
            ->update(['status' => $despues, 'updated_at' => CarbonImmutable::now()]));

        Audit::record(
            $actor,
            $data['action'] === 'suspend' ? AuditAction::TenantSuspended : AuditAction::TenantReactivated,
            entityType: 'tenant',
            entityId: (string) $fila->id,
            entityLabel: (string) $fila->display_name,
            before: ['status' => $antes],
            after: ['status' => $despues],
            reason: $data['reason'],
        );

        return back()->with('success', __('platform.flash.'.$data['action']));
    }

    // ------------------------------------------------------------------ ayudas

    private function find(string $id): object
    {
        $fila = app(TenantContext::class)->withoutTenant(fn () => DB::table('tenants as t')
            ->leftJoin('tenant_subscriptions as s', 's.tenant_id', '=', 't.id')
            ->leftJoin('saas_plans as p', 'p.id', '=', 's.plan_id')
            ->where('t.id', $id)
            ->whereNull('t.deleted_at')
            ->first([
                't.id', 't.slug', 't.display_name', 't.legal_name', 't.status', 't.created_at',
                't.custom_domain', 't.custom_domain_verified_at',
                's.status as subscription_status', 's.trial_ends_at', 's.past_due_since',
                's.current_period_end', 's.stripe_customer_id',
                'p.code as plan_code', 'p.monthly_price_cents',
                'p.max_users', 'p.max_carriers', 'p.max_loads_per_month',
            ]));

        if ($fila === null) {
            throw new NotFoundHttpException;
        }

        return $fila;
    }

    /**
     * Lo que esta empresa está gastando frente a los topes de su plan.
     *
     * Se ENSEÑA y no se impide. `saas_plans` trae `max_users`, `max_carriers` y
     * `max_loads_per_month` desde el primer día y nadie los ha aplicado nunca;
     * empezar a bloquear altas hoy cambiaría el comportamiento de empresas que
     * llevan meses por encima del tope sin saberlo. Ver el número es lo que
     * permite decidir; decidir es de quien lleva el negocio.
     *
     * @return array<string, array{used: int, limit: int|null}>
     */
    private function usage(string $tenantId, object $plan): array
    {
        return app(TenantContext::class)->withoutTenant(function () use ($tenantId, $plan): array {
            $usuarios = DB::table('user_tenant_memberships')
                ->where('tenant_id', $tenantId)
                ->whereIn('status', ['active', 'invited'])
                ->whereNull('deleted_at')
                ->count();

            $transportistas = DB::table('carriers')
                ->where('tenant_id', $tenantId)
                ->whereNull('deleted_at')
                ->count();

            $cargas = DB::table('loads')
                ->where('tenant_id', $tenantId)
                ->whereNull('deleted_at')
                ->where('created_at', '>=', CarbonImmutable::now()->startOfMonth())
                ->count();

            return [
                'users' => ['used' => $usuarios, 'limit' => $plan->max_users === null ? null : (int) $plan->max_users],
                'carriers' => ['used' => $transportistas, 'limit' => $plan->max_carriers === null ? null : (int) $plan->max_carriers],
                'loadsThisMonth' => ['used' => $cargas, 'limit' => $plan->max_loads_per_month === null ? null : (int) $plan->max_loads_per_month],
            ];
        });
    }

    /** @return array<string, int> */
    private function countsByStatus(): array
    {
        $conteo = app(TenantContext::class)->withoutTenant(fn () => DB::table('tenants')
            ->whereNull('deleted_at')
            // `selectRaw` con alias y NO `pluck(DB::raw(...))`: esa forma revienta
            // en cuanto hay una fila y pasa con cero, que es como sobrevivió
            // hasta el lote de informes.
            ->selectRaw('status, count(*) as total')
            ->groupBy('status')
            ->pluck('total', 'status')
            ->all());

        $salida = [];

        foreach (self::STATUSES as $estado) {
            $salida[$estado] = (int) ($conteo[$estado] ?? 0);
        }

        return $salida;
    }

    /** @return array<string, mixed> */
    private function row(object $t): array
    {
        return [
            'id' => (string) $t->id,
            'slug' => (string) $t->slug,
            'name' => (string) $t->display_name,
            'status' => (string) $t->status,
            'subscriptionStatus' => $t->subscription_status === null ? null : (string) $t->subscription_status,
            'planCode' => $t->plan_code === null ? null : (string) $t->plan_code,
            'monthlyPriceCents' => $t->monthly_price_cents === null ? null : (int) $t->monthly_price_cents,
            'trialEndsOn' => $t->trial_ends_at === null ? null : substr((string) $t->trial_ends_at, 0, 10),
            'pastDueSince' => $t->past_due_since === null ? null : substr((string) $t->past_due_since, 0, 10),
            'createdOn' => substr((string) $t->created_at, 0, 10),
        ];
    }
}
