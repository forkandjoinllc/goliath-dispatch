<?php

declare(strict_types=1);

namespace App\Http\Controllers\Platform;

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
use Inertia\Inertia;
use Inertia\Response;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * Los planes que se venden.
 *
 * `saas_plans` la siembra el despliegue y hasta ahora solo la leía el formulario
 * de alta pública, para validar que el plan elegido existe y es público. Nadie
 * podía ver cuántas empresas hay en cada plan, ni cambiar un precio, ni retirar
 * uno de la venta sin entrar en la base de datos.
 *
 * Dos cosas que se pueden cambiar y una que no:
 *
 *  - Se cambian el precio, los topes, los días de prueba y si el plan se ofrece
 *    públicamente. Cambiar un precio NO toca a quien ya está suscrito: su fila
 *    de `tenant_subscriptions` apunta al plan, y el importe que se le cobra sale
 *    de la pasarela, no de aquí. Que un cambio de tarifa no reescriba lo pactado
 *    con los clientes actuales es deliberado.
 *  - NO se borra un plan que alguien está usando. Un plan sin empresas se puede
 *    retirar de la venta (`is_public = false`), que es lo que de verdad se
 *    quiere hacer: dejar de ofrecerlo sin romper a quien lo tiene.
 *
 * El `code` no se edita nunca: es lo que manda el formulario de alta pública y
 * lo que apunta a Stripe. Renombrarlo rompería las dos cosas en silencio.
 */
final class PlanController
{
    use InertiaPage;

    public function index(Request $request, CurrentActor $current, PermissionChecker $checker): Response
    {
        $actor = $current->require();
        $policy = $current->policy();
        $checker->authorize($actor, 'platform:plan:read', null, $policy);

        $this->usesDictionary($request, ['platform', 'nav', 'common', 'validation']);

        $planes = app(TenantContext::class)->withoutTenant(fn () => DB::table('saas_plans as p')
            ->leftJoin('tenant_subscriptions as s', 's.plan_id', '=', 'p.id')
            ->whereNull('p.deleted_at')
            ->groupBy(
                'p.id', 'p.code', 'p.name_en', 'p.name_es', 'p.monthly_price_cents',
                'p.trial_days', 'p.max_users', 'p.max_carriers', 'p.max_loads_per_month',
                'p.is_public', 'p.sort_order', 'p.stripe_price_id',
            )
            ->orderBy('p.sort_order')
            ->selectRaw('p.id, p.code, p.name_en, p.name_es, p.monthly_price_cents, p.trial_days,
                p.max_users, p.max_carriers, p.max_loads_per_month, p.is_public, p.sort_order,
                p.stripe_price_id, count(s.id) as tenants')
            ->get());

        return Inertia::render('Platform/Plans/Index', [
            'plans' => $planes->map(static fn (object $p): array => [
                'id' => (string) $p->id,
                'code' => (string) $p->code,
                'nameEn' => (string) $p->name_en,
                'nameEs' => (string) $p->name_es,
                'monthlyPriceCents' => (int) $p->monthly_price_cents,
                'trialDays' => (int) $p->trial_days,
                'maxUsers' => $p->max_users === null ? null : (int) $p->max_users,
                'maxCarriers' => $p->max_carriers === null ? null : (int) $p->max_carriers,
                'maxLoadsPerMonth' => $p->max_loads_per_month === null ? null : (int) $p->max_loads_per_month,
                'isPublic' => (bool) $p->is_public,
                'stripePriceId' => $p->stripe_price_id,
                'tenants' => (int) $p->tenants,
            ])->all(),
            'can' => [
                'manage' => $checker->can($actor, 'platform:plan:manage', null, $policy)->allowed,
            ],
        ]);
    }

    public function update(Request $request, string $plan, CurrentActor $current, PermissionChecker $checker): RedirectResponse
    {
        $actor = $current->require();
        $policy = $current->policy();
        $checker->authorize($actor, 'platform:plan:read', null, $policy);
        $checker->authorize($actor, 'platform:plan:manage', null, $policy);

        $antes = app(TenantContext::class)->withoutTenant(fn () => DB::table('saas_plans')
            ->where('id', $plan)
            ->whereNull('deleted_at')
            ->first(['id', 'code', 'monthly_price_cents', 'trial_days', 'max_users',
                'max_carriers', 'max_loads_per_month', 'is_public']));

        if ($antes === null) {
            throw new NotFoundHttpException;
        }

        $data = $request->validate([
            // `code` no está: es lo que manda el alta pública y lo que apunta a
            // Stripe. Renombrarlo rompería las dos cosas sin un solo error.
            'monthly_price_cents' => ['required', 'integer', 'min:0', 'max:100000000'],
            'trial_days' => ['required', 'integer', 'min:0', 'max:365'],
            'max_users' => ['nullable', 'integer', 'min:1', 'max:100000'],
            'max_carriers' => ['nullable', 'integer', 'min:1', 'max:100000'],
            'max_loads_per_month' => ['nullable', 'integer', 'min:1', 'max:1000000'],
            'is_public' => ['required', 'boolean'],
        ]);

        app(TenantContext::class)->withoutTenant(fn () => DB::table('saas_plans')
            ->where('id', $antes->id)
            ->update([...$data, 'updated_at' => CarbonImmutable::now()]));

        // Cambiar lo que se cobra es de las cosas por las que después se
        // pregunta. `settings.updated` es la acción que más se le parece del
        // vocabulario portado; el `entity_type` la distingue.
        Audit::record(
            $actor,
            AuditAction::SettingsUpdated,
            entityType: 'saas_plan',
            entityId: (string) $antes->id,
            entityLabel: (string) $antes->code,
            before: (array) $antes,
            after: $data,
        );

        return back()->with('success', __('platform.flash.planSaved'));
    }
}
