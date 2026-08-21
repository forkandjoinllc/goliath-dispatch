<?php

declare(strict_types=1);

use App\Enums\Role;
use App\Support\Security\SensitiveNumber;
use App\Support\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Inertia\Testing\AssertableInertia as Assert;
use Tests\Support\Scenario;

uses(DatabaseTransactions::class);

/*
| ADVERTENCIA: escritas sin poder ejecutarse (ver docs/testing.md). Los ámbitos
| y las reglas que afirman se comprobaron a mano con los cinco roles.
*/

beforeEach(function () {
    app(TenantContext::class)->forget();
    $this->scenario = Scenario::create();
});

afterEach(fn () => app(TenantContext::class)->forget());

/**
 * @return array<string, mixed>
 */
function driverPayload(Scenario $scenario, array $overrides = []): array
{
    return [
        'first_name' => 'Ignacio',
        'last_name' => 'Beltrán',
        'license_number' => 'TX-4471902',
        'license_state' => 'TX',
        'cdl_class' => 'A',
        'license_expires_at' => now()->addYears(3)->toDateString(),
        'medical_card_expires_at' => now()->addYear()->toDateString(),
        'status' => 'available',
        'carrier_ids' => [$scenario->assignedCarrier->id],
        ...$overrides,
    ];
}

/* ── El número de licencia ──────────────────────────────────────────────── */

it('guarda la licencia cifrada y nunca la devuelve', function () {
    signIn($this->scenario, Role::Admin);

    $this->post('/drivers', driverPayload($this->scenario))->assertRedirect();

    $row = DB::table('drivers')->where('last_name', 'Beltrán')->first();

    expect($row->license_number_last4)->toBe('1902')
        ->and($row->license_number_hash)->toBe(SensitiveNumber::hash('TX-4471902'));

    // Ninguna de las tres columnas contiene el número legible.
    foreach ([$row->license_number_encrypted, $row->license_number_last4, $row->license_number_hash] as $stored) {
        expect((string) $stored)->not->toContain('4471902');
    }
});

it('la respuesta del listado lleva los últimos cuatro y nada más', function () {
    signIn($this->scenario, Role::Admin);
    $this->post('/drivers', driverPayload($this->scenario));

    $response = $this->get('/drivers');

    $response->assertInertia(fn (Assert $page) => $page->component('App/Drivers/Index'));

    // Si alguna vista necesitara el número entero, la vista estaría mal.
    expect($response->content())
        ->not->toContain('4471902')
        ->not->toContain('license_number_encrypted');
});

it('detecta la misma licencia escrita distinto y dice de quién es', function () {
    signIn($this->scenario, Role::Admin);

    $this->post('/drivers', driverPayload($this->scenario))->assertRedirect();

    $this->post('/drivers', driverPayload($this->scenario, [
        'first_name' => 'Otro',
        'last_name' => 'Distinto',
        'license_number' => 'tx 4471902',
    ]))->assertSessionHasErrors('license_number');

    // «Ya existe» sin decir cuál obliga a buscarlo a mano.
    expect(session('errors')->first('license_number'))->toContain('Beltrán');
});

it('editar sin escribir la licencia conserva la que había', function () {
    signIn($this->scenario, Role::Admin);
    $this->post('/drivers', driverPayload($this->scenario));

    $driver = DB::table('drivers')->where('last_name', 'Beltrán')->first();

    $this->patch("/drivers/{$driver->id}", [
        'first_name' => 'Ignacio',
        'last_name' => 'Beltrán',
        'phone' => '+15550001111',
        'license_number' => '',
    ])->assertRedirect();

    // El número no se puede leer de vuelta para reenviarlo, así que vacío tiene
    // que significar «conserva el que ya está». Si lo borrara, cada edición de
    // un teléfono destruiría la licencia.
    $fresh = DB::table('drivers')->where('id', $driver->id)->first();

    expect($fresh->license_number_last4)->toBe('1902')
        ->and($fresh->license_number_hash)->toBe($driver->license_number_hash);
});

/* ── Ámbitos ────────────────────────────────────────────────────────────── */

it('cada rol ve su ámbito de conductores', function (Role $role, string $scope) {
    signIn($this->scenario, $role);

    $this->get('/drivers')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page->where('scope', $scope));
})->with([
    'admin' => [Role::Admin, 'tenant'],
    'contabilidad' => [Role::Accounting, 'tenant'],
    'despachador' => [Role::Dispatcher, 'assigned'],
    'transportista' => [Role::Carrier, 'carrier'],
    'conductor' => [Role::Driver, 'own'],
]);

it('el transportista puede dar de alta a sus propios conductores', function () {
    signIn($this->scenario, Role::Carrier);

    // No es un descuido de la matriz: bajo la normativa federal el expediente
    // de cualificación del conductor es responsabilidad del transportista.
    $this->post('/drivers', driverPayload($this->scenario))->assertRedirect();
});

it('el conductor no puede dar de alta a otro', function () {
    signIn($this->scenario, Role::Driver);

    $this->post('/drivers', driverPayload($this->scenario))->assertRedirect()->assertSessionHas('error');
});

/* ── Lo que un conductor puede y no puede hacer consigo mismo ───────────── */

it('el conductor corrige su ficha pero no su estado', function () {
    $driverId = linkSelfDriver($this->scenario);

    signIn($this->scenario, Role::Driver);

    $this->patch("/drivers/{$driverId}", [
        'first_name' => 'Propio',
        'last_name' => 'Conductor',
        'phone' => '+15559990000',
        'status' => 'available',
    ])->assertRedirect();

    $fresh = DB::table('drivers')->where('id', $driverId)->first();

    // El teléfono sí: tiene que poder corregirlo sin llamar a nadie. El estado
    // no: podría ponerse «disponible» estando fuera de servicio.
    expect($fresh->phone)->toBe('+15559990000')
        ->and($fresh->status)->toBe('off_duty');
});

it('el conductor no puede verificarse a sí mismo', function () {
    $driverId = linkSelfDriver($this->scenario);

    signIn($this->scenario, Role::Driver);

    // Un conductor que pudiera marcarse verificado vaciaría de sentido la
    // comprobación que impide despachar.
    $this->post("/drivers/{$driverId}/verification", ['status' => 'verified'])->assertRedirect()->assertSessionHas('error');
});

it('el conductor no puede editar a otro', function () {
    linkSelfDriver($this->scenario);

    signIn($this->scenario, Role::Driver);

    $otro = DB::table('drivers')
        ->where('tenant_id', $this->scenario->tenant->id)
        ->where('last_name', '!=', 'Conductor')
        ->value('id');

    if ($otro !== null) {
        $this->patch("/drivers/{$otro}", ['first_name' => 'X', 'last_name' => 'Y'])->assertRedirect()->assertSessionHas('error');
    }
});

/* ── La verificación ────────────────────────────────────────────────────── */

it('un resultado distinto de «verificada» exige explicación', function () {
    signIn($this->scenario, Role::Admin);
    $this->post('/drivers', driverPayload($this->scenario));
    $driverId = DB::table('drivers')->where('last_name', 'Beltrán')->value('id');

    $this->post("/drivers/{$driverId}/verification", ['status' => 'mismatch'])
        ->assertSessionHasErrors('notes');

    $this->post("/drivers/{$driverId}/verification", [
        'status' => 'mismatch',
        'notes' => 'El apellido de la licencia no coincide con el del expediente.',
    ])->assertRedirect();

    expect(DB::table('drivers')->where('id', $driverId)->value('verification_status'))->toBe('mismatch');
});

it('la verificación deja auditoría completa, con rol y correo', function () {
    signIn($this->scenario, Role::Admin);
    $this->post('/drivers', driverPayload($this->scenario));
    $driverId = DB::table('drivers')->where('last_name', 'Beltrán')->value('id');

    $this->post("/drivers/{$driverId}/verification", ['status' => 'verified']);

    $event = DB::table('audit_events')
        ->where('action', 'driver.verified')
        ->where('entity_id', $driverId)
        ->first();

    // Escrito con App\Support\Audit, no con un insert a mano: el ayudante es
    // el que guarda el correo, el rol y la sesión de suplantación. Sin él, una
    // acción hecha suplantando a otro se atribuiría al suplantado.
    expect($event)->not->toBeNull()
        ->and($event->actor_email)->toBe($this->scenario->user(Role::Admin)->email)
        ->and($event->actor_role)->toBe('admin')
        ->and($event->entity_label)->toContain('Beltrán');
});

it('un conductor nace sin verificar diga lo que diga el formulario', function () {
    signIn($this->scenario, Role::Admin);

    $this->post('/drivers', driverPayload($this->scenario, ['verification_status' => 'verified']));

    expect(DB::table('drivers')->where('last_name', 'Beltrán')->value('verification_status'))
        ->toBe('not_started');
});

/**
 * Ata al usuario conductor del escenario con una ficha propia.
 */
function linkSelfDriver(Scenario $scenario): string
{
    $driverId = (string) Illuminate\Support\Str::uuid();

    DB::table('drivers')->insert([
        'id' => $driverId,
        'tenant_id' => $scenario->tenant->id,
        'first_name' => 'Propio',
        'last_name' => 'Conductor',
        'license_state' => 'TX',
        'license_number_hash' => hash('sha256', Illuminate\Support\Str::random(16)),
        'license_number_last4' => '0001',
        'cdl_class' => 'A',
        'license_expires_at' => now()->addYear(),
        'medical_card_expires_at' => now()->addYear(),
        'status' => 'off_duty',
        'created_at' => now(),
        'updated_at' => now(),
    ]);

    DB::table('user_tenant_memberships')
        ->where('tenant_id', $scenario->tenant->id)
        ->where('user_id', $scenario->user(Role::Driver)->id)
        ->update(['driver_id' => $driverId]);

    return $driverId;
}
