<?php

declare(strict_types=1);

use App\Enums\Role;
use App\Support\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Support\Scenario;

uses(DatabaseTransactions::class);

beforeEach(function () {
    app(TenantContext::class)->forget();
    $this->scenario = Scenario::create();
});

afterEach(fn () => app(TenantContext::class)->forget());

/**
 * @param  array<string, mixed>  $overrides
 * @return array<string, mixed>
 */
function driverConRequisitos(array $overrides = []): array
{
    return [
        'first_name' => 'Ana',
        'last_name' => 'Quintero',
        'preferred_locale' => 'es',
        ...$overrides,
    ];
}

function ultimoConductor(): object
{
    return DB::table('drivers')->where('last_name', 'Quintero')->first();
}

/* ── Se puede vivir sin nada de esto ────────────────────────────────────── */

it('un conductor se da de alta sin ningún dato de aptitud', function () {
    signIn($this->scenario, Role::Admin);

    $this->post('/drivers', driverConRequisitos())->assertRedirect()->assertSessionHasNoErrors();

    $d = ultimoConductor();

    // «No consta» es un estado legítimo y permanente.
    expect((bool) $d->twic_card)->toBeFalse()
        ->and($d->work_authorization)->toBeNull()
        ->and($d->record_clean_years)->toBeNull();
});

/* ── TWIC ───────────────────────────────────────────────────────────────── */

it('guarda la TWIC y sella quién la miró', function () {
    signIn($this->scenario, Role::Admin);

    $this->post('/drivers', driverConRequisitos([
        'twic_card' => true,
        'twic_number_last4' => '4821',
        'twic_expires_at' => '2029-06-30',
    ]))->assertRedirect()->assertSessionHasNoErrors();

    $d = ultimoConductor();

    // La plataforma no consulta al TSA: alguien miró la tarjeta y el guardado
    // deja constancia de quién y cuándo.
    expect((bool) $d->twic_card)->toBeTrue()
        ->and($d->twic_number_last4)->toBe('4821')
        ->and($d->twic_verified_at)->not->toBeNull()
        ->and($d->twic_verified_by_user_id)->not->toBeNull();
});

it('del número de TWIC solo se guardan cuatro dígitos', function () {
    signIn($this->scenario, Role::Admin);

    $this->post('/drivers', driverConRequisitos([
        'twic_card' => true,
        'twic_number_last4' => '482100999',
    ]))->assertSessionHasErrors('twic_number_last4');
});

it('desmarcar la casilla borra los datos de la tarjeta', function () {
    signIn($this->scenario, Role::Admin);

    $this->post('/drivers', driverConRequisitos([
        'twic_card' => true,
        'twic_number_last4' => '4821',
        'twic_expires_at' => '2029-06-30',
    ]));

    $id = ultimoConductor()->id;

    // Una caducidad huérfana de una tarjeta que ya no está es un dato que
    // dentro de un año alguien lee como si significara algo.
    $this->patch("/drivers/{$id}", driverConRequisitos(['twic_card' => false]))
        ->assertRedirect()->assertSessionHasNoErrors();

    $d = ultimoConductor();

    expect((bool) $d->twic_card)->toBeFalse()
        ->and($d->twic_number_last4)->toBeNull()
        ->and($d->twic_expires_at)->toBeNull();
});

/* ── Autorización de trabajo ────────────────────────────────────────────── */

it('el estatus es una lista cerrada', function () {
    signIn($this->scenario, Role::Admin);

    $this->post('/drivers', driverConRequisitos(['work_authorization' => 'ciudadano']))
        ->assertSessionHasErrors('work_authorization');
});

it('guarda el estatus y sella quién lo miró', function () {
    signIn($this->scenario, Role::Admin);

    $this->post('/drivers', driverConRequisitos(['work_authorization' => 'permanent_resident']))
        ->assertRedirect()->assertSessionHasNoErrors();

    $d = ultimoConductor();

    expect($d->work_authorization)->toBe('permanent_resident')
        ->and($d->work_authorization_verified_at)->not->toBeNull();
});

/* ── Récord ─────────────────────────────────────────────────────────────── */

it('distingue «no se ha mirado» de «se miró y hay algo»', function () {
    signIn($this->scenario, Role::Admin);

    // Cero NO es lo mismo que vacío, y esa diferencia es todo el valor del campo.
    $this->post('/drivers', driverConRequisitos([
        'record_clean_years' => 0,
        'record_checked_at' => '2026-08-01',
    ]))->assertRedirect()->assertSessionHasNoErrors();

    $d = ultimoConductor();

    expect($d->record_clean_years)->toBe(0)
        ->and($d->record_verified_by_user_id)->not->toBeNull();
});

it('no admite más de treinta y un años', function () {
    signIn($this->scenario, Role::Admin);

    // 31 es «más de treinta». Por encima no significa nada y el CHECK de la
    // columna tampoco lo admite.
    $this->post('/drivers', driverConRequisitos(['record_clean_years' => 45]))
        ->assertSessionHasErrors('record_clean_years');
});

/* ── El sello no miente ─────────────────────────────────────────────────── */

it('guardar sin tocar la aptitud no vuelve a sellar la fecha', function () {
    signIn($this->scenario, Role::Admin);

    $this->post('/drivers', driverConRequisitos(['work_authorization' => 'us_citizen']));

    $antes = ultimoConductor();
    $id = $antes->id;

    $this->patch("/drivers/{$id}", driverConRequisitos([
        'work_authorization' => 'us_citizen',
        'notes' => 'Cambio que no toca la aptitud.',
    ]))->assertRedirect();

    // Si se re-sellara en cada guardado, la fecha diría «hoy» para siempre y
    // dejaría de significar nada.
    expect(ultimoConductor()->work_authorization_verified_at)
        ->toBe($antes->work_authorization_verified_at);
});
