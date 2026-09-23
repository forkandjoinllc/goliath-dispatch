<?php

declare(strict_types=1);

use App\Enums\Role;
use App\Support\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Tests\Support\FleetFixtures;
use Tests\Support\Scenario;

uses(DatabaseTransactions::class);

beforeEach(function () {
    app(TenantContext::class)->forget();
    $this->scenario = Scenario::create();
    $this->scenario->approveCarrierDocuments();
});

afterEach(fn () => app(TenantContext::class)->forget());

/**
 * Poner al conductor en una carga trae SU equipo habitual.
 *
 * Es lo que hace a mano quien despacha, cada vez, y el día que se equivoca pone
 * el camión de otro. Lo que esta prueba sujeta es dónde para el atajo:
 *
 *  - No pisa lo que ya estaba puesto.
 *  - No se salta la puerta que pasaría la unidad puesta a mano.
 *  - Y cuando no trae nada, no dice que trajo algo.
 *
 * Las ayudas viven en `Tests\Support\FleetFixtures`, que es una CLASE: una
 * función global de Pest declarada en otro fichero no existe cuando se corre
 * este solo. Ver `docs/testing.md`.
 */
it('el conductor trae su camión y su remolque', function () {
    signIn($this->scenario, Role::Admin);

    $conductor = FleetFixtures::conductor($this->scenario, 'Ana', 'Ruiz');
    $camion = FleetFixtures::camion($this->scenario, 'T-900');
    $remolque = FleetFixtures::remolque($this->scenario, 'R-900');

    $this->post("/drivers/{$conductor}/equipment", [
        'truck_id' => $camion,
        'trailer_id' => $remolque,
        'starts_on' => now()->subDay()->toDateString(),
    ])->assertRedirect();

    $carga = (string) $this->scenario->load->id;

    $this->post("/loads/{$carga}/resources", [
        'resource_type' => 'driver',
        'resource_id' => $conductor,
    ])->assertRedirect();

    expect(FleetFixtures::puestoEn($carga, 'truck'))->toBe($camion);
    expect(FleetFixtures::puestoEn($carga, 'trailer'))->toBe($remolque);
});

it('no pisa el camión que ya estaba puesto', function () {
    // Prerrellenar es rellenar lo VACÍO. Pisar lo que alguien eligió a mano
    // sería otra cosa, y quien lo eligió no se enteraría.
    signIn($this->scenario, Role::Admin);

    $conductor = FleetFixtures::conductor($this->scenario, 'Ana', 'Ruiz');
    $suyo = FleetFixtures::camion($this->scenario, 'T-900');
    $otro = FleetFixtures::camion($this->scenario, 'T-901');

    $this->post("/drivers/{$conductor}/equipment", [
        'truck_id' => $suyo,
        'starts_on' => now()->subDay()->toDateString(),
    ])->assertRedirect();

    $carga = (string) $this->scenario->load->id;
    FleetFixtures::enLaCarga($this->scenario, $carga, 'truck', $otro);

    $this->post("/loads/{$carga}/resources", [
        'resource_type' => 'driver',
        'resource_id' => $conductor,
    ])->assertRedirect();

    expect(FleetFixtures::puestoEn($carga, 'truck'))->toBe($otro);
});

it('no se salta la puerta: un camión fuera de servicio no entra', function () {
    // La misma puerta que pasaría puesto a mano. Un atajo que se la salta mete
    // en la carga lo que la puerta existe para dejar fuera.
    signIn($this->scenario, Role::Admin);

    $conductor = FleetFixtures::conductor($this->scenario, 'Ana', 'Ruiz');
    $enElTaller = FleetFixtures::camion($this->scenario, 'T-900', 'out_of_service');

    $this->post("/drivers/{$conductor}/equipment", [
        'truck_id' => $enElTaller,
        'starts_on' => now()->subDay()->toDateString(),
    ])->assertRedirect();

    $carga = (string) $this->scenario->load->id;

    $this->post("/loads/{$carga}/resources", [
        'resource_type' => 'driver',
        'resource_id' => $conductor,
    ])->assertRedirect();

    expect(FleetFixtures::puestoEn($carga, 'truck'))->toBeNull();
});

it('sin equipo habitual, el aviso es el de siempre', function () {
    // Y no uno que nombre un equipo que no entró.
    signIn($this->scenario, Role::Admin);

    $conductor = FleetFixtures::conductor($this->scenario, 'Ana', 'Ruiz');
    $carga = (string) $this->scenario->load->id;

    $this->post("/loads/{$carga}/resources", [
        'resource_type' => 'driver',
        'resource_id' => $conductor,
    ])->assertRedirect();

    expect(session('success'))->toBe(__('loads.assign.driverDone'));
});
