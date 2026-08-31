<?php

declare(strict_types=1);

namespace App\Actions\Tenancy;

use App\Enums\ConsentType;
use App\Enums\Locale;
use App\Enums\Role;
use App\Enums\SubscriptionStatus;
use App\Enums\TenantStatus;
use App\Enums\UserStatus;
use App\Models\ConsentRecord;
use App\Models\SaasPlan;
use App\Models\Tenant;
use App\Models\TenantBranding;
use App\Models\TenantSetting;
use App\Models\TenantSubscription;
use App\Models\User;
use App\Models\UserTenantMembership;
use App\Support\Finance\DefaultExpenseCategories;
use App\Support\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Da de alta una empresa nueva.
 *
 * Todo ocurre dentro de UNA transacción, y eso no es ceremonia: hay siete filas
 * en seis tablas y un fallo a la mitad dejaría una empresa sin ajustes, o un
 * usuario sin pertenencia — es decir, alguien que puede entrar y no ve nada, sin
 * ninguna pantalla desde la que arreglarlo.
 *
 * Lo que NO hace: cobrar. El alta crea la suscripción en estado `trialing` con
 * la fecha de fin de prueba del plan. Stripe entra cuando la prueba termina o
 * cuando el usuario añade una tarjeta, y hasta entonces `stripe_customer_id`
 * está en NULL a propósito. Pedir una tarjeta para una prueba de catorce días
 * que el propio texto anuncia como «sin tarjeta» sería mentir en el formulario.
 */
final class ProvisionTenant
{
    public function __construct(private readonly TenantContext $context) {}

    /**
     * @param  array{
     *     company_name: string, slug?: string|null, plan_code: string,
     *     first_name: string, last_name: string, email: string, password: string,
     *     locale: string, timezone?: string|null,
     *     ip: string|null, user_agent: string|null,
     * }  $input
     * @return array{tenant: Tenant, user: User}
     */
    public function __invoke(array $input): array
    {
        return DB::transaction(function () use ($input): array {
            $plan = SaasPlan::where('code', $input['plan_code'])->where('is_public', true)->firstOrFail();
            $locale = Locale::from($input['locale']);

            $tenant = Tenant::create([
                'slug' => $this->uniqueSlug($input['slug'] ?? $input['company_name']),
                'legal_name' => $input['company_name'],
                'display_name' => $input['company_name'],
                // `provisioning` y no `trialing`: la empresa existe pero todavía
                // no está lista para operar. Lo pasa a `trialing` el propio
                // proceso, al final, cuando ya están los ajustes y la pertenencia.
                'status' => TenantStatus::Provisioning,
                'default_locale' => $locale,
                'default_timezone' => $input['timezone'] ?? 'America/New_York',
            ]);

            // A partir de aquí se actúa EN NOMBRE de la empresa recién creada, de
            // modo que el scope global rellene tenant_id sin pasarlo a mano en
            // cada create() — y sin poder equivocarse de empresa.
            return $this->context->runAs($tenant->id, function () use ($tenant, $plan, $locale, $input): array {
                TenantSetting::create([]);
                TenantBranding::create([]);

                // Sin categorías de gasto nadie puede dar de alta un gasto:
                // `expenses.category_id` es NOT NULL. Hasta ahora solo las creaba
                // el sembrador de demostración, así que una empresa dada de alta
                // por el formulario público se quedaba con la pantalla de gastos
                // inservible.
                DefaultExpenseCategories::ensureFor((string) $tenant->id);

                TenantSubscription::create([
                    'plan_id' => $plan->id,
                    'status' => SubscriptionStatus::Trialing,
                    'trial_ends_at' => now()->addDays($plan->trial_days),
                    'current_period_start' => now(),
                    'current_period_end' => now()->addDays($plan->trial_days),
                    // Sujeta a los topes de su plan DESDE EL PRIMER MINUTO.
                    //
                    // Quien contrata hoy un plan que dice cinco usuarios recibe
                    // un plan de cinco usuarios. La excepción son las empresas
                    // que ya existían cuando los topes no se aplicaban —esas
                    // llevan la columna nula y hay que encenderlas a mano, sin
                    // sorpresas— pero una empresa nueva no tiene nada de lo que
                    // sorprenderse: nace conociendo su tope y con el contador a
                    // cero. Ver App\Support\Plans\Limits.
                    'limits_enforced_at' => now(),
                ]);

                $user = User::create([
                    'email' => $input['email'],
                    'password' => $input['password'],
                    'first_name' => $input['first_name'],
                    'last_name' => $input['last_name'],
                    'locale' => $locale,
                    'timezone' => $input['timezone'] ?? 'America/New_York',
                    // Pendiente de verificar: la cuenta existe pero no entra
                    // hasta confirmar el correo. Ver App\Actions\Auth\AttemptLogin,
                    // que rechaza cualquier estado que no sea `active`.
                    'status' => UserStatus::PendingVerification,
                ]);

                UserTenantMembership::create([
                    'user_id' => $user->id,
                    'role' => Role::Admin,
                    'status' => 'active',
                    'is_primary_contact' => true,
                    'accepted_at' => now(),
                ]);

                foreach ([ConsentType::PrivacyPolicy, ConsentType::TermsAndConditions] as $type) {
                    ConsentRecord::create([
                        'user_id' => $user->id,
                        'subject_email' => $user->email,
                        'consent_type' => $type,
                        // La versión de la política queda GRABADA en el registro.
                        // Un consentimiento que solo dice «aceptó» no prueba a
                        // qué texto aceptó, y el texto cambia.
                        'policy_version' => (string) config('legal.policy_version'),
                        'granted' => true,
                        'locale' => $locale,
                        'ip_address' => $input['ip'],
                        'user_agent' => $input['user_agent'] === null
                            ? null : mb_substr($input['user_agent'], 0, 1000),
                    ]);
                }

                $tenant->forceFill([
                    'status' => TenantStatus::Trialing,
                    'provisioned_at' => now(),
                ])->save();

                return ['tenant' => $tenant, 'user' => $user];
            });
        });
    }

    /**
     * Un slug legible y libre, derivado del nombre.
     *
     * Se reintenta con sufijo numérico en vez de meterle un UUID: el slug sale en
     * la URL del portal del transportista, y `acme-dispatch-2` es infinitamente
     * más útil al teléfono que `acme-dispatch-9f3a71c4`.
     */
    private function uniqueSlug(string $source): string
    {
        $base = Str::limit(Str::slug($source), 55, '');

        if ($base === '') {
            $base = 'dispatch';
        }

        $candidate = $base;
        $suffix = 1;

        // El slug es único en TODA la plataforma, no por empresa, así que la
        // comprobación va sin frontera.
        while ($this->context->withoutTenant(
            fn (): bool => Tenant::withTrashed()->where('slug', $candidate)->exists()
        )) {
            $suffix++;
            $candidate = "{$base}-{$suffix}";
        }

        return $candidate;
    }
}
