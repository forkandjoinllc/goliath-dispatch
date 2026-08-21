<?php

declare(strict_types=1);

use App\Enums\Role;
use App\Support\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Str;
use Inertia\Testing\AssertableInertia as Assert;
use Tests\Support\Scenario;

uses(DatabaseTransactions::class);

/*
| ADVERTENCIA: escritas sin poder ejecutarse (ver docs/testing.md). Todo lo que
| afirman se ejercitó a mano contra la aplicación en marcha.
*/

beforeEach(function () {
    app(TenantContext::class)->forget();
    $this->scenario = Scenario::create();
});

afterEach(fn () => app(TenantContext::class)->forget());

/**
 * @return array<string, mixed>
 */
function truckPayload(Scenario $scenario, array $overrides = []): array
{
    return [
        'carrier_id' => $scenario->assignedCarrier->id,
        'unit_number' => '310',
        'vin' => '3AKJHHDR9LSLP1234',
        'year' => 2024,
        'make' => 'Freightliner',
        'model' => 'Cascadia',
        'status' => 'active',
        ...$overrides,
    ];
}

/* ── El tipo viene de la URL ────────────────────────────────────────────── */

it('rechaza un tipo inventado', function () {
    signIn($this->scenario, Role::Admin);

    // El tipo acaba escogiendo un nombre de tabla. La ruta lo restringe y el
    // controlador lo vuelve a comprobar: redundante a propósito, porque la ruta
    // puede cambiar mañana.
    $this->get('/equipment/usuarios')->assertNotFound();
});

/* ── Unicidad ───────────────────────────────────────────────────────────── */

it('detecta el mismo VIN escrito con otro formato', function () {
    signIn($this->scenario, Role::Admin);

    $this->post('/equipment/trucks', truckPayload($this->scenario))->assertRedirect();

    $this->post('/equipment/trucks', truckPayload($this->scenario, [
        'unit_number' => '311',
        'vin' => '3akj-hhdr9-lslp1234',
    ]))->assertSessionHasErrors('vin');

    expect(session('errors')->first('vin'))->toContain('310');
});

it('el número de unidad es único dentro del transportista', function () {
    signIn($this->scenario, Role::Admin);

    $this->post('/equipment/trucks', truckPayload($this->scenario))->assertRedirect();

    $this->post('/equipment/trucks', truckPayload($this->scenario, ['vin' => '1FUJGLD59LLAA0001']))
        ->assertSessionHasErrors('unit_number');
});

it('pero DOS transportistas pueden tener los dos su unidad 310', function () {
    signIn($this->scenario, Role::Admin);

    $this->post('/equipment/trucks', truckPayload($this->scenario))->assertRedirect();

    // Es lo normal: cada transportista numera su flota desde el 100.
    $this->post('/equipment/trucks', truckPayload($this->scenario, [
        'carrier_id' => $this->scenario->otherCarrier->id,
        'vin' => '1FUJGLD59LLAA0002',
    ]))->assertRedirect();

    expect(DB::table('trucks')->where('unit_number', '310')->count())->toBe(2);
});

it('no deja poner equipo a un transportista de otra empresa', function () {
    signIn($this->scenario, Role::Admin);

    $other = Scenario::create();
    app(TenantContext::class)->forget();

    $this->post('/equipment/trucks', truckPayload($this->scenario, [
        'carrier_id' => $other->assignedCarrier->id,
    ]))->assertSessionHasErrors('carrier_id');
});

it('una unidad nace pendiente de verificación si no se dice otra cosa', function () {
    signIn($this->scenario, Role::Admin);

    $this->post('/equipment/trucks', truckPayload($this->scenario, ['status' => null]));

    expect(DB::table('trucks')->where('unit_number', '310')->value('status'))
        ->toBe('pending_verification');
});

/* ── Sacar de servicio ──────────────────────────────────────────────────── */

it('sacar de servicio exige motivo', function () {
    signIn($this->scenario, Role::Admin);
    $this->post('/equipment/trucks', truckPayload($this->scenario));
    $truckId = DB::table('trucks')->where('unit_number', '310')->value('id');

    $this->post("/equipment/trucks/{$truckId}/status", ['status' => 'out_of_service'])
        ->assertSessionHasErrors('reason');

    $this->post("/equipment/trucks/{$truckId}/status", [
        'status' => 'out_of_service',
        'reason' => 'Fuga en el turbo, entra al taller el lunes.',
    ])->assertRedirect();

    $fresh = DB::table('trucks')->where('id', $truckId)->first();

    expect($fresh->status)->toBe('out_of_service')
        ->and($fresh->out_of_service_reason)->toContain('turbo');
});

it('sacar de servicio RETIRA la unidad de sus cargas vivas', function () {
    signIn($this->scenario, Role::Admin);
    $this->post('/equipment/trucks', truckPayload($this->scenario));
    $truckId = DB::table('trucks')->where('unit_number', '310')->value('id');

    assignTruckToLoad($this->scenario->load->id, $this->scenario->tenant->id, $truckId);

    // Una unidad fuera de servicio que siguiera figurando en una carga en
    // tránsito es la peor combinación posible: el sistema diría que tiene
    // camión y el camión estaría en el taller.
    $this->post("/equipment/trucks/{$truckId}/status", [
        'status' => 'out_of_service',
        'reason' => 'Fuga en el turbo.',
    ])->assertRedirect();

    $assignment = DB::table('load_assignments')
        ->where('truck_id', $truckId)
        ->where('load_id', $this->scenario->load->id)
        ->first();

    expect($assignment->unassigned_at)->not->toBeNull()
        ->and($assignment->unassigned_reason)->toContain('turbo');
});

it('pero NO la retira de una carga ya entregada', function () {
    signIn($this->scenario, Role::Admin);
    $this->post('/equipment/trucks', truckPayload($this->scenario));
    $truckId = DB::table('trucks')->where('unit_number', '310')->value('id');

    assignTruckToLoad($this->scenario->load->id, $this->scenario->tenant->id, $truckId);
    DB::table('loads')->where('id', $this->scenario->load->id)->update(['status' => 'delivered']);

    // Retirarla de una carga entregada reescribiría el historial de quién la
    // llevó, que es justo lo que hay que poder responder si hubo un siniestro.
    $this->post("/equipment/trucks/{$truckId}/status", [
        'status' => 'out_of_service',
        'reason' => 'Fuga en el turbo.',
    ])->assertRedirect();

    expect(DB::table('load_assignments')
        ->where('truck_id', $truckId)
        ->value('unassigned_at'))->toBeNull();
});

it('volver a ponerla activa no exige motivo y lo limpia', function () {
    signIn($this->scenario, Role::Admin);
    $this->post('/equipment/trucks', truckPayload($this->scenario));
    $truckId = DB::table('trucks')->where('unit_number', '310')->value('id');

    $this->post("/equipment/trucks/{$truckId}/status", [
        'status' => 'out_of_service',
        'reason' => 'Fuga en el turbo.',
    ]);

    $this->post("/equipment/trucks/{$truckId}/status", ['status' => 'active'])->assertRedirect();

    $fresh = DB::table('trucks')->where('id', $truckId)->first();

    expect($fresh->status)->toBe('active')
        ->and($fresh->out_of_service_reason)->toBeNull();
});

/* ── Ámbitos ────────────────────────────────────────────────────────────── */

it('cada rol ve su ámbito de equipos', function (Role $role, string $scope) {
    signIn($this->scenario, $role);

    $this->get('/equipment/trucks')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('App/Equipment/Index')
            ->where('type', 'trucks')
            ->where('scope', $scope));
})->with([
    'admin' => [Role::Admin, 'tenant'],
    'despachador' => [Role::Dispatcher, 'assigned'],
    'transportista' => [Role::Carrier, 'carrier'],
    'conductor' => [Role::Driver, 'own'],
]);

it('el conductor ve las unidades que ha llevado, no una lista vacía', function () {
    signIn($this->scenario, Role::Admin);
    $this->post('/equipment/trucks', truckPayload($this->scenario));
    $truckId = DB::table('trucks')->where('unit_number', '310')->value('id');

    $driverId = linkSelfDriver($this->scenario);
    assignTruckToLoad($this->scenario->load->id, $this->scenario->tenant->id, $truckId);

    DB::table('load_assignments')->insert([
        'id' => (string) Str::uuid(),
        'tenant_id' => $this->scenario->tenant->id,
        'load_id' => $this->scenario->load->id,
        'resource_type' => 'driver',
        'driver_id' => $driverId,
        'is_primary' => true,
        'created_at' => now(),
        'updated_at' => now(),
    ]);

    signIn($this->scenario, Role::Driver);

    // Sin el puente por load_assignments, ScopeFilter no encuentra columna y
    // devuelve cero filas: el conductor entraría con su permiso y vería una
    // lista vacía. Una concesión que enseña nada no significa nada.
    $this->get('/equipment/trucks')->assertInertia(fn (Assert $page) => $page
        ->where('units.meta.total', 1)
        ->where('units.data.0.unitNumber', '310'));
});

it('el transportista no puede dar de alta equipo de otro transportista', function () {
    signIn($this->scenario, Role::Carrier);

    // El usuario transportista solo ve su propia empresa en el selector, y el
    // servidor lo comprueba igualmente: una petición a mano se salta el
    // selector.
    $this->post('/equipment/trucks', truckPayload($this->scenario, [
        'carrier_id' => $this->scenario->otherCarrier->id,
    ]))->assertSessionHasErrors('carrier_id');
});

/**
 * Pone un camión en una carga sin pasar por el controlador, para preparar el
 * escenario de las pruebas de retirada.
 */
function assignTruckToLoad(string $loadId, string $tenantId, string $truckId): void
{
    DB::table('load_assignments')->insert([
        'id' => (string) Str::uuid(),
        'tenant_id' => $tenantId,
        'load_id' => $loadId,
        'resource_type' => 'truck',
        'truck_id' => $truckId,
        'is_primary' => true,
        'created_at' => now(),
        'updated_at' => now(),
    ]);
}
