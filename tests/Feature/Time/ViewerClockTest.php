<?php

declare(strict_types=1);

use App\Enums\Role;
use App\Models\User;
use App\Support\TenantContext;
use App\Support\Time\Clock;
use Illuminate\Foundation\Testing\DatabaseTransactions;
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
 * La misma hora, leída por dos personas en dos husos.
 *
 * El guardián de `tests/Unit/Suite` comprueba que el código llame a quien tiene
 * que llamar. Esto comprueba lo otro: que una petición de verdad, con sesión de
 * verdad, saque números DISTINTOS para dos personas que están en sitios
 * distintos. Es lo único que demuestra que la cadena entera —columna, Actor,
 * Viewer, Inertia— está enchufada.
 *
 * `signIn()` y no `actingAs()`: la empresa activa vive en
 * `sessions.active_tenant_id` y `actingAs` no la pone, así que el Actor llega
 * sin empresa y la página se cae o se pinta vacía. Está explicado en
 * tests/Pest.php y costó cuatro pruebas rojas volver a descubrirlo.
 */

/** Pone el huso de una persona sin pasar por la pantalla. */
function husoDe(User $usuario, string $huso): void
{
    $usuario->forceFill(['timezone' => $huso])->save();
}

/* ── La cadena entera está enchufada ─────────────────────────────────────── */

it('dos personas en dos husos leen la misma hora con números distintos', function () {
    $admin = $this->scenario->user(Role::Admin);

    // Un aviso escrito a una hora conocida: 03:00 UTC del día 9. En Chicago son
    // las 22:00 del día 8 y en Los Ángeles las 20:00 del día 8. Sin convertir,
    // las dos leerían «2026-09-09 03:00» — y además con el día equivocado.
    app(TenantContext::class)->runAs((string) $this->scenario->tenant->id, function () use ($admin): void {
        DB::table('notifications')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $this->scenario->tenant->id,
            'user_id' => $admin->id,
            'channel' => 'in_app',
            'event_key' => 'document.expiring',
            'title' => 'Prueba de reloj',
            'body' => 'Cuerpo',
            'created_at' => '2026-09-09 03:00:00',
            'updated_at' => '2026-09-09 03:00:00',
        ]);
    });

    husoDe($admin, 'America/Chicago');
    signIn($this->scenario, Role::Admin);

    $this->get('/notifications')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->where('notifications.data.0.createdAt', '2026-09-08 22:00')
            ->where('shell.clock.timezone', 'America/Chicago'));

    husoDe($admin, 'America/Los_Angeles');
    signIn($this->scenario, Role::Admin);

    $this->get('/notifications')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->where('notifications.data.0.createdAt', '2026-09-08 20:00')
            ->where('shell.clock.timezone', 'America/Los_Angeles'));
});

it('la abreviatura que enseña la barra es la del huso de esa persona', function () {
    husoDe($this->scenario->user(Role::Admin), 'America/Phoenix');
    signIn($this->scenario, Role::Admin);

    $this->get('/home')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            // Phoenix es la única de la lista que se puede afirmar sin saber en
            // qué mes corre la prueba: no tiene horario de verano.
            ->where('shell.clock.zone', 'MST')
            ->has('shell.clock.options', 8));
});

/* ── El huso se puede cambiar, y solo por husos que existen ──────────────── */

it('una persona cambia su propio huso', function () {
    $admin = $this->scenario->user(Role::Admin);
    signIn($this->scenario, Role::Admin);

    $this->from('/home')->post('/timezone', ['timezone' => 'America/Denver'])
        ->assertRedirect('/home');

    expect($admin->fresh()->timezone)->toBe('America/Denver');
});

it('un huso fuera de la lista se rechaza', function () {
    $admin = $this->scenario->user(Role::Admin);
    husoDe($admin, 'America/Chicago');
    signIn($this->scenario, Role::Admin);

    // Válido para PHP pero que ninguna pantalla ofrece. Aceptarlo dejaría la
    // cuenta en un sitio del que no se puede salir sin tocar la base de datos.
    $this->from('/home')->post('/timezone', ['timezone' => 'Europe/Madrid'])
        ->assertSessionHasErrors('timezone');

    expect($admin->fresh()->timezone)->toBe('America/Chicago');
});

it('sin sesión no se puede cambiar el huso de nadie', function () {
    $this->post('/timezone', ['timezone' => 'America/Denver'])->assertRedirect('/login');
});

it('cambiar el huso de uno no toca el de su compañero', function () {
    $admin = $this->scenario->user(Role::Admin);
    $despachador = $this->scenario->user(Role::Dispatcher);

    husoDe($despachador, 'America/New_York');
    signIn($this->scenario, Role::Admin);

    $this->post('/timezone', ['timezone' => 'Pacific/Honolulu']);

    expect($admin->fresh()->timezone)->toBe('Pacific/Honolulu')
        ->and($despachador->fresh()->timezone)->toBe('America/New_York');
});

/* ── Un huso roto en la fila no rompe la pantalla ────────────────────────── */

it('una fila con un huso que no existe no tumba la pantalla', function () {
    $admin = $this->scenario->user(Role::Admin);
    signIn($this->scenario, Role::Admin);

    // Sin pasar por el modelo: es lo que dejaría una importación o un UPDATE a
    // mano, que es de donde vendría un valor así.
    DB::table('users')->where('id', $admin->id)->update(['timezone' => 'Marte/Olympus']);

    $this->get('/home')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page->where('shell.clock.timezone', Clock::POR_OMISION));
});

/* ── A quien se invita se le pone el huso de la empresa ──────────────────── */

it('la persona invitada nace en el huso de la empresa', function () {
    DB::table('tenants')->where('id', $this->scenario->tenant->id)
        ->update(['default_timezone' => 'America/Los_Angeles']);

    signIn($this->scenario, Role::Admin);

    $correo = 'nueva+'.Str::random(6).'@escenario.test';

    $this->post('/users', [
        'email' => $correo,
        'first_name' => 'Nueva',
        'last_name' => 'Persona',
        'role' => Role::Dispatcher->value,
        'locale' => 'es',
    ])->assertSessionHasNoErrors();

    $invitada = User::withoutGlobalScopes()->where('email', $correo)->first();

    expect($invitada)->not->toBeNull()
        ->and($invitada->timezone)->toBe('America/Los_Angeles');
});

it('a quien YA tenía cuenta no se le toca el huso al invitarle a otra empresa', function () {
    // Su huso es suyo: puede estar trabajando además para otra empresa en otro
    // sitio, y quien invita no decide en qué reloj lee.
    $admin = $this->scenario->user(Role::Admin);
    husoDe($admin, 'America/Anchorage');

    $otra = Scenario::create();

    DB::table('tenants')->where('id', $otra->tenant->id)
        ->update(['default_timezone' => 'America/New_York']);

    signIn($otra, Role::Admin);

    $this->post('/users', [
        'email' => (string) $admin->email,
        'first_name' => 'Da',
        'last_name' => 'Igual',
        'role' => Role::Dispatcher->value,
        'locale' => 'en',
    ])->assertSessionHasNoErrors();

    expect($admin->fresh()->timezone)->toBe('America/Anchorage');
});

/* ── Todas las pantallas convertidas se pintan de verdad ─────────────────── */

it('cada pantalla convertida sigue respondiendo con el reloj puesto', function (string $ruta) {
    // Esta es la prueba que caza lo que un guardián de código NO puede ver: en
    // la lista de avisos el `map` es un `static fn`, y ahí `$this->hora()` es
    // un error fatal. El texto del fichero se lee igual de bien en los dos
    // casos; solo pedir la página lo distingue.
    //
    // Con un huso que NO es el de por omisión, para que la conversión se
    // ejecute de verdad y no coincida por casualidad con el valor guardado.
    husoDe($this->scenario->user(Role::Admin), 'America/Los_Angeles');
    signIn($this->scenario, Role::Admin);

    $this->get($ruta)->assertOk();
})->with([
    'avisos' => ['/notifications'],
    'firmas' => ['/signatures'],
    'plantillas de firma' => ['/signatures/templates'],
    'alta de transportistas' => ['/onboarding'],
    'permisos' => ['/permits'],
    'mensajes' => ['/messages'],
]);

it('la pantalla de salud de la plataforma también', function () {
    // Otra sesión: platform/health pide super administrador de plataforma.
    signIn($this->scenario, Role::PlatformSuperAdmin);

    $this->get('/platform/health')->assertOk();
});

/* ── Lo que NO se convierte, no se convierte ─────────────────────────────── */

it('un permiso emitido a las 08:00 dice 08:00 en cualquier huso', function () {
    $admin = $this->scenario->user(Role::Admin);
    $carga = $this->scenario->load;

    app(TenantContext::class)->runAs((string) $this->scenario->tenant->id, function () use ($carga): void {
        DB::table('permits')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $this->scenario->tenant->id,
            'load_id' => $carga->id,
            'state_code' => 'TX',
            'permit_number' => 'TX-1',
            'issued_at' => '2026-09-08 08:00:00',
            'expires_at' => '2026-09-20 17:00:00',
            'status' => 'issued',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    });

    foreach (['America/Chicago', 'Pacific/Honolulu'] as $huso) {
        husoDe($admin, $huso);
        signIn($this->scenario, Role::Admin);

        $this->get("/loads/{$carga->id}/permits")
            ->assertOk()
            ->assertInertia(fn (Assert $page) => $page
                ->where('permits.0.issuedAt', '2026-09-08 08:00')
                ->where('permits.0.expiresAt', '2026-09-20 17:00'));
    }
});
