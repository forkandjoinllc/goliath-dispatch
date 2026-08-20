<?php

declare(strict_types=1);

use App\Enums\Role;
use App\Support\Customers\NameKey;
use App\Support\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Inertia\Testing\AssertableInertia as Assert;
use Tests\Support\Scenario;

uses(DatabaseTransactions::class);

/*
| ADVERTENCIA: escritas sin poder ejecutarse (ver CarrierAccessTest). El
| comportamiento que afirman sí se comprobó a mano contra la aplicación.
*/

beforeEach(function () {
    app(TenantContext::class)->forget();
    $this->scenario = Scenario::create();
});

afterEach(fn () => app(TenantContext::class)->forget());

/* ── Quién entra ────────────────────────────────────────────────────────── */

it('deja entrar al listado a quien tiene customer:read', function (Role $role, bool $canCreate) {
    signIn($this->scenario, $role);

    $this->get('/customers')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('App/Customers/Index')
            ->where('scope', 'tenant')
            ->where('customers.meta.total', 1)
            ->where('can.create', $canCreate));
})->with([
    'admin' => [Role::Admin, true],
    'contabilidad lee pero no crea' => [Role::Accounting, false],
    'el despachador crea clientes' => [Role::Dispatcher, true],
]);

it('niega el listado a transportista y conductor', function (Role $role) {
    signIn($this->scenario, $role);

    $this->get('/customers')
        ->assertForbidden()
        ->assertInertia(fn (Assert $page) => $page->component('App/Denied'));
})->with([
    'transportista' => [Role::Carrier],
    'conductor' => [Role::Driver],
]);

/* ── Duplicados: los cinco caminos ──────────────────────────────────────── */

it('un nombre nuevo entra sin más', function () {
    signIn($this->scenario, Role::Admin);

    $this->post('/customers', ['company_name' => 'Cactus Freight Systems LLC', 'status' => 'active'])
        ->assertRedirect();

    expect(customerExists('cactus freight systems'))->toBeTrue();
});

it('avisa cuando el nombre es la misma empresa escrita distinto', function () {
    signIn($this->scenario, Role::Admin);

    // El escenario ya tiene «Cliente Escenario LLC». Esto es la misma empresa
    // sin el sufijo y en minúsculas — que es como la escribe la segunda persona
    // que la da de alta.
    $this->post('/customers', ['company_name' => 'cliente escenario', 'status' => 'active'])
        ->assertSessionHasErrors('duplicate_override_reason');

    expect(customerCount('cliente escenario'))->toBe(1);
});

it('el aviso NOMBRA la ficha que ya existe', function () {
    signIn($this->scenario, Role::Admin);

    $this->post('/customers', ['company_name' => 'cliente escenario', 'status' => 'active']);

    // «Ya existe uno parecido» sin decir cuál obliga a buscarlo a mano.
    expect(session('errors')->first('duplicate_override_reason'))
        ->toContain('Cliente Escenario LLC');
});

it('con motivo escrito pasa, y el motivo queda en la ficha', function () {
    signIn($this->scenario, Role::Admin);

    $this->post('/customers', [
        'company_name' => 'cliente escenario',
        'status' => 'active',
        'duplicate_override_reason' => 'Entidad legal separada para la planta de Odessa.',
    ])->assertRedirect();

    expect(customerCount('cliente escenario'))->toBe(2);

    $created = app(TenantContext::class)->runAs(
        $this->scenario->tenant->id,
        fn () => App\Models\Customer::query()->where('company_name', 'cliente escenario')->first()
    );

    expect($created->duplicate_override_reason)->toContain('Odessa')
        ->and($created->duplicate_override_by_user_id)
        ->toBe($this->scenario->user(Role::Admin)->id);
});

it('quien no puede anular queda bloqueado, y se le dice a quién pedirlo', function () {
    signIn($this->scenario, Role::Dispatcher);

    $this->post('/customers', ['company_name' => 'cliente escenario', 'status' => 'active'])
        ->assertSessionHasErrors('company_name');

    expect(customerCount('cliente escenario'))->toBe(1);
});

it('escribir un motivo no concede el permiso de anular', function () {
    signIn($this->scenario, Role::Dispatcher);

    // Sin esta prueba, un cambio que leyera el motivo antes de comprobar el
    // permiso pasaría desapercibido: el camino feliz seguiría funcionando.
    $this->post('/customers', [
        'company_name' => 'cliente escenario',
        'status' => 'active',
        'duplicate_override_reason' => 'me da igual',
    ])->assertSessionHasErrors('company_name');

    expect(customerCount('cliente escenario'))->toBe(1);
});

it('editar sin tocar el nombre no vuelve a pedir el motivo', function () {
    signIn($this->scenario, Role::Admin);

    // Si lo pidiera, cambiar un teléfono acabaría con alguien escribiendo «ver
    // arriba» para poder guardar.
    $this->patch("/customers/{$this->scenario->customer->id}", [
        'company_name' => $this->scenario->customer->company_name,
        'status' => 'active',
        'phone' => '+15550123',
    ])->assertRedirect();
});

/* ── Borrado ────────────────────────────────────────────────────────────── */

it('no borra un cliente con cargas ni pagadas ni canceladas', function () {
    signIn($this->scenario, Role::Admin);

    app(TenantContext::class)->runAs($this->scenario->tenant->id, function () {
        DB::table('loads')->insert([
            'id' => (string) Illuminate\Support\Str::uuid(),
            'tenant_id' => $this->scenario->tenant->id,
            'load_number' => 'T-0001',
            'customer_id' => $this->scenario->customer->id,
            'status' => 'in_transit',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    });

    // Una carga necesita saber a quién facturar; un cliente borrado a mitad de
    // viaje deja una factura sin destinatario.
    $this->delete("/customers/{$this->scenario->customer->id}")
        ->assertSessionHasErrors('customer');

    expect(customerCount(NameKey::for('Cliente Escenario LLC')))->toBe(1);
});

it('borra en suave cuando no hay cargas vivas', function () {
    signIn($this->scenario, Role::Admin);

    $this->delete("/customers/{$this->scenario->customer->id}")->assertRedirect();

    $row = DB::table('customers')->where('id', $this->scenario->customer->id)->first();

    // Suave, no permanente: las facturas históricas siguen nombrándolo.
    expect($row)->not->toBeNull()
        ->and($row->deleted_at)->not->toBeNull()
        ->and($row->deleted_by)->toBe($this->scenario->user(Role::Admin)->id);
});

/* ── Ayudas ─────────────────────────────────────────────────────────────── */

function customerCount(string $key): int
{
    return DB::table('customers')
        ->where('company_name_normalized', $key)
        ->whereNull('deleted_at')
        ->count();
}

function customerExists(string $key): bool
{
    return customerCount($key) > 0;
}
