<?php

declare(strict_types=1);

use App\Enums\Role;
use App\Enums\UserStatus;
use App\Listeners\ActivateVerifiedUser;
use App\Models\User;
use App\Notifications\UserInvitation;
use App\Support\Invitations\Invitations;
use App\Support\TenantContext;
use Illuminate\Auth\Events\Verified;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Str;
use Inertia\Testing\AssertableInertia as Assert;
use Tests\Support\Scenario;

uses(DatabaseTransactions::class);

beforeEach(function () {
    RateLimiter::clear('');
    app(TenantContext::class)->forget();
    $this->scenario = Scenario::create();
    Notification::fake();
});

afterEach(fn () => app(TenantContext::class)->forget());

function invitar(array $overrides = []): array
{
    return array_merge([
        'email' => 'nuevo-'.Str::random(6).'@forkandjoin.test',
        'first_name' => 'Ana',
        'last_name' => 'Ruiz',
        'role' => Role::Dispatcher->value,
        'locale' => 'es',
    ], $overrides);
}

/**
 * El vale en claro del último correo mandado a esa dirección.
 *
 * Se saca de la URL del propio mensaje y no de la base de datos, porque en la
 * base de datos solo está el sha256 — que es justo lo que hay que comprobar. Es
 * también el único sitio de donde puede sacarlo la persona invitada.
 */
function valeEnviado(string $email): string
{
    $user = app(TenantContext::class)->withoutTenant(
        fn (): ?User => User::where('email_normalized', mb_strtolower($email))->first()
    );

    expect($user)->not->toBeNull();

    $enviadas = Notification::sent($user, UserInvitation::class);

    expect($enviadas)->not->toBeEmpty();

    /** @var UserInvitation $ultima */
    $ultima = $enviadas->last();
    $url = (string) $ultima->toMail($user)->actionUrl;

    return basename((string) parse_url($url, PHP_URL_PATH));
}

/* ── El fallo de producción que este lote arregla ───────────────────────── */

it('verificar el correo ACTIVA la cuenta', function () {
    $user = app(TenantContext::class)->withoutTenant(fn (): User => User::create([
        'email' => 'pendiente-'.Str::random(6).'@forkandjoin.test',
        'password' => 'caballo-bateria-grapa-2026',
        'first_name' => 'Pendiente',
        'last_name' => 'De Verificar',
        'locale' => 'es',
        'status' => UserStatus::PendingVerification,
    ]));

    // Sin esto, `email_verified_at` se marcaba y `status` se quedaba en
    // `pending_verification` para siempre — y AttemptLogin solo mira `status`.
    // Quien se daba de alta verificaba su correo y no podía entrar NUNCA.
    (new ActivateVerifiedUser)->handle(new Verified($user));

    expect($user->refresh()->status)->toBe(UserStatus::Active);
});

it('verificar NO resucita a un suspendido', function () {
    $user = app(TenantContext::class)->withoutTenant(fn (): User => User::create([
        'email' => 'suspendido-'.Str::random(6).'@forkandjoin.test',
        'password' => 'caballo-bateria-grapa-2026',
        'first_name' => 'Cuenta',
        'last_name' => 'Suspendida',
        'locale' => 'en',
        'status' => UserStatus::Suspended,
    ]));

    (new ActivateVerifiedUser)->handle(new Verified($user));

    // Un enlace de verificación viejo no puede ser la puerta de atrás de una
    // suspensión.
    expect($user->refresh()->status)->toBe(UserStatus::Suspended);
});

/* ── Invitar ───────────────────────────────────────────────────────────── */

it('crea cuenta invitada, pertenencia invitada y vale', function () {
    signIn($this->scenario, Role::Admin);
    $datos = invitar();

    $this->post('/users', $datos)->assertRedirect();

    $user = app(TenantContext::class)->withoutTenant(
        fn () => User::where('email_normalized', mb_strtolower($datos['email']))->first()
    );

    expect($user)->not->toBeNull()
        ->and($user->status)->toBe(UserStatus::Invited)
        // Sin contraseña: la elige la propia persona al aceptar.
        ->and($user->password)->toBeNull();

    $m = DB::table('user_tenant_memberships')
        ->where('tenant_id', $this->scenario->tenant->id)
        ->where('user_id', $user->id)
        ->first();

    expect($m->status)->toBe('invited')
        ->and($m->role)->toBe(Role::Dispatcher->value)
        ->and($m->invited_at)->not->toBeNull();

    // El vale se guarda HASHEADO. Quien lea la base de datos no puede aceptar
    // invitaciones ajenas con lo que ve.
    $token = DB::table('verification_tokens')
        ->where('user_id', $user->id)
        ->where('purpose', 'invitation')
        ->first();

    expect($token)->not->toBeNull()
        ->and(strlen((string) $token->token_hash))->toBe(64)
        ->and($token->consumed_at)->toBeNull();

    Notification::assertSentTo($user, UserInvitation::class);
});

it('a quien ya tiene cuenta no le crea una segunda', function () {
    signIn($this->scenario, Role::Admin);

    $existente = $this->scenario->user(Role::Accounting);
    $antes = app(TenantContext::class)->withoutTenant(fn (): int => User::query()->count());

    // Ya pertenece con el papel de contabilidad; se le invita a OTRO papel.
    $this->post('/users', invitar([
        'email' => $existente->email,
        'role' => Role::Dispatcher->value,
    ]))->assertRedirect();

    $despues = app(TenantContext::class)->withoutTenant(fn (): int => User::query()->count());

    expect($despues)->toBe($antes);
    expect(DB::table('user_tenant_memberships')
        ->where('user_id', $existente->id)
        ->whereNull('deleted_at')
        ->count())->toBe(2);
});

it('no invita dos veces al mismo papel', function () {
    signIn($this->scenario, Role::Admin);
    $datos = invitar();

    $this->post('/users', $datos)->assertRedirect();
    $this->post('/users', $datos)->assertSessionHasErrors('email');
});

/* ── Aceptar ───────────────────────────────────────────────────────────── */

it('aceptar activa la cuenta, la pertenencia, y quema el vale', function () {
    signIn($this->scenario, Role::Admin);
    $datos = invitar();
    $this->post('/users', $datos)->assertRedirect();

    $vale = valeEnviado($datos['email']);

    auth()->logout();
    $this->flushSession();

    $this->get("/invitations/{$vale}")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->where('invitation.email', $datos['email'])
            ->where('invitation.needsPassword', true));

    $this->post("/invitations/{$vale}", [
        'first_name' => 'Ana',
        'last_name' => 'Ruiz',
        'password' => 'caballo-bateria-grapa-2026',
        'password_confirmation' => 'caballo-bateria-grapa-2026',
    ])->assertRedirect('/home');

    $user = app(TenantContext::class)->withoutTenant(
        fn () => User::where('email_normalized', mb_strtolower($datos['email']))->first()
    );

    expect($user->status)->toBe(UserStatus::Active)
        // Aceptar VERIFICA el correo: el vale llegó a esa dirección.
        ->and($user->email_verified_at)->not->toBeNull()
        ->and($user->password)->not->toBeNull();

    expect(DB::table('user_tenant_memberships')
        ->where('user_id', $user->id)
        ->where('tenant_id', $this->scenario->tenant->id)
        ->value('status'))->toBe('active');

    // Y el vale ya no vale para nada.
    expect(Invitations::find($vale))->toBeNull();
    $this->get("/invitations/{$vale}")
        ->assertInertia(fn (Assert $page) => $page->where('invitation', null));
});

it('un vale inventado da la misma pantalla que uno caducado', function () {
    $this->get('/invitations/'.Str::random(48))
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page->where('invitation', null));
});

it('reenviar invalida el vale anterior', function () {
    signIn($this->scenario, Role::Admin);
    $datos = invitar();
    $this->post('/users', $datos)->assertRedirect();
    $primero = valeEnviado($datos['email']);

    $membership = DB::table('user_tenant_memberships')
        ->where('tenant_id', $this->scenario->tenant->id)
        ->where('status', 'invited')
        ->value('id');

    $this->post("/users/{$membership}/resend")->assertRedirect();

    // El que se mandó a la dirección equivocada deja de abrir la puerta.
    expect(Invitations::find($primero))->toBeNull();
});

it('retirar la invitación quema el vale y quita la pertenencia', function () {
    signIn($this->scenario, Role::Admin);
    $datos = invitar();
    $this->post('/users', $datos)->assertRedirect();
    $vale = valeEnviado($datos['email']);

    $membership = DB::table('user_tenant_memberships')
        ->where('tenant_id', $this->scenario->tenant->id)
        ->where('status', 'invited')
        ->value('id');

    $this->delete("/users/{$membership}")->assertRedirect();

    expect(Invitations::find($vale))->toBeNull();
    expect(DB::table('user_tenant_memberships')->where('id', $membership)->value('deleted_at'))
        ->not->toBeNull();
});

/* ── Quién puede qué ───────────────────────────────────────────────────── */

it('nadie se cambia a sí mismo el papel', function () {
    signIn($this->scenario, Role::Admin);

    $propia = DB::table('user_tenant_memberships')
        ->where('tenant_id', $this->scenario->tenant->id)
        ->where('user_id', $this->scenario->user(Role::Admin)->id)
        ->value('id');

    $this->post("/users/{$propia}/role", ['role' => Role::Dispatcher->value])
        ->assertSessionHasErrors('role');

    expect(DB::table('user_tenant_memberships')->where('id', $propia)->value('role'))
        ->toBe(Role::Admin->value);
});

it('el transportista no puede invitar administradores', function () {
    signIn($this->scenario, Role::Carrier);

    $this->post('/users', invitar(['role' => Role::Admin->value]))
        ->assertSessionHasErrors('role');
});

it('el transportista solo ve las pertenencias de su transportista', function () {
    signIn($this->scenario, Role::Carrier);

    $this->get('/users')
        ->assertOk()
        ->assertInertia(function (Assert $page) {
            $page->has('members');
            // Y no se le ofrecen papeles de oficina.
            $page->where('roles', [Role::Carrier->value]);
        });
});

it('el despachador no entra en la pantalla de usuarios', function () {
    signIn($this->scenario, Role::Dispatcher);

    $this->get('/users')->assertForbidden();
});

it('suspender corta el acceso sin tocar la cuenta', function () {
    signIn($this->scenario, Role::Admin);

    $otra = DB::table('user_tenant_memberships')
        ->where('tenant_id', $this->scenario->tenant->id)
        ->where('user_id', $this->scenario->user(Role::Accounting)->id)
        ->value('id');

    $this->post("/users/{$otra}/suspend")->assertRedirect();

    expect(DB::table('user_tenant_memberships')->where('id', $otra)->value('status'))
        ->toBe('suspended');

    // La CUENTA sigue activa: esa persona puede trabajar para otra empresa.
    expect(app(TenantContext::class)->withoutTenant(
        fn () => User::whereKey($this->scenario->user(Role::Accounting)->id)->value('status')
    ))->toBe(UserStatus::Active);

    // Y vuelve a activarse con la misma acción.
    $this->post("/users/{$otra}/suspend")->assertRedirect();
    expect(DB::table('user_tenant_memberships')->where('id', $otra)->value('status'))->toBe('active');
});
