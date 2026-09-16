<?php

declare(strict_types=1);

use App\Enums\Role;
use App\Support\TenantContext;
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
 * El enlace existe si el destino se puede abrir.
 *
 * El guardián de `tests/Unit/Suite/CrossLinkTest.php` sujeta la estructura.
 * Esto abre cada ficha con cada sesión y comprueba las dos mitades: que el
 * enlace NO llega a quien no puede abrirlo, y que el NOMBRE sigue llegando —
 * quitar el enlace no puede quitar el dato.
 *
 * Y la tercera, que es la que demuestra que el defecto era real: pedir la ruta
 * del destino con esa misma sesión contesta «Acceso denegado».
 */
function conductorDeEstaCarga(Scenario $s): string
{
    return app(TenantContext::class)->runAs($s->tenant->id, function () use ($s): string {
        $driverId = (string) Str::uuid();

        DB::table('drivers')->insert([
            'id' => $driverId,
            'tenant_id' => $s->tenant->id,
            'first_name' => 'Eduardo',
            'last_name' => 'Salas',
            'license_state' => 'TX',
            'license_number_hash' => hash('sha256', Str::random(16)),
            'license_number_last4' => '0003',
            'cdl_class' => 'A',
            'license_expires_at' => now()->addYear(),
            'medical_card_expires_at' => now()->addYear(),
            'status' => 'available',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('driver_carrier_relationships')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $s->tenant->id,
            'driver_id' => $driverId,
            'carrier_id' => $s->assignedCarrier->id,
            'is_primary' => true,
            'start_date' => now()->subYear()->toDateString(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('user_tenant_memberships')
            ->where('tenant_id', $s->tenant->id)
            ->where('user_id', $s->user(Role::Driver)->id)
            ->update(['driver_id' => $driverId]);

        $s->crew($s->load);

        DB::table('load_assignments')
            ->where('load_id', $s->load->id)
            ->whereNotNull('driver_id')
            ->update(['driver_id' => $driverId]);

        return $driverId;
    });
}

it('al transportista no se le ofrece el enlace al cliente', function () {
    signIn($this->scenario, Role::Carrier);

    $this->get("/loads/{$this->scenario->load->id}")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            // El nombre sí: es el cliente de SU carga y lo necesita.
            ->where('load.customer.name', $this->scenario->customer->company_name)
            // El enlace no: no tiene `customer:read` por ningún camino.
            ->where('load.customer.href', null));

    // Y la prueba de que no era una precaución: la ruta contesta 403.
    $this->get("/customers/{$this->scenario->customer->id}")->assertForbidden();
});

it('al conductor no se le ofrece ni el cliente ni el transportista', function () {
    conductorDeEstaCarga($this->scenario);
    signIn($this->scenario, Role::Driver);

    $this->get("/loads/{$this->scenario->load->id}")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->where('load.customer.href', null)
            ->where('load.carrier.href', null)
            ->where('load.carrier.name', $this->scenario->assignedCarrier->legal_name));
});

it('a la oficina se le siguen ofreciendo los dos', function () {
    signIn($this->scenario, Role::Admin);

    // La otra mitad. Un lote que esconde enlaces y de paso se los quita a quien
    // sí puede abrirlos rompe la pantalla para la que se escribió.
    $this->get("/loads/{$this->scenario->load->id}")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->where('load.customer.href', "/customers/{$this->scenario->customer->id}")
            ->where('load.carrier.href', "/carriers/{$this->scenario->assignedCarrier->id}"));
});

it('el conductor ve el nombre de su transportista en su ficha, sin enlace', function () {
    $driverId = conductorDeEstaCarga($this->scenario);
    signIn($this->scenario, Role::Driver);

    $this->get("/drivers/{$driverId}")
        ->assertOk()
        ->assertInertia(function (Assert $page) {
            $carriers = $page->toArray()['props']['carriers'];

            expect($carriers)->not->toBe([]);
            expect($carriers[0]['name'])->toBe($this->scenario->assignedCarrier->legal_name);
            expect($carriers[0]['href'])->toBeNull();
        });

    $this->get("/carriers/{$this->scenario->assignedCarrier->id}")->assertForbidden();
});

it('el transportista sí lo ve enlazado en la ficha de su conductor', function () {
    $driverId = conductorDeEstaCarga($this->scenario);
    signIn($this->scenario, Role::Carrier);

    $this->get("/drivers/{$driverId}")
        ->assertOk()
        ->assertInertia(function (Assert $page) {
            $carriers = $page->toArray()['props']['carriers'];

            expect($carriers[0]['href'])->toBe("/carriers/{$this->scenario->assignedCarrier->id}");
        });
});

it('la ficha de un equipo no ofrece el transportista a quien no puede abrirlo', function () {
    $camion = app(TenantContext::class)->runAs($this->scenario->tenant->id, function (): string {
        $id = (string) Str::uuid();

        DB::table('trucks')->insert([
            'id' => $id,
            'tenant_id' => $this->scenario->tenant->id,
            'carrier_id' => $this->scenario->assignedCarrier->id,
            'unit_number' => 'U-7788',
            'vin' => Str::upper(Str::random(17)),
            'vin_normalized' => Str::upper(Str::random(17)),
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return $id;
    });

    signIn($this->scenario, Role::Carrier);

    $this->get("/equipment/trucks/{$camion}")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->where('unit.carrierHref', "/carriers/{$this->scenario->assignedCarrier->id}"));

    app(TenantContext::class)->forget();
    conductorDeEstaCarga($this->scenario);
    signIn($this->scenario, Role::Driver);

    // HOY no hay ningún lector que llegue a esta ficha sin poder abrir la del
    // transportista: el conductor, que es el único sin `carrier:read`, no
    // alcanza el camión. El enlace pasa igualmente por `CrossLink` —por
    // uniformidad, y para que el rol que se añada mañana lo herede bien— y eso
    // lo sujeta el guardián de estructura, no esta prueba.
    //
    // Lo que sí se mide aquí es el hecho que lo justifica.
    $this->get("/equipment/trucks/{$camion}")->assertForbidden();
    $this->get("/carriers/{$this->scenario->assignedCarrier->id}")->assertForbidden();
});
