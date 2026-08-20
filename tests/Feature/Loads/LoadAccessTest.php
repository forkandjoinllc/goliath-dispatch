<?php

declare(strict_types=1);

use App\Enums\Role;
use App\Support\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Inertia\Testing\AssertableInertia as Assert;
use Tests\Support\Scenario;

uses(DatabaseTransactions::class);

/*
| ADVERTENCIA: escritas sin poder ejecutarse (ver docs/testing.md). El
| comportamiento que afirman sí se comprobó a mano contra la aplicación en
| marcha, con los cinco roles, peticiones HTTP reales y navegador.
*/

beforeEach(function () {
    app(TenantContext::class)->forget();
    $this->scenario = Scenario::create();
});

afterEach(fn () => app(TenantContext::class)->forget());

/* ── El dinero tiene su propio permiso ──────────────────────────────────── */

it('el conductor ve sus cargas pero NINGÚN número de dinero', function () {
    $this->scenario->crew($this->scenario->load);
    assignDriverToLoad($this->scenario);

    signIn($this->scenario, Role::Driver);

    $this->get('/loads')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('App/Loads/Index')
            ->where('scope', 'own')
            // Lo importante no es que la columna esté oculta: es que el número
            // NO VIAJA. Enviarlo y esconderlo en React lo dejaría al alcance de
            // cualquiera que abra las herramientas del navegador.
            ->where('showMoney', false)
            ->where('loads.data.0.customerChargeCents', null)
            ->where('loads.data.0.carrierGrossRateCents', null));
});

it('la ficha que ve un conductor no lleva el bloque financiero', function () {
    $this->scenario->crew($this->scenario->load);
    assignDriverToLoad($this->scenario);

    signIn($this->scenario, Role::Driver);

    $this->get("/loads/{$this->scenario->load->id}")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page->where('financials', null));
});

it('contabilidad sí ve el dinero, aunque no pueda crear cargas', function () {
    signIn($this->scenario, Role::Accounting);

    $this->get('/loads')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->where('showMoney', true)
            ->where('can.create', false));
});

/* ── El estrechamiento ──────────────────────────────────────────────────── */

it('cada rol ve exactamente su ámbito', function (Role $role, string $scope, int $total) {
    signIn($this->scenario, $role);

    $this->get('/loads')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->where('scope', $scope)
            ->where('loads.meta.total', $total));
})->with([
    'admin ve las dos' => [Role::Admin, 'tenant', 2],
    'contabilidad ve las dos' => [Role::Accounting, 'tenant', 2],
    'el despachador solo la de su cartera' => [Role::Dispatcher, 'assigned', 1],
    'el transportista solo la suya' => [Role::Carrier, 'carrier', 1],
]);

it('las facetas se cuentan dentro del ámbito', function () {
    signIn($this->scenario, Role::Dispatcher);

    // Un despachador que viera «borrador: 2» sabría cuántas cargas hay en la
    // empresa aunque solo pueda abrir una.
    $this->get('/loads')->assertInertia(fn (Assert $page) => $page
        ->where('facets.all', 1)
        ->where('facets.draft', 1));
});

it('los desplegables de filtro no revelan el catálogo entero', function () {
    signIn($this->scenario, Role::Dispatcher);

    // Solo los transportistas que APARECEN en sus cargas. Con el catálogo
    // completo, el desplegable le diría quiénes son todos los transportistas de
    // la empresa, que es justo lo que su ámbito le niega.
    $this->get('/loads')->assertInertia(fn (Assert $page) => $page->has('options.carriers', 1));
});

it('el despachador NO abre por URL una carga que no lleva', function () {
    signIn($this->scenario, Role::Dispatcher);

    $this->get("/loads/{$this->scenario->otherLoad->id}")
        ->assertForbidden()
        ->assertInertia(fn (Assert $page) => $page->component('App/Denied'));
});

it('el listado y la ficha nunca se contradicen para un conductor', function () {
    $this->scenario->crew($this->scenario->load);
    assignDriverToLoad($this->scenario);

    signIn($this->scenario, Role::Driver);

    // Este es el fallo que de verdad ocurrió: LoadScope sabía llegar al
    // conductor por load_assignments para la LISTA, y ResourceContext no sabía
    // expresarlo para el REGISTRO. El listado enseñaba la carga y la ficha
    // devolvía 403.
    $listed = $this->get('/loads');
    $listed->assertInertia(fn (Assert $page) => $page->where('loads.meta.total', 1));

    $this->get("/loads/{$this->scenario->load->id}")->assertOk();
});

/**
 * Ata al usuario conductor del escenario con la carga, vía load_assignments.
 *
 * Aparte porque es el puente que hace falta para todo lo del conductor: sin él
 * su ámbito `own` no encuentra ninguna carga y las pruebas pasarían por el
 * motivo equivocado (cero cargas en vez de cero por permisos).
 */
function assignDriverToLoad(Scenario $scenario): void
{
    $driverId = (string) \Illuminate\Support\Str::uuid();

    DB::table('drivers')->insert([
        'id' => $driverId,
        'tenant_id' => $scenario->tenant->id,
        'first_name' => 'Conductor',
        'last_name' => 'Demo',
        'license_state' => 'TX',
        'license_number_hash' => hash('sha256', \Illuminate\Support\Str::random(12)),
        'license_number_last4' => '9999',
        'cdl_class' => 'A',
        'license_expires_at' => now()->addYear(),
        'medical_card_expires_at' => now()->addYear(),
        'status' => 'available',
        'created_at' => now(),
        'updated_at' => now(),
    ]);

    DB::table('user_tenant_memberships')
        ->where('tenant_id', $scenario->tenant->id)
        ->where('user_id', $scenario->user(Role::Driver)->id)
        ->update(['driver_id' => $driverId]);

    DB::table('load_assignments')->insert([
        'id' => (string) \Illuminate\Support\Str::uuid(),
        'tenant_id' => $scenario->tenant->id,
        'load_id' => $scenario->load->id,
        'resource_type' => 'driver',
        'driver_id' => $driverId,
        'is_primary' => true,
        'created_at' => now(),
        'updated_at' => now(),
    ]);
}
