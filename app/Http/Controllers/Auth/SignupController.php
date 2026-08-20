<?php

declare(strict_types=1);

namespace App\Http\Controllers\Auth;

use App\Actions\Tenancy\ProvisionTenant;
use App\Enums\Locale;
use App\Http\Requests\Auth\SignupRequest;
use App\Models\SaasPlan;
use App\Support\Forms\FormToken;
use App\Support\InertiaPage;
use App\Support\Locales;
use App\Support\Marketing\Site;
use App\Support\TenantContext;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

final class SignupController
{
    use InertiaPage;

    public function show(Request $request): Response
    {
        /** @var Locale $locale */
        $locale = $request->attributes->get('locale', Locales::default());

        $this->usesDictionary($request, ['auth', 'marketing', 'validation']);

        return Inertia::render('Auth/Signup', [
            'plans' => $this->plans($locale),
            'formToken' => FormToken::issue('signup'),
            'locale' => $locale->value,
            'legalLinks' => [
                'privacy' => Site::path($locale, 'privacy'),
                'terms' => Site::path($locale, 'terms'),
            ],
        ]);
    }

    public function store(SignupRequest $request, ProvisionTenant $provision): RedirectResponse
    {
        $data = $request->validated();

        ['user' => $user] = $provision([
            'company_name' => $data['company_name'],
            'plan_code' => $data['plan_code'],
            'first_name' => $data['first_name'],
            'last_name' => $data['last_name'],
            'email' => $data['email'],
            'password' => $data['password'],
            'locale' => $data['locale'],
            'timezone' => $data['timezone'] ?? null,
            'ip' => $request->ip(),
            'user_agent' => $request->userAgent(),
        ]);

        // El usuario NO queda con la sesión iniciada. Su estado es
        // `pending_verification` y AttemptLogin rechaza cualquier estado que no
        // sea `active`; iniciarle sesión aquí sería saltarse la verificación de
        // correo que el propio flujo acaba de prometer.
        $user->sendEmailVerificationNotification();

        return redirect()
            ->route('signup.done')
            ->with('signupEmail', $user->email);
    }

    public function done(Request $request): Response
    {
        $this->usesDictionary($request, ['auth']);

        return Inertia::render('Auth/SignupDone', [
            'email' => $request->session()->get('signupEmail'),
        ]);
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function plans(Locale $locale): array
    {
        // `saas_plans` no tiene tenant_id, así que se consulta sin contexto de
        // empresa. Es correcto: los planes son de la plataforma.
        return app(TenantContext::class)->withoutTenant(fn (): array => SaasPlan::query()
            ->where('is_public', true)
            ->orderBy('sort_order')
            ->get()
            ->map(fn (SaasPlan $plan): array => $this->presentPlan($plan, $locale))
            ->values()
            ->all());
    }

    /**
     * @return array<string, mixed>
     */
    private function presentPlan(SaasPlan $plan, Locale $locale): array
    {
        $spanish = $locale === Locale::Es;

        return [
            'code' => $plan->code,
            'name' => $spanish ? $plan->name_es : $plan->name_en,
            'description' => $spanish ? $plan->description_es : $plan->description_en,
            // Céntimos enteros hasta el borde: el formateo a moneda ocurre en el
            // cliente con Intl, con el idioma ya resuelto. Mandar «$99.00» desde
            // el servidor obligaría a decidir aquí el formato de un idioma que el
            // servidor no debería estar formateando.
            'monthlyPriceCents' => $plan->monthly_price_cents,
            'trialDays' => $plan->trial_days,
            'features' => array_values($plan->features ?? []),
            'limits' => [
                'users' => $plan->max_users,
                'carriers' => $plan->max_carriers,
                'loadsPerMonth' => $plan->max_loads_per_month,
            ],
        ];
    }
}
