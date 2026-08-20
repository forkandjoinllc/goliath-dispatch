<?php

declare(strict_types=1);

use App\Actions\Auth\AttemptLogin;
use App\Enums\Role;
use App\Enums\UserStatus;
use App\Models\LoginAttempt;
use App\Models\Session;
use App\Models\Tenant;
use App\Models\User;
use App\Models\UserTenantMembership;
use App\Support\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

uses(DatabaseTransactions::class);

beforeEach(function () {
    app(TenantContext::class)->forget();

    $this->tenant = Tenant::create([
        'slug' => 'login-'.Str::random(6),
        'legal_name' => 'Empresa Login LLC',
        'display_name' => 'Empresa Login',
        'status' => 'active',
    ]);

    $this->email = 'luis+'.Str::random(6).'@forkandjoin.test';
    $this->user = User::create([
        'email' => $this->email,
        'password' => 'contraseña-correcta-1',
        'first_name' => 'Luis',
        'last_name' => 'R',
        'status' => UserStatus::Active,
    ]);
});

afterEach(fn () => app(TenantContext::class)->forget());

function attempt(string $email, string $password, string $ip = '203.0.113.10'): ?User
{
    $request = Request::create('/login', 'POST', ['email' => $email, 'password' => $password]);
    $request->server->set('REMOTE_ADDR', $ip);
    $request->headers->set('User-Agent', 'pest/1.0');

    return app(AttemptLogin::class)($request);
}

/* ── El camino feliz ────────────────────────────────────────────────────── */

it('acepta la contraseña correcta', function () {
    expect(attempt($this->email, 'contraseña-correcta-1')?->id)->toBe($this->user->id);
});

it('el correo se compara normalizado', function () {
    // El usuario escribió su correo con mayúsculas; sigue siendo el mismo.
    expect(attempt(mb_strtoupper($this->email), 'contraseña-correcta-1'))->not->toBeNull();
    expect(attempt('  '.$this->email.'  ', 'contraseña-correcta-1'))->not->toBeNull();
});

it('la contraseña se guarda hasheada, nunca en claro', function () {
    $stored = DB::table('users')->where('id', $this->user->id)->value('password');
    expect($stored)->not->toBe('contraseña-correcta-1');
    expect(password_get_info($stored)['algo'])->not->toBeNull();
});

it('registra el último acceso y su IP', function () {
    attempt($this->email, 'contraseña-correcta-1', '198.51.100.7');
    $fresh = $this->user->fresh();
    expect($fresh->last_login_at)->not->toBeNull();
    expect($fresh->last_login_ip)->toBe('198.51.100.7');
});

/* ── Fallos ─────────────────────────────────────────────────────────────── */

it('rechaza la contraseña incorrecta', function () {
    expect(attempt($this->email, 'incorrecta'))->toBeNull();
});

it('rechaza un correo que no existe', function () {
    expect(attempt('nadie-'.Str::random(6).'@example.test', 'lo-que-sea'))->toBeNull();
});

it('deja rastro de todo intento, con éxito o sin él', function () {
    attempt($this->email, 'contraseña-correcta-1');
    attempt($this->email, 'incorrecta');
    $unknown = 'fantasma-'.Str::random(6).'@example.test';
    attempt($unknown, 'x');

    $rows = LoginAttempt::whereIn('email_normalized', [mb_strtolower($this->email), $unknown])
        ->orderBy('created_at')->get();

    expect($rows)->toHaveCount(3);
    expect($rows[0]->successful)->toBeTrue();
    expect($rows[0]->failure_reason)->toBeNull();
    expect($rows[1]->successful)->toBeFalse();
    expect($rows[1]->failure_reason)->toBe('bad_password');
    expect($rows[2]->failure_reason)->toBe('unknown_email');
    expect($rows[2]->ip_address)->toBe('203.0.113.10');
});

/* ── Bloqueo por intentos ───────────────────────────────────────────────── */

it('bloquea la cuenta tras cinco fallos', function () {
    for ($i = 0; $i < 4; $i++) {
        attempt($this->email, 'incorrecta');
    }
    expect($this->user->fresh()->isLocked())->toBeFalse();

    attempt($this->email, 'incorrecta');
    $locked = $this->user->fresh();
    expect($locked->failed_login_attempts)->toBe(5);
    expect($locked->isLocked())->toBeTrue();
});

it('con la cuenta bloqueada rechaza incluso la contraseña correcta', function () {
    for ($i = 0; $i < 5; $i++) {
        attempt($this->email, 'incorrecta');
    }
    expect(attempt($this->email, 'contraseña-correcta-1'))->toBeNull();

    $last = LoginAttempt::where('email_normalized', mb_strtolower($this->email))
        ->orderByDesc('created_at')->first();
    expect($last->failure_reason)->toBe('account_locked');
});

it('un login correcto pone el contador a cero', function () {
    attempt($this->email, 'incorrecta');
    attempt($this->email, 'incorrecta');
    expect($this->user->fresh()->failed_login_attempts)->toBe(2);

    attempt($this->email, 'contraseña-correcta-1');
    expect($this->user->fresh()->failed_login_attempts)->toBe(0);
    expect($this->user->fresh()->locked_until)->toBeNull();
});

/* ── Estado de la cuenta ────────────────────────────────────────────────── */

it('rechaza una cuenta suspendida, pero solo tras validar la contraseña', function () {
    $this->user->forceFill(['status' => UserStatus::Suspended])->save();

    // Con la contraseña correcta: se rechaza y el motivo lo dice.
    expect(attempt($this->email, 'contraseña-correcta-1'))->toBeNull();
    $last = LoginAttempt::where('email_normalized', mb_strtolower($this->email))
        ->orderByDesc('created_at')->first();
    expect($last->failure_reason)->toBe('status_suspended');

    // Con la contraseña incorrecta el motivo NO menciona el estado: decir
    // "suspendida" a quien no sabe la contraseña confirmaría que la cuenta existe.
    attempt($this->email, 'incorrecta');
    $last = LoginAttempt::where('email_normalized', mb_strtolower($this->email))
        ->orderByDesc('created_at')->first();
    expect($last->failure_reason)->toBe('bad_password');
});

it('rechaza una cuenta pendiente de verificar', function () {
    $this->user->forceFill(['status' => UserStatus::PendingVerification])->save();
    expect(attempt($this->email, 'contraseña-correcta-1'))->toBeNull();
});

/* ── Un usuario sin contraseña (invitado / SSO) ──────────────────────────── */

it('un usuario sin contraseña no puede entrar con ninguna', function () {
    $invited = User::create([
        'email' => 'invitado-'.Str::random(6).'@forkandjoin.test',
        'first_name' => 'In', 'last_name' => 'Vitado',
        'status' => UserStatus::Invited,
    ]);
    expect($invited->password)->toBeNull();
    expect(attempt($invited->email, ''))->toBeNull();
    expect(attempt($invited->email, 'cualquiera'))->toBeNull();
});

/* ── La empresa activa al iniciar sesión ────────────────────────────────── */

it('con una sola empresa la elige sola', function () {
    app(TenantContext::class)->runAs($this->tenant->id, fn () => UserTenantMembership::create([
        'user_id' => $this->user->id,
        'role' => Role::Admin,
        'status' => 'active',
    ]));

    $this->post('/login', ['email' => $this->email, 'password' => 'contraseña-correcta-1']);

    $row = Session::query()->whereKey(session()->getId())->first();
    expect($row)->not->toBeNull();
    expect($row->active_tenant_id)->toBe($this->tenant->id);
    expect($row->mfa_satisfied_at)->toBeNull();
});

it('con varias empresas la deja sin elegir', function () {
    $second = Tenant::create([
        'slug' => 'login2-'.Str::random(6),
        'legal_name' => 'Segunda LLC', 'display_name' => 'Segunda', 'status' => 'active',
    ]);

    foreach ([$this->tenant->id, $second->id] as $tenantId) {
        app(TenantContext::class)->runAs($tenantId, fn () => UserTenantMembership::create([
            'user_id' => $this->user->id,
            'role' => Role::Admin,
            'status' => 'active',
        ]));
    }

    $this->post('/login', ['email' => $this->email, 'password' => 'contraseña-correcta-1']);

    $row = Session::query()->whereKey(session()->getId())->first();
    // Adivinar aquí sería mostrarle a alguien los datos de la empresa equivocada.
    expect($row->active_tenant_id)->toBeNull();
});
