<?php

declare(strict_types=1);

use App\Enums\Role;
use App\Enums\SubscriptionStatus;
use App\Enums\TenantStatus;
use App\Enums\UserStatus;
use App\Models\ConsentRecord;
use App\Models\Tenant;
use App\Models\TenantBranding;
use App\Models\TenantSetting;
use App\Models\TenantSubscription;
use App\Models\User;
use App\Models\UserTenantMembership;
use App\Support\TenantContext;
use Database\Seeders\SaasPlanSeeder;
use Illuminate\Auth\Notifications\VerifyEmail;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Str;

uses(DatabaseTransactions::class);

beforeEach(function () {
    RateLimiter::clear('');
    app(TenantContext::class)->forget();
    $this->seed(SaasPlanSeeder::class);
    Notification::fake();
});

afterEach(fn () => app(TenantContext::class)->forget());

function signupToken(int $secondsAgo = 10): string
{
    $payload = json_encode(['f' => 'signup', 't' => (int) ((microtime(true) - $secondsAgo) * 1000)]);
    $body = rtrim(strtr(base64_encode((string) $payload), '+/', '-_'), '=');
    $key = (string) config('app.key');
    if (str_starts_with($key, 'base64:')) {
        $key = (string) base64_decode(substr($key, 7), true);
    }

    return $body.'.'.hash_hmac('sha256', $body, $key);
}

function signupData(array $overrides = []): array
{
    return [
        'company_name' => 'Fork and Join Dispatch',
        'plan_code' => 'growth',
        'first_name' => 'Luis',
        'last_name' => 'Ramírez',
        'email' => 'luis-'.Str::random(6).'@forkandjoin.test',
        'password' => 'caballo-bateria-grapa-2026',
        'password_confirmation' => 'caballo-bateria-grapa-2026',
        'locale' => 'es',
        'timezone' => 'America/Chicago',
        'privacy_consent' => true,
        'terms_consent' => true,
        'hp_field' => '',
        'form_token' => signupToken(),
        ...$overrides,
    ];
}

/* ── La página ──────────────────────────────────────────────────────────── */

it('muestra el alta con los planes públicos', function () {
    $this->get('/signup')->assertOk()->assertInertia(fn ($page) => $page
        ->component('Auth/Signup')
        ->has('plans', 3)
        ->where('plans.0.code', 'starter')
        ->where('plans.1.code', 'growth')
        // Céntimos enteros hasta el borde: el formateo a moneda pasa en el
        // cliente, con Intl y el idioma ya resuelto.
        ->where('plans.1.monthlyPriceCents', 49900)
        ->has('formToken')
    );
});

it('sirve el alta también con un contexto de plataforma, sin lanzar', function () {
    // `saas_plans` no tiene tenant_id; consultarlo desde el sitio público no debe
    // toparse con el scope de empresa.
    $this->get('/signup')->assertOk();
});

/* ── El alta completa ───────────────────────────────────────────────────── */

it('crea la empresa entera en una transacción', function () {
    $data = signupData();

    $this->post('/signup', $data)->assertRedirect('/signup/done');

    app(TenantContext::class)->withoutTenant(function () use ($data) {
        $tenant = Tenant::where('legal_name', 'Fork and Join Dispatch')->firstOrFail();

        // La empresa termina en `trialing`, no en `provisioning`: el propio
        // proceso la promueve al final, cuando ya están ajustes y pertenencia.
        expect($tenant->status)->toBe(TenantStatus::Trialing);
        expect($tenant->provisioned_at)->not->toBeNull();
        expect($tenant->slug)->toBe('fork-and-join-dispatch');
        expect($tenant->default_locale->value)->toBe('es');
        expect($tenant->default_timezone)->toBe('America/Chicago');

        app(TenantContext::class)->runAs($tenant->id, function () use ($tenant, $data) {
            expect(TenantSetting::where('tenant_id', $tenant->id)->count())->toBe(1);
            expect(TenantBranding::where('tenant_id', $tenant->id)->count())->toBe(1);

            $subscription = TenantSubscription::where('tenant_id', $tenant->id)->firstOrFail();
            expect($subscription->status)->toBe(SubscriptionStatus::Trialing);
            expect($subscription->trial_ends_at)->not->toBeNull();
            // Nada de Stripe todavía: el texto promete «sin tarjeta».
            expect($subscription->stripe_customer_id)->toBeNull();
            expect($subscription->stripe_subscription_id)->toBeNull();

            $user = User::where('email_normalized', $data['email'])->firstOrFail();
            expect($user->status)->toBe(UserStatus::PendingVerification);
            expect($user->locale->value)->toBe('es');

            $membership = UserTenantMembership::where('user_id', $user->id)->firstOrFail();
            expect($membership->role)->toBe(Role::Admin);
            expect($membership->is_primary_contact)->toBeTrue();
            expect($membership->accepted_at)->not->toBeNull();
        });
    });
});

it('graba los dos consentimientos con la versión del texto', function () {
    $data = signupData();
    $this->post('/signup', $data);

    app(TenantContext::class)->withoutTenant(function () use ($data) {
        $records = ConsentRecord::where('subject_email', $data['email'])->get();

        expect($records)->toHaveCount(2);
        expect($records->pluck('consent_type')->map(fn ($t) => $t->value)->sort()->values()->all())
            ->toBe(['privacy_policy', 'terms_and_conditions']);

        foreach ($records as $record) {
            expect($record->granted)->toBeTrue();
            // Un consentimiento que solo dice «aceptó» no prueba a QUÉ aceptó.
            expect($record->policy_version)->toBe(config('legal.policy_version'));
            expect($record->locale->value)->toBe('es');
            expect($record->ip_address)->not->toBeNull();
        }
    });
});

it('no inicia sesión: manda a verificar el correo', function () {
    $data = signupData();
    $this->post('/signup', $data);

    // Iniciar sesión aquí se saltaría la verificación que el propio flujo acaba
    // de prometer.
    $this->assertGuest();

    app(TenantContext::class)->withoutTenant(function () use ($data) {
        $user = User::where('email_normalized', $data['email'])->firstOrFail();
        Notification::assertSentTo($user, VerifyEmail::class);
    });
});

it('desambigua los slugs sin recurrir a un UUID', function () {
    $this->post('/signup', signupData(['company_name' => 'Acme Dispatch']));
    RateLimiter::clear('');
    $this->post('/signup', signupData(['company_name' => 'Acme Dispatch']));

    app(TenantContext::class)->withoutTenant(function () {
        $slugs = Tenant::where('legal_name', 'Acme Dispatch')->pluck('slug')->sort()->values()->all();
        // `acme-dispatch-2` sirve al teléfono; `acme-dispatch-9f3a71c4` no.
        expect($slugs)->toBe(['acme-dispatch', 'acme-dispatch-2']);
    });
});

/* ── Validación ─────────────────────────────────────────────────────────── */

it('rechaza un plan que no es público ni existe', function () {
    $this->post('/signup', signupData(['plan_code' => 'no-existe']))
        ->assertSessionHasErrors('plan_code');

    DB::table('saas_plans')->where('code', 'fleet')->update(['is_public' => false]);
    RateLimiter::clear('');
    $this->post('/signup', signupData(['plan_code' => 'fleet']))
        ->assertSessionHasErrors('plan_code');
});

it('rechaza un correo ya usado', function () {
    $data = signupData();
    $this->post('/signup', $data)->assertSessionHasNoErrors();
    RateLimiter::clear('');
    $this->post('/signup', signupData(['email' => $data['email']]))
        ->assertSessionHasErrors('email');
});

it('exige una contraseña larga y confirmada', function () {
    $this->post('/signup', signupData(['password' => 'corta1', 'password_confirmation' => 'corta1']))
        ->assertSessionHasErrors('password');

    RateLimiter::clear('');
    $this->post('/signup', signupData(['password_confirmation' => 'otra-cosa-distinta-2026']))
        ->assertSessionHasErrors('password');
});

it('exige los dos consentimientos', function () {
    foreach (['privacy_consent', 'terms_consent'] as $field) {
        RateLimiter::clear('');
        $this->post('/signup', signupData([$field => false]))->assertSessionHasErrors($field);
    }
});

it('rechaza una zona horaria inventada', function () {
    $this->post('/signup', signupData(['timezone' => 'Marte/Olimpo']))
        ->assertSessionHasErrors('timezone');
});

it('el alta lleva las mismas defensas que los demás formularios públicos', function () {
    $this->post('/signup', signupData(['hp_field' => 'bot']))->assertSessionHasErrors('hp_field');
    RateLimiter::clear('');
    $this->post('/signup', signupData(['form_token' => 'inventado.firma']))->assertSessionHasErrors('email');
});

it('no deja nada a medias si la validación falla', function () {
    $this->post('/signup', signupData(['plan_code' => 'no-existe']));

    app(TenantContext::class)->withoutTenant(function () {
        expect(Tenant::where('legal_name', 'Fork and Join Dispatch')->count())->toBe(0);
        expect(User::where('email_normalized', 'like', 'luis-%')->count())->toBe(0);
    });
});

it('limita las altas por IP', function () {
    for ($i = 0; $i < 3; $i++) {
        $this->post('/signup', signupData())->assertStatus(302);
    }
    $this->post('/signup', signupData())->assertStatus(429);
});

/* ── La página final ────────────────────────────────────────────────────── */

it('la página final muestra el correo al que se envió la verificación', function () {
    $data = signupData();
    $this->post('/signup', $data);

    $this->get('/signup/done')->assertOk()->assertInertia(fn ($page) => $page
        ->component('Auth/SignupDone')
        ->where('email', $data['email'])
    );
});

it('conserva las mayúsculas que escribió la persona, pero la unicidad no distingue', function () {
    $mixed = 'Luis.Ramirez-'.Str::random(4).'@ForkAndJoin.test';

    $this->post('/signup', signupData(['email' => $mixed]))->assertSessionHasNoErrors();

    app(TenantContext::class)->withoutTenant(function () use ($mixed) {
        $user = User::where('email_normalized', mb_strtolower($mixed))->firstOrFail();
        // Lo que se muestra es lo que escribió: así se ve un dominio mal tecleado.
        expect($user->email)->toBe($mixed);
        expect($user->email_normalized)->toBe(mb_strtolower($mixed));
    });

    // Y la misma dirección en otra caja se rechaza igual.
    RateLimiter::clear('');
    $this->post('/signup', signupData(['email' => mb_strtoupper($mixed)]))
        ->assertSessionHasErrors('email');
});
