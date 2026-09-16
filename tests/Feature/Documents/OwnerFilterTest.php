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
 * El filtro de dueño ofrece lo que se puede encontrar.
 *
 * El guardián de `tests/Unit/Suite/DocumentOwnerFilterTest.php` sujeta la
 * estructura. Esto abre la pantalla con cada sesión y comprueba las dos mitades:
 * que las opciones imposibles ya no se ofrecen, y que **elegir una que sí se
 * ofrece sigue encontrando filas** — recortar de más deja al usuario sin el
 * filtro que necesitaba.
 */
function conductorConSuPapel(Scenario $s): string
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
            'license_number_last4' => '0011',
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

        DB::table('documents')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $s->tenant->id,
            'document_type' => 'medical_card',
            'owner_type' => 'driver',
            'owner_id' => $driverId,
            'title' => 'Tarjeta médica',
            'review_status' => 'approved',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return $driverId;
    });
}

it('al conductor se le ofrece un dueño, no nueve', function () {
    conductorConSuPapel($this->scenario);
    signIn($this->scenario, Role::Driver);

    // Ocho de las nueve devolvían cero filas siempre, y la lista se vaciaba sin
    // decir nada.
    $this->get('/documents')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page->where('ownerTypes', ['driver']));
});

it('y el que se le ofrece encuentra lo suyo', function () {
    conductorConSuPapel($this->scenario);
    signIn($this->scenario, Role::Driver);

    // La otra mitad: recortar de más deja al usuario sin el filtro que
    // necesitaba.
    $this->get('/documents?owner=driver')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page->has('documents.data', 1));
});

it('al transportista se le ofrecen los cuatro que cuelgan de él', function () {
    signIn($this->scenario, Role::Carrier);

    // «Carga» y «gasto» no: esos documentos se ven desde la carga, con el
    // permiso de la carga, y `forCarriers()` no los emite.
    $this->get('/documents')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->where('ownerTypes', ['carrier', 'driver', 'truck', 'trailer']));
});

it('a la oficina se le siguen ofreciendo los nueve', function () {
    signIn($this->scenario, Role::Admin);

    $this->get('/documents')
        ->assertOk()
        ->assertInertia(function (Assert $page) {
            $tipos = $page->toArray()['props']['ownerTypes'];

            expect($tipos)->toHaveCount(9);
            expect($tipos)->toContain('load');
            expect($tipos)->toContain('expense');
        });
});

it('el servidor sigue validando contra el catálogo y no contra lo ofrecido', function () {
    conductorConSuPapel($this->scenario);
    signIn($this->scenario, Role::Driver);

    // Recortar la lista es cosa de la pantalla; aceptar un valor conocido es
    // del servidor. Un `?owner=load` escrito a mano no revienta: el alcance ya
    // había recortado las filas y no hay nada que enseñar.
    $this->get('/documents?owner=load')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->where('filters.owner', 'load')
            ->has('documents.data', 0));
});
