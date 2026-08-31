<?php

declare(strict_types=1);

namespace App\Http\Controllers\App;

use App\Authorization\CurrentActor;
use App\Authorization\PermissionChecker;
use App\Services\Billing\BillingProvider;
use App\Support\Billing\EventLedger;
use App\Support\InertiaPage;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Inertia\Inertia;
use Inertia\Response;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * La facturación de la empresa: su plan, su estado y cómo pagar.
 *
 * Hasta este lote el arco terminaba en un callejón. Alguien se daba de alta,
 * agotaba la prueba, el barrido movía la suscripción a `past_due`… y ahí se
 * quedaba para siempre, porque no había forma de pagar. La pantalla de ajustes
 * lo decía con estas palabras: «cambiar de plan pasa por cobrar, y cobrar es
 * otro lote con su pasarela; poner aquí un botón que no cobra sería peor que no
 * ponerlo».
 *
 * ## Ningún dato de tarjeta pasa por aquí
 *
 * No hay formulario de tarjeta y no lo habrá. El botón lleva a una página
 * ALOJADA POR EL PROVEEDOR y el pago ocurre allí. Este servidor no ve el número,
 * no lo registra y no lo guarda — lo que hace que sus registros y sus copias de
 * seguridad no sean asunto del cumplimiento de tarjetas, porque no lo tocan.
 *
 * ## Volver de pagar no activa nada
 *
 * `done()` solo enseña una página. Quien mueve la suscripción es el suceso del
 * proveedor. Si activara aquí, quien pagara y cerrara la pestaña —se le va el
 * móvil, se le cae la conexión— habría pagado y se quedaría sin sistema. Ver
 * App\Support\Billing\Subscriptions.
 */
final class BillingController
{
    use InertiaPage;

    public function index(Request $request, CurrentActor $current, PermissionChecker $checker, BillingProvider $provider): Response
    {
        $actor = $current->require();
        $policy = $current->policy();
        $checker->authorize($actor, 'tenant:billing:read', null, $policy);

        $this->usesDictionary($request, ['billing', 'nav', 'common', 'validation']);

        $tenantId = (string) $actor->tenantId;
        $suscripcion = $this->subscription($tenantId);

        return Inertia::render('App/Billing/Index', [
            'subscription' => $suscripcion,
            'plans' => $this->plans(),
            'events' => EventLedger::forTenant($tenantId),
            // Que el cobro esté simulado se dice EN PANTALLA, no solo en la
            // salud de la plataforma. Quien mira esto quiere saber si al pulsar
            // el botón se le va a cobrar de verdad, y esa pregunta no se
            // contesta en otra sección.
            'provider' => [
                'name' => $provider->name(),
                'live' => $provider->isLive(),
            ],
            'portalUrl' => $suscripcion !== null && $suscripcion['customerId'] !== null
                ? $provider->portalUrl($suscripcion['customerId'], url('/billing'))
                : null,
            'can' => [
                'pay' => $checker->can($actor, 'tenant:billing:update', null, $policy)->allowed,
            ],
        ]);
    }

    /** Manda a la página de pago del proveedor. */
    public function checkout(Request $request, CurrentActor $current, PermissionChecker $checker, BillingProvider $provider): RedirectResponse
    {
        $actor = $current->require();
        $policy = $current->policy();
        $checker->authorize($actor, 'tenant:billing:update', null, $policy);

        $datos = $request->validate([
            'plan_code' => ['required', 'string', 'max:40'],
        ]);

        $plan = DB::table('saas_plans')
            ->where('code', $datos['plan_code'])
            ->whereNull('deleted_at')
            ->first(['code', 'is_public']);

        if ($plan === null || ! (bool) $plan->is_public) {
            // Un plan privado o inexistente no se compra por escribir su código
            // en la petición. La lista de la pantalla no es la única defensa.
            return back()->withErrors(['plan_code' => __('billing.errors.unknownPlan')]);
        }

        $sesion = $provider->checkoutUrl(
            tenantId: (string) $actor->tenantId,
            planCode: (string) $plan->code,
            customerEmail: $actor->email,
            returnUrl: url('/billing/done'),
            cancelUrl: url('/billing'),
        );

        // Fuera de la aplicación: es una URL del proveedor.
        return redirect()->away($sesion->url);
    }

    /**
     * La vuelta de la página de pago.
     *
     * NO activa nada. Solo dice «gracias, lo estamos confirmando». Lo que activa
     * es el suceso del proveedor, que llega aunque nadie vuelva.
     */
    public function done(Request $request, CurrentActor $current, PermissionChecker $checker): Response
    {
        $actor = $current->require();
        $policy = $current->policy();
        $checker->authorize($actor, 'tenant:billing:read', null, $policy);

        $this->usesDictionary($request, ['billing', 'nav', 'common']);

        return Inertia::render('App/Billing/Done', [
            'subscription' => $this->subscription((string) $actor->tenantId),
        ]);
    }

    /**
     * La suscripción de la empresa, con su plan.
     *
     * @return array<string, mixed>|null
     */
    private function subscription(string $tenantId): ?array
    {
        $fila = DB::table('tenant_subscriptions as s')
            ->leftJoin('saas_plans as p', 'p.id', '=', 's.plan_id')
            ->where('s.tenant_id', $tenantId)
            ->first([
                's.status', 's.trial_ends_at', 's.current_period_end', 's.past_due_since',
                's.cancel_at_period_end', 's.stripe_customer_id',
                'p.code', 'p.name_en', 'p.name_es', 'p.monthly_price_cents',
            ]);

        if ($fila === null) {
            return null;
        }

        return [
            'status' => (string) $fila->status,
            'planCode' => $fila->code === null ? null : (string) $fila->code,
            'planNameEn' => $fila->name_en === null ? null : (string) $fila->name_en,
            'planNameEs' => $fila->name_es === null ? null : (string) $fila->name_es,
            'priceCents' => $fila->monthly_price_cents === null ? null : (int) $fila->monthly_price_cents,
            'trialEndsAt' => $fila->trial_ends_at === null ? null : substr((string) $fila->trial_ends_at, 0, 10),
            'currentPeriodEnd' => $fila->current_period_end === null ? null : substr((string) $fila->current_period_end, 0, 10),
            'pastDueSince' => $fila->past_due_since === null ? null : substr((string) $fila->past_due_since, 0, 10),
            'cancelAtPeriodEnd' => (bool) $fila->cancel_at_period_end,
            'customerId' => $fila->stripe_customer_id === null ? null : (string) $fila->stripe_customer_id,
        ];
    }

    /** @return list<array<string, mixed>> */
    private function plans(): array
    {
        return DB::table('saas_plans')
            ->whereNull('deleted_at')
            ->where('is_public', 1)
            ->orderBy('sort_order')
            ->get(['code', 'name_en', 'name_es', 'monthly_price_cents', 'trial_days', 'max_users', 'max_carriers', 'max_loads_per_month'])
            ->map(static fn (object $p): array => [
                'code' => (string) $p->code,
                'nameEn' => (string) $p->name_en,
                'nameEs' => (string) $p->name_es,
                'priceCents' => (int) $p->monthly_price_cents,
                'trialDays' => (int) $p->trial_days,
                'maxUsers' => $p->max_users === null ? null : (int) $p->max_users,
                'maxCarriers' => $p->max_carriers === null ? null : (int) $p->max_carriers,
                'maxLoadsPerMonth' => $p->max_loads_per_month === null ? null : (int) $p->max_loads_per_month,
            ])
            ->all();
    }
}
