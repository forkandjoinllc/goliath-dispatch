<?php

declare(strict_types=1);

use App\Enums\Role;
use App\Support\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Inertia\Testing\AssertableInertia as Assert;
use Tests\Support\Scenario;

uses(DatabaseTransactions::class);

beforeEach(function () {
    app(TenantContext::class)->forget();
    $this->scenario = Scenario::create();
});

afterEach(fn () => app(TenantContext::class)->forget());

/**
 * @param  list<array<string, mixed>>  $requisitos
 * @return array<string, mixed>
 */
function cargaConRequisitos(Scenario $scenario, array $requisitos): array
{
    return [
        'customer_id' => $scenario->customer->id,
        'commodity' => 'Carga con requisitos',
        'weight_pounds' => 42000,
        'customer_charge_cents' => 500000,
        'miles' => 300,
        'stops' => [
            ['stop_type' => 'pickup', 'facility_name' => 'Origen', 'city' => 'Laredo', 'state' => 'TX'],
            ['stop_type' => 'delivery', 'facility_name' => 'Destino', 'city' => 'Dallas', 'state' => 'TX'],
        ],
        'requirements' => $requisitos,
    ];
}

function cargaCreada(): object
{
    return DB::table('loads')->where('commodity', 'Carga con requisitos')->first();
}

/* ── Guardar requisitos ─────────────────────────────────────────────────── */

it('guarda los requisitos de una carga', function () {
    signIn($this->scenario, Role::Admin);

    $this->post('/loads', cargaConRequisitos($this->scenario, [
        ['type' => 'twic', 'value' => '', 'source' => 'Puerto de Houston'],
        ['type' => 'endorsement', 'value' => 'H', 'source' => 'Mercancía peligrosa'],
        ['type' => 'clean_record', 'value' => '5', 'source' => 'Contrato del cliente'],
    ]))->assertRedirect()->assertSessionHasNoErrors();

    $filas = DB::table('load_requirements')
        ->where('load_id', cargaCreada()->id)
        ->whereNull('deleted_at')
        ->pluck('requirement_type')
        ->all();

    sort($filas);

    expect($filas)->toBe(['clean_record', 'endorsement', 'twic']);
});

it('un requisito de estatus SIN decir de dónde sale no se guarda', function () {
    signIn($this->scenario, Role::Admin);

    // Exigir ciudadanía sin un contrato que la pida por escrito no es una regla
    // de negocio. Este campo es lo único que separa una cosa de la otra.
    $this->post('/loads', cargaConRequisitos($this->scenario, [
        ['type' => 'work_authorization', 'value' => 'us_citizen', 'source' => ''],
    ]))->assertSessionHasErrors('requirements');

    expect(DB::table('load_requirements')->count())->toBe(0);
});

it('con la fuente declarada sí se guarda', function () {
    signIn($this->scenario, Role::Admin);

    $this->post('/loads', cargaConRequisitos($this->scenario, [
        ['type' => 'work_authorization', 'value' => 'us_citizen', 'source' => 'Contrato NAVFAC N40085-26, cláusula 3.2'],
    ]))->assertRedirect()->assertSessionHasNoErrors();

    $r = DB::table('load_requirements')->first();

    expect($r->requirement_type)->toBe('work_authorization')
        ->and($r->source)->toContain('NAVFAC');
});

it('el tipo es una lista cerrada', function () {
    signIn($this->scenario, Role::Admin);

    $this->post('/loads', cargaConRequisitos($this->scenario, [
        ['type' => 'pasaporte', 'value' => '', 'source' => 'x'],
    ]))->assertSessionHasErrors('requirements.0.type');
});

it('no se repite el mismo requisito dos veces', function () {
    signIn($this->scenario, Role::Admin);

    // El índice único no se puede poner en la base —la columna generada que
    // haría falta colgaría de `load_id`, que es columna de una ajena con
    // CASCADE, y MySQL no admite las dos cosas—. Se impide aquí.
    $this->post('/loads', cargaConRequisitos($this->scenario, [
        ['type' => 'endorsement', 'value' => 'H', 'source' => 'a'],
        ['type' => 'endorsement', 'value' => 'H', 'source' => 'b'],
    ]))->assertSessionHasErrors('requirements');
});

it('quitar un requisito lo borra en suave', function () {
    signIn($this->scenario, Role::Admin);

    $this->post('/loads', cargaConRequisitos($this->scenario, [
        ['type' => 'twic', 'value' => '', 'source' => 'Puerto'],
    ]));

    $carga = cargaCreada();

    $this->patch("/loads/{$carga->id}", cargaConRequisitos($this->scenario, []))
        ->assertRedirect()->assertSessionHasNoErrors();

    // Un requisito que estuvo vigente cuando se asignó al conductor tiene que
    // poder seguir leyéndose cuando alguien pregunte por qué se le asignó.
    expect(DB::table('load_requirements')->count())->toBe(1)
        ->and(DB::table('load_requirements')->whereNull('deleted_at')->count())->toBe(0);
});

/* ── La comparación llega a la pantalla ─────────────────────────────────── */

it('la ficha de la carga trae el veredicto de cada conductor', function () {
    signIn($this->scenario, Role::Admin);

    $carga = $this->scenario->load;

    DB::table('load_requirements')->insert([
        'id' => (string) Illuminate\Support\Str::uuid(),
        'tenant_id' => $carga->tenant_id,
        'load_id' => $carga->id,
        'requirement_type' => 'twic',
        'created_at' => now(),
        'updated_at' => now(),
    ]);

    $this->get("/loads/{$carga->id}")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->has('requirements', 1)
            // Ningún conductor de demostración tiene TWIC, así que el veredicto
            // es «no cumple» — y aun así el conductor SIGUE en la lista. Los
            // requisitos no descartan a nadie.
            ->where('assignable.requirements.0.type', 'twic'));
});

it('sin requisitos, el conductor no trae veredicto', function () {
    signIn($this->scenario, Role::Admin);

    // Una carga sin requisitos no tiene nada que objetar, y la pantalla no
    // pinta un panel vacío.
    $this->get("/loads/{$this->scenario->load->id}")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page->has('requirements', 0));
});
