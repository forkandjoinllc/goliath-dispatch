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

/** @return array<string, mixed> */
function conductorValido(Scenario $scenario): array
{
    return [
        'first_name' => 'Rosa',
        'last_name' => 'Mendieta',
        'email' => 'rosa.mendieta@demo.test',
        'phone' => '+1 555 0900',
        'preferred_locale' => 'es',
        'license_state' => 'TX',
        'license_country' => 'US',
        'cdl_class' => 'A',
        'license_expires_at' => now()->addYear()->toDateString(),
        'medical_card_expires_at' => now()->addMonths(8)->toDateString(),
        'status' => 'available',
        'carriers' => [$scenario->assignedCarrier->id],
    ];
}

/* ── La validación mira el vocabulario, no la longitud ───────────────────── */

it('rechaza un endoso que no existe', function () {
    signIn($this->scenario, Role::Admin);

    // `max:4` admitía CUALQUIER cadena de cuatro caracteres: se guardaba «ZZ»
    // y la ficha enseñaba una letra que ningún diccionario sabe nombrar.
    $this->post('/drivers', [...conductorValido($this->scenario), 'endorsements' => ['ZZ']])
        ->assertSessionHasErrors('endorsements.0');

    expect(DB::table('drivers')->where('last_name', 'Mendieta')->exists())->toBeFalse();
});

it('rechaza una restricción que no existe', function () {
    signIn($this->scenario, Role::Admin);

    $this->post('/drivers', [...conductorValido($this->scenario), 'restrictions' => ['QQ']])
        ->assertSessionHasErrors('restrictions.0');
});

it('rechaza una clase de licencia que no existe', function () {
    signIn($this->scenario, Role::Admin);

    $this->post('/drivers', [...conductorValido($this->scenario), 'cdl_class' => 'D'])
        ->assertSessionHasErrors('cdl_class');
});

/* ── Las restricciones se pueden PONER, no solo devolver ─────────────────── */

it('guarda las restricciones que manda el formulario', function () {
    signIn($this->scenario, Role::Admin);

    // El formulario las llevaba en sus datos y se las devolvía al servidor
    // intactas, porque no había ni un control para tocarlas. Nadie podía poner
    // una restricción desde la aplicación.
    $this->post('/drivers', [
        ...conductorValido($this->scenario),
        'endorsements' => ['H', 'X'],
        'restrictions' => ['L', 'V'],
    ])->assertRedirect();

    $fila = DB::table('drivers')->where('last_name', 'Mendieta')->first();

    expect(json_decode((string) $fila->endorsements, true))->toBe(['H', 'X'])
        ->and(json_decode((string) $fila->restrictions, true))->toBe(['L', 'V']);
});

/* ── Lo que llega a la pantalla ──────────────────────────────────────────── */

it('el formulario recibe las tres tablas del servidor', function () {
    signIn($this->scenario, Role::Admin);

    $this->get('/drivers/create')->assertOk()->assertInertia(function (Assert $p) {
        $codes = $p->toArray()['props']['codes'];

        // Seis endosos, no cinco: la constante que vivía en la pantalla decía
        // en su comentario «son cinco y no cambian» encima de una lista de seis.
        expect($codes['endorsements'])->toBe(['H', 'N', 'P', 'S', 'T', 'X'])
            ->and($codes['restrictions'])->toBe(['L', 'Z', 'E', 'O', 'M', 'V'])
            ->and($codes['cdlClass'])->toBe(['A', 'B', 'C']);
    });
});

it('la ficha manda los códigos guardados', function () {
    signIn($this->scenario, Role::Admin);

    $this->post('/drivers', [
        ...conductorValido($this->scenario),
        'endorsements' => ['H'],
        'restrictions' => ['E'],
    ])->assertRedirect();

    $id = (string) DB::table('drivers')->where('last_name', 'Mendieta')->value('id');

    $this->get('/drivers/'.$id)->assertOk()->assertInertia(function (Assert $p) {
        $driver = $p->toArray()['props']['driver'];

        expect($driver['endorsements'])->toBe(['H'])
            ->and($driver['restrictions'])->toBe(['E'])
            ->and($driver['cdlClass'])->toBe('A');
    });
});
