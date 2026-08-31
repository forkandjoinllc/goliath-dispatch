<?php

declare(strict_types=1);

use App\Enums\Role;
use App\Enums\UserStatus;
use App\Models\User;
use App\Models\UserTenantMembership;
use App\Support\Plans\Limits;
use App\Support\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Inertia\Testing\AssertableInertia as Assert;
use Tests\Support\Scenario;

uses(DatabaseTransactions::class);

beforeEach(function () {
    app(TenantContext::class)->forget();
    $this->scenario = Scenario::create();
});

afterEach(fn () => app(TenantContext::class)->forget());

/**
 * Un super administrador de plataforma con pertenencia a la empresa del
 * escenario.
 *
 * `Scenario` se salta ese rol a propósito, así que se monta aquí. La pertenencia
 * hace falta para que el acceso deje la empresa activa en la sesión: sin ella el
 * actor entra sin empresa y las pantallas de plataforma se probarían en un
 * contexto que no es el que se usa de verdad.
 */
function superAdministrador(Scenario $scenario): User
{
    return app(TenantContext::class)->runAs($scenario->tenant->id, function () use ($scenario): User {
        $user = User::create([
            'email' => 'plataforma+'.Str::random(8).'@escenario.test',
            'password' => 'contraseña-de-prueba-1',
            'first_name' => 'Plataforma',
            'last_name' => 'Prueba',
            'status' => UserStatus::Active,
            'email_verified_at' => now(),
        ]);

        DB::table('users')->where('id', $user->id)->update(['is_platform_super_admin' => 1]);

        UserTenantMembership::create([
            'tenant_id' => $scenario->tenant->id,
            'user_id' => $user->id,
            'role' => Role::PlatformSuperAdmin,
            'status' => 'active',
            'accepted_at' => now(),
        ]);

        return $user;
    });
}

/** Entra con un correo concreto, como hace `signIn` con los roles del escenario. */
function entrarComo(User $user): void
{
    static $n = 0;
    $n++;

    if (auth()->check()) {
        auth()->logout();
        test()->flushSession();
    }

    test()
        ->withServerVariables(['REMOTE_ADDR' => '198.51.100.'.(($n % 250) + 1)])
        ->post('/login', ['email' => $user->email, 'password' => 'contraseña-de-prueba-1'])
        ->assertRedirect();

    test()->withCookie(config('session.cookie'), session()->getId());
}

/**
 * Un plan sobre el que probar.
 *
 * `saas_plans` la siembra el DESPLIEGUE (ver SaasPlanSeeder), no las
 * migraciones, así que la base de pruebas está vacía. Se crea aquí en vez de
 * correr el sembrador para no atar estas pruebas a los tres planes comerciales
 * de hoy: si mañana cambian de nombre o de precio, esto no debería fallar.
 */
function planDePrueba(): object
{
    $existente = DB::table('saas_plans')->whereNull('deleted_at')->first(['id', 'code', 'monthly_price_cents']);

    if ($existente !== null) {
        return $existente;
    }

    $id = (string) Str::uuid();

    DB::table('saas_plans')->insert([
        'id' => $id,
        'code' => 'prueba',
        'name_en' => 'Test plan',
        'name_es' => 'Plan de prueba',
        'monthly_price_cents' => 9900,
        'trial_days' => 14,
        'max_users' => 10,
        'max_carriers' => 25,
        'is_public' => 1,
        'sort_order' => 1,
        'created_at' => now(),
        'updated_at' => now(),
    ]);

    return DB::table('saas_plans')->where('id', $id)->first(['id', 'code', 'monthly_price_cents']);
}

/* ── Quién puede mirar la plataforma ────────────────────────────────────── */

it('el super administrador ve la lista de empresas', function () {
    entrarComo(superAdministrador($this->scenario));

    $this->get('/platform/tenants')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page->component('Platform/Tenants/Index'));
});

it('el administrador de una empresa NO ve la plataforma', function () {
    signIn($this->scenario, Role::Admin);

    // Es lo más grave que se puede filtrar: la lista de TODOS los clientes de
    // Goliath, con su plan y lo que pagan.
    $this->get('/platform/tenants')->assertForbidden();
    $this->get('/platform/plans')->assertForbidden();
});

it('el despachador tampoco', function () {
    signIn($this->scenario, Role::Dispatcher);

    $this->get('/platform/tenants')->assertForbidden();
});

it('la lista enseña TODAS las empresas, que es de lo que se trata', function () {
    $otra = Scenario::create();
    app(TenantContext::class)->forget();

    entrarComo(superAdministrador($this->scenario));

    $this->get('/platform/tenants')->assertInertia(function (Assert $page) use ($otra) {
        $ids = collect($page->toArray()['props']['tenants']['data'])->pluck('id')->all();

        expect($ids)->toContain($this->scenario->tenant->id);
        expect($ids)->toContain($otra->tenant->id);
    });
});

/* ── Suspender significa algo ───────────────────────────────────────────── */

it('suspender deja fuera a la empresa entera', function () {
    $plataforma = superAdministrador($this->scenario);

    // Antes: el administrador entra sin problema.
    signIn($this->scenario, Role::Admin);
    $this->get('/loads')->assertOk();

    entrarComo($plataforma);

    $this->post("/platform/tenants/{$this->scenario->tenant->id}/suspension", [
        'action' => 'suspend',
        'reason' => 'Impago de tres meses',
    ])->assertRedirect()->assertSessionHasNoErrors();

    expect(DB::table('tenants')->where('id', $this->scenario->tenant->id)->value('status'))
        ->toBe('suspended');

    // Después: no entra a ninguna parte, y ve una pantalla que lo explica.
    signIn($this->scenario, Role::Admin);

    $this->get('/loads')
        ->assertForbidden()
        ->assertInertia(fn (Assert $page) => $page->component('App/Suspended'));

    $this->get('/invoices')->assertForbidden();
});

it('el super administrador sigue entrando en una empresa suspendida', function () {
    $plataforma = superAdministrador($this->scenario);
    entrarComo($plataforma);

    $this->post("/platform/tenants/{$this->scenario->tenant->id}/suspension", [
        'action' => 'suspend',
        'reason' => 'Impago de tres meses',
    ])->assertRedirect();

    // Un guardia que deja fuera también a quien puede levantar la suspensión
    // convierte un impago en una avería.
    $this->get('/platform/tenants')->assertOk();
    $this->get("/platform/tenants/{$this->scenario->tenant->id}")->assertOk();
});

it('deja cerrar sesión y cambiar de empresa aunque esté suspendida', function () {
    entrarComo(superAdministrador($this->scenario));

    $this->post("/platform/tenants/{$this->scenario->tenant->id}/suspension", [
        'action' => 'suspend',
        'reason' => 'Impago de tres meses',
    ])->assertRedirect();

    signIn($this->scenario, Role::Admin);

    // Sin estas dos salidas, quien trabaja en dos empresas se queda encerrado
    // y cualquiera se queda sin poder ni cerrar sesión. Lo que se comprueba es
    // que el guardia NO las cortó: si lo hubiera hecho, contestarían 403 con la
    // pantalla de suspensión en vez de seguir su camino.
    $this->post('/switch-tenant', ['tenant_id' => $this->scenario->tenant->id])
        ->assertRedirect();
    $this->post('/logout')->assertRedirect();
});

it('reactivar devuelve el acceso', function () {
    $plataforma = superAdministrador($this->scenario);
    entrarComo($plataforma);

    $this->post("/platform/tenants/{$this->scenario->tenant->id}/suspension", [
        'action' => 'suspend', 'reason' => 'Impago de tres meses',
    ])->assertRedirect();

    entrarComo($plataforma);

    $this->post("/platform/tenants/{$this->scenario->tenant->id}/suspension", [
        'action' => 'reactivate', 'reason' => 'Pagado el 29 de agosto',
    ])->assertRedirect()->assertSessionHasNoErrors();

    signIn($this->scenario, Role::Admin);
    $this->get('/loads')->assertOk();
});

it('exige un motivo para suspender', function () {
    entrarComo(superAdministrador($this->scenario));

    $this->post("/platform/tenants/{$this->scenario->tenant->id}/suspension", ['action' => 'suspend'])
        ->assertSessionHasErrors('reason');

    expect(DB::table('tenants')->where('id', $this->scenario->tenant->id)->value('status'))
        ->not->toBe('suspended');
});

it('deja el rastro de la suspensión con su motivo', function () {
    entrarComo(superAdministrador($this->scenario));

    $this->post("/platform/tenants/{$this->scenario->tenant->id}/suspension", [
        'action' => 'suspend',
        'reason' => 'Impago de tres meses',
    ])->assertRedirect();

    $evento = DB::table('audit_events')
        ->where('entity_id', $this->scenario->tenant->id)
        ->where('action', 'tenant.suspended')
        ->first();

    expect($evento)->not->toBeNull();
    expect($evento->reason)->toBe('Impago de tres meses');
    expect(json_decode((string) $evento->after_summary, true))->toBe(['status' => 'suspended']);
});

/* ── Planes ─────────────────────────────────────────────────────────────── */

it('el super administrador ve los planes con cuántas empresas tiene cada uno', function () {
    planDePrueba();

    entrarComo(superAdministrador($this->scenario));

    $this->get('/platform/plans')
        ->assertOk()
        ->assertInertia(function (Assert $page) {
            $planes = collect($page->toArray()['props']['plans']);

            expect($planes)->not->toBeEmpty();
            expect($planes->first())->toHaveKeys(['code', 'monthlyPriceCents', 'tenants']);
        });
});

it('cambia el precio de un plan y lo deja en la pista', function () {
    entrarComo(superAdministrador($this->scenario));

    $plan = planDePrueba();

    $this->patch("/platform/plans/{$plan->id}", [
        'monthly_price_cents' => 19900,
        'trial_days' => 21,
        'max_users' => null,
        'max_carriers' => 50,
        'max_loads_per_month' => null,
        'is_public' => true,
    ])->assertRedirect()->assertSessionHasNoErrors();

    $despues = DB::table('saas_plans')->where('id', $plan->id)->first();

    expect((int) $despues->monthly_price_cents)->toBe(19900);
    expect((int) $despues->trial_days)->toBe(21);
    // En blanco significa «sin tope», no cero.
    expect($despues->max_users)->toBeNull();
    expect((int) $despues->max_carriers)->toBe(50);

    expect(DB::table('audit_events')
        ->where('entity_type', 'saas_plan')
        ->where('entity_id', $plan->id)
        ->exists())->toBeTrue();
});

it('no deja tocar el código de un plan', function () {
    entrarComo(superAdministrador($this->scenario));

    $plan = planDePrueba();

    // El código es lo que manda el alta pública y lo que apunta a Stripe:
    // renombrarlo rompería las dos cosas sin un solo error.
    $this->patch("/platform/plans/{$plan->id}", [
        'code' => 'renombrado',
        'monthly_price_cents' => 100,
        'trial_days' => 14,
        'is_public' => true,
    ])->assertRedirect();

    expect(DB::table('saas_plans')->where('id', $plan->id)->value('code'))->toBe($plan->code);
});

/* ── La empresa ve su propio plan ───────────────────────────────────────── */

it('la empresa ve su plan en Ajustes', function () {
    signIn($this->scenario, Role::Admin);

    $this->get('/settings')->assertOk()->assertInertia(function (Assert $page) {
        $suscripcion = $page->toArray()['props']['subscription'];

        // El escenario no crea suscripción; lo que se comprueba es que la
        // pantalla la pide y aguanta que no haya ninguna.
        expect(array_key_exists('subscription', $page->toArray()['props']))->toBeTrue();
        expect($suscripcion)->toBeNull();
    });
});

it('enseña el plan cuando la empresa tiene suscripción', function () {
    $plan = planDePrueba();

    DB::table('tenant_subscriptions')->insert([
        'id' => (string) Str::uuid(),
        'tenant_id' => $this->scenario->tenant->id,
        'plan_id' => $plan->id,
        'status' => 'trialing',
        'trial_ends_at' => now()->addDays(10),
        'created_at' => now(),
        'updated_at' => now(),
    ]);

    signIn($this->scenario, Role::Admin);

    $this->get('/settings')->assertInertia(function (Assert $page) use ($plan) {
        $s = $page->toArray()['props']['subscription'];

        expect($s['status'])->toBe('trialing');
        expect($s['planCode'])->toBe($plan->code);
        expect($s['trialEndsOn'])->not->toBeNull();
    });
});

/* ── El barrido de periodos de prueba ───────────────────────────────────── */

/** Le pone a la empresa del escenario una suscripción en prueba. */
function pruebaQueAcaba(Scenario $scenario, int $enDias): string
{
    $plan = planDePrueba();
    $id = (string) Str::uuid();

    DB::table('tenant_subscriptions')->insert([
        'id' => $id,
        'tenant_id' => $scenario->tenant->id,
        'plan_id' => $plan->id,
        'status' => 'trialing',
        'trial_ends_at' => now()->addDays($enDias),
        'created_at' => now(),
        'updated_at' => now(),
    ]);

    return $id;
}

it('avisa antes de que se acabe la prueba, sin tocar el estado', function () {
    $id = pruebaQueAcaba($this->scenario, 3);

    Artisan::call('notifications:sweep', ['--tenant' => $this->scenario->tenant->id]);

    expect(DB::table('tenant_subscriptions')->where('id', $id)->value('status'))->toBe('trialing');

    expect(DB::table('notifications')
        ->where('tenant_id', $this->scenario->tenant->id)
        ->where('event_key', 'subscription.trial_ending')
        ->exists())->toBeTrue();
});

it('no dice nada de una prueba que queda lejos', function () {
    pruebaQueAcaba($this->scenario, 60);

    Artisan::call('notifications:sweep', ['--tenant' => $this->scenario->tenant->id]);

    expect(DB::table('notifications')
        ->where('tenant_id', $this->scenario->tenant->id)
        ->where('event_key', 'like', 'subscription.%')
        ->count())->toBe(0);
});

it('cierra la prueba vencida como impagada, y NO cierra el acceso', function () {
    $id = pruebaQueAcaba($this->scenario, -1);

    Artisan::call('notifications:sweep', ['--tenant' => $this->scenario->tenant->id]);

    expect(DB::table('tenant_subscriptions')->where('id', $id)->value('status'))->toBe('past_due');
    expect(DB::table('tenant_subscriptions')->where('id', $id)->value('past_due_since'))->not->toBeNull();

    // Dejar sin sistema a una empresa porque se le acabó la prueba un martes es
    // una decisión de negocio. El barrido mueve y avisa; suspender sigue siendo
    // un acto humano, con motivo y con rastro.
    expect(DB::table('tenants')->where('id', $this->scenario->tenant->id)->value('status'))
        ->not->toBe('suspended');

    signIn($this->scenario, Role::Admin);
    $this->get('/loads')->assertOk();
});

it('no vuelve a avisar de la misma prueba cada mañana', function () {
    pruebaQueAcaba($this->scenario, 3);

    $cuenta = fn (): int => DB::table('notifications')
        ->where('tenant_id', $this->scenario->tenant->id)
        ->where('event_key', 'subscription.trial_ending')
        ->where('channel', 'in_app')
        ->count();

    Artisan::call('notifications:sweep', ['--tenant' => $this->scenario->tenant->id]);
    $trasElPrimero = $cuenta();

    // Son varios avisos porque `tenant:settings:read` lo tienen varios roles, y
    // cada persona recibe el suyo. Lo que NO puede pasar es que crezcan: la
    // deduplicación es por persona y por canal.
    expect($trasElPrimero)->toBeGreaterThan(0);

    Artisan::call('notifications:sweep', ['--tenant' => $this->scenario->tenant->id]);
    Artisan::call('notifications:sweep', ['--tenant' => $this->scenario->tenant->id]);

    expect($cuenta())->toBe($trasElPrimero);
});

it('la pantalla de suspensión llega con su diccionario y con el menú', function () {
    entrarComo(superAdministrador($this->scenario));

    $this->post("/platform/tenants/{$this->scenario->tenant->id}/suspension", [
        'action' => 'suspend', 'reason' => 'Impago de tres meses',
    ])->assertRedirect();

    signIn($this->scenario, Role::Admin);

    // Dos cosas que ya se rompieron una vez y no se ven en un código de estado:
    // la página salía SIN el armazón —y el layout reventaba en el navegador
    // leyendo `shell.nav`— y sin su espacio de diccionario, así que enseñaba
    // `platform.suspended.title` en crudo.
    $this->get('/loads')->assertForbidden()->assertInertia(function (Assert $page) {
        $props = $page->toArray()['props'];

        expect($props['shell'])->not->toBeNull('La pantalla de suspensión llegó sin armazón');
        expect($props['dictionary'])->toHaveKey('platform');
        expect($props['dictionary']['platform']['suspended']['title'])->not->toBeEmpty();
    });
});

/* ── El bloqueo de topes: primero la conversación, después el muro ──────── */

/** Le pone a la empresa del escenario un plan con el tope de usuarios que se pida. */
function planConTopeDeUsuarios(Scenario $scenario, int $tope): void
{
    app(TenantContext::class)->withoutTenant(function () use ($scenario, $tope): void {
        $planId = (string) Str::uuid();

        DB::table('saas_plans')->insert([
            'id' => $planId,
            'code' => 'plat-'.substr($planId, 0, 8),
            'name_en' => 'Test',
            'name_es' => 'Prueba',
            'monthly_price_cents' => 1000,
            'trial_days' => 0,
            'max_users' => $tope,
            'features' => '[]',
            'is_public' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('tenant_subscriptions')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $scenario->tenant->id,
            'plan_id' => $planId,
            'status' => 'active',
            'limits_enforced_at' => null,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    });
}

it('no deja encender el bloqueo sobre una empresa que ya está por encima', function () {
    // Es el freno que hace que esto sea seguro de desplegar. Encenderlo sobre
    // quien ya incumple le corta las altas a la primera, y el cliente se entera
    // por una avería en vez de por una conversación.
    planConTopeDeUsuarios($this->scenario, 1);

    expect(Limits::over((string) $this->scenario->tenant->id))->toContain('users');

    entrarComo(superAdministrador($this->scenario));

    $this->post("/platform/tenants/{$this->scenario->tenant->id}/limits", ['action' => 'enforce'])
        ->assertRedirect();

    expect(session('error'))->not->toBeNull();

    expect(DB::table('tenant_subscriptions')
        ->where('tenant_id', $this->scenario->tenant->id)
        ->value('limits_enforced_at'))->toBeNull();
});

it('lo enciende cuando la empresa está dentro de sus topes, y lo apaga', function () {
    planConTopeDeUsuarios($this->scenario, 500);

    entrarComo(superAdministrador($this->scenario));

    $this->post("/platform/tenants/{$this->scenario->tenant->id}/limits", ['action' => 'enforce'])
        ->assertRedirect()->assertSessionHasNoErrors();

    expect(DB::table('tenant_subscriptions')
        ->where('tenant_id', $this->scenario->tenant->id)
        ->value('limits_enforced_at'))->not->toBeNull();

    // Aflojar no tiene cortapisa: se puede hacer deprisa, que es cuando hace
    // falta.
    $this->post("/platform/tenants/{$this->scenario->tenant->id}/limits", ['action' => 'relax'])
        ->assertRedirect()->assertSessionHasNoErrors();

    expect(DB::table('tenant_subscriptions')
        ->where('tenant_id', $this->scenario->tenant->id)
        ->value('limits_enforced_at'))->toBeNull();
});

it('un administrador de empresa no toca el bloqueo de topes', function () {
    planConTopeDeUsuarios($this->scenario, 500);

    signIn($this->scenario, Role::Admin);

    // En un POST la negativa se sirve como redirección a la pantalla de acceso
    // denegado, no como 403: ver App\Exceptions\AuthorizationException y el
    // middleware de Inertia. Lo que importa es que NO ha tocado nada.
    $this->post("/platform/tenants/{$this->scenario->tenant->id}/limits", ['action' => 'enforce'])
        ->assertRedirect();

    expect(DB::table('tenant_subscriptions')
        ->where('tenant_id', $this->scenario->tenant->id)
        ->value('limits_enforced_at'))->toBeNull();
});
