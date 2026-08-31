<?php

declare(strict_types=1);

use App\Enums\Role;
use App\Support\Plans\Limits;
use App\Support\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Support\Scenario;

uses(DatabaseTransactions::class);

beforeEach(function () {
    app(TenantContext::class)->forget();
    $this->scenario = Scenario::create();
});

afterEach(fn () => app(TenantContext::class)->forget());

/**
 * Le pone plan y suscripción a la empresa del escenario.
 *
 * `$aplica` es la diferencia entre contar y bloquear: ver la migración
 * 2026_09_05_100000 para por qué esa distinción existe.
 */
function suscribir(
    Scenario $scenario,
    ?int $usuarios = null,
    ?int $transportistas = null,
    ?int $cargas = null,
    bool $aplica = true,
): void {
    app(TenantContext::class)->withoutTenant(function () use ($scenario, $usuarios, $transportistas, $cargas, $aplica): void {
        $planId = (string) Str::uuid();

        DB::table('saas_plans')->insert([
            'id' => $planId,
            'code' => 'prueba-'.substr($planId, 0, 8),
            'name_en' => 'Test',
            'name_es' => 'Prueba',
            'monthly_price_cents' => 1000,
            'trial_days' => 14,
            'max_users' => $usuarios,
            'max_carriers' => $transportistas,
            'max_loads_per_month' => $cargas,
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
            'limits_enforced_at' => $aplica ? now() : null,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    });
}

// ─────────────────────────────────────────────────────── contar frente a bloquear

it('sin suscripción no hay tope', function () {
    // Falta de configuración no es falta de permiso: la misma regla que la
    // validación de sobredimensión del lote 55. Una empresa sin plan no puede
    // quedarse sin poder trabajar porque una consulta devolvió nulo.
    expect(Limits::isFull((string) $this->scenario->tenant->id, Limits::USERS))->toBeFalse();
});

it('con el bloqueo apagado, el tope se cuenta y no impide nada', function () {
    suscribir($this->scenario, usuarios: 1, aplica: false);

    $uso = Limits::usage((string) $this->scenario->tenant->id);

    expect($uso['users']['limit'])->toBe(1)
        ->and($uso['users']['used'])->toBeGreaterThan(1)
        ->and($uso['users']['enforced'])->toBeFalse()
        ->and(Limits::isFull((string) $this->scenario->tenant->id, Limits::USERS))->toBeFalse();
});

it('un plan sin tope nunca se llena', function () {
    suscribir($this->scenario, usuarios: null, aplica: true);

    expect(Limits::isFull((string) $this->scenario->tenant->id, Limits::USERS))->toBeFalse();
});

// ─────────────────────────────────────────────────────────── qué ocupa asiento

it('las cuentas de portal no ocupan asiento y las de plantilla sí', function () {
    // La lectura que hace que el plan tenga sentido. Si cada chófer de cada
    // transportista gastara asiento, el plan que vende cinco usuarios y quince
    // transportistas sería imposible de usar: el tope de transportistas quedaría
    // fuera del alcance por construcción.
    //
    // Se prueba MOVIENDO la aguja, no repitiendo la consulta de Limits con otras
    // palabras: una prueba que recalcula lo que mide no mide nada.
    $tenantId = (string) $this->scenario->tenant->id;

    $antes = Limits::usage($tenantId)['users']['used'];

    $afiliar = function (string $rol) use ($tenantId): void {
        app(TenantContext::class)->withoutTenant(function () use ($tenantId, $rol): void {
            $userId = (string) Str::uuid();

            $correo = $rol.'-'.substr($userId, 0, 8).'@ejemplo.test';

            DB::table('users')->insert([
                'id' => $userId,
                'email' => $correo,
                'email_normalized' => $correo,
                'first_name' => 'Cuenta',
                'last_name' => 'Nueva',
                'locale' => 'es',
                'status' => 'active',
                'created_at' => now(),
                'updated_at' => now(),
            ]);

            DB::table('user_tenant_memberships')->insert([
                'id' => (string) Str::uuid(),
                'tenant_id' => $tenantId,
                'user_id' => $userId,
                'role' => $rol,
                'status' => 'active',
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        });
    };

    $afiliar('driver');
    expect(Limits::usage($tenantId)['users']['used'])->toBe($antes, 'un chófer no gasta asiento');

    $afiliar('carrier');
    expect(Limits::usage($tenantId)['users']['used'])->toBe($antes, 'un transportista tampoco');

    $afiliar('dispatcher');
    expect(Limits::usage($tenantId)['users']['used'])->toBe($antes + 1, 'un despachador sí');
});

it('una invitación pendiente ya ocupa asiento', function () {
    // Si no contara, se invitaría a diez personas con cinco asientos y el error
    // saltaría al ACEPTAR: en la cara de la persona invitada, que es justo quien
    // no puede arreglarlo.
    $tenantId = (string) $this->scenario->tenant->id;

    $antes = Limits::usage($tenantId)['users']['used'];

    suscribir($this->scenario, usuarios: $antes + 1, aplica: true);

    signIn($this->scenario, Role::Admin);

    $this->post('/users', [
        'email' => 'pendiente@ejemplo.test',
        'first_name' => 'Sin',
        'last_name' => 'Aceptar',
        'role' => 'dispatcher',
        'locale' => 'es',
    ])->assertSessionHasNoErrors();

    expect(Limits::usage($tenantId)['users']['used'])->toBe($antes + 1)
        ->and(Limits::isFull($tenantId, Limits::USERS))->toBeTrue();
});

it('un transportista rechazado no ocupa plaza', function () {
    $tenantId = (string) $this->scenario->tenant->id;

    $antes = Limits::usage($tenantId)['carriers']['used'];

    app(TenantContext::class)->withoutTenant(fn () => DB::table('carriers')
        ->where('id', $this->scenario->otherCarrier->id)
        ->update(['onboarding_status' => 'rejected', 'updated_at' => now()]));

    expect(Limits::usage($tenantId)['carriers']['used'])->toBe($antes - 1);
});

// ───────────────────────────────────────────────────────────────── las puertas

it('no deja invitar cuando no quedan asientos', function () {
    suscribir($this->scenario, usuarios: 1, aplica: true);

    signIn($this->scenario, Role::Admin);

    $this->post('/users', [
        'email' => 'nuevo@ejemplo.test',
        'first_name' => 'Nuevo',
        'last_name' => 'Usuario',
        'role' => 'dispatcher',
        'locale' => 'es',
    ])->assertSessionHasErrors('email');

    expect(DB::table('users')->where('email', 'nuevo@ejemplo.test')->exists())->toBeFalse();
});

it('deja invitar cuando queda sitio', function () {
    suscribir($this->scenario, usuarios: 50, aplica: true);

    signIn($this->scenario, Role::Admin);

    $this->post('/users', [
        'email' => 'nuevo@ejemplo.test',
        'first_name' => 'Nuevo',
        'last_name' => 'Usuario',
        'role' => 'dispatcher',
        'locale' => 'es',
    ])->assertSessionHasNoErrors();
});

it('no deja dar de alta un transportista con el tope lleno', function () {
    suscribir($this->scenario, transportistas: 1, aplica: true);

    signIn($this->scenario, Role::Admin);

    $antes = DB::table('carriers')->where('tenant_id', $this->scenario->tenant->id)->count();

    // La cortesía: se avisa antes de pedir el formulario entero.
    $this->get('/carriers/create')->assertRedirect('/carriers');

    // Y la puerta de verdad, que es la que cuenta: el POST. Con un cuerpo
    // completo y válido, para que lo único que pueda pararlo sea el tope.
    $this->post('/carriers', [
        'legal_name' => 'Transportes del Tope SA',
        'dot_number' => '4788123',
        'contact_first_name' => 'Ana',
        'contact_last_name' => 'Ruiz',
        'email' => 'tope@ejemplo.test',
        'phone' => '+1 555 0100',
        'preferred_locale' => 'es',
        'physical_line1' => '100 Main St',
        'physical_city' => 'Savannah',
        'physical_state' => 'GA',
        'physical_postal_code' => '31404',
        'mailing_same_as_physical' => true,
    ])->assertSessionHas('error', __('billing.limits.reached.carriers'));

    expect(DB::table('carriers')->where('tenant_id', $this->scenario->tenant->id)->count())->toBe($antes);
});

it('no deja crear una carga con el tope del mes lleno', function () {
    suscribir($this->scenario, cargas: 1, aplica: true);

    signIn($this->scenario, Role::Admin);

    $antes = DB::table('loads')->where('tenant_id', $this->scenario->tenant->id)->count();

    $this->get('/loads/create')->assertRedirect('/loads');

    // Y la puerta de verdad sigue estando en el POST: que la pantalla avise no
    // impide nada. Se comprueba el MENSAJE y no que haya un redirect: una
    // validación fallida también redirige, así que `assertRedirect()` a secas
    // pasaría con el tope quitado — es decir, no probaría nada.
    $this->post('/loads', [])->assertSessionHas('error', __('billing.limits.reached.loadsThisMonth'));

    expect(DB::table('loads')->where('tenant_id', $this->scenario->tenant->id)->count())->toBe($antes);
});

it('el tope de cargas cuenta solo el mes en curso', function () {
    suscribir($this->scenario, cargas: 1, aplica: true);

    $tenantId = (string) $this->scenario->tenant->id;

    expect(Limits::isFull($tenantId, Limits::LOADS))->toBeTrue();

    // Las mismas cargas, creadas el mes pasado: el contador vuelve a cero.
    app(TenantContext::class)->withoutTenant(fn () => DB::table('loads')
        ->where('tenant_id', $tenantId)
        ->update(['created_at' => now()->subMonthNoOverflow()->startOfMonth()]));

    expect(Limits::isFull($tenantId, Limits::LOADS))->toBeFalse();
});
