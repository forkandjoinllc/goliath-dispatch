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
function carrierWithAddress(array $overrides = []): array
{
    return [
        'legal_name' => 'Transfronteriza LLC',
        'dot_number' => '5551234',
        'contact_first_name' => 'Ana',
        'contact_last_name' => 'Diaz',
        'email' => 'ana@transfronteriza.test',
        'phone' => '+15550100',
        'preferred_locale' => 'es',
        ...$overrides,
    ];
}

it('acepta un estado del país elegido', function () {
    signIn($this->scenario, Role::Admin);

    $this->post('/carriers', carrierWithAddress([
        'physical_country' => 'MX',
        'physical_city' => 'Monterrey',
        // Tres letras. Este es el motivo de que las columnas sean varchar(3).
        'physical_state' => 'NLE',
    ]))->assertRedirect()->assertSessionHasNoErrors();

    $creado = DB::table('carriers')->where('dot_number', '5551234')->first();

    expect($creado->physical_state)->toBe('NLE')
        ->and($creado->physical_country)->toBe('MX');
});

it('rechaza un estado que no es de ese país', function () {
    signIn($this->scenario, Role::Admin);

    // El desplegable no deja hacer esto; una petición a mano, sí. Sin la regla
    // en el servidor la dirección se guarda y no la arregla nadie después,
    // porque nadie la mira.
    $this->post('/carriers', carrierWithAddress([
        'physical_country' => 'CA',
        'physical_state' => 'TX',
    ]))->assertSessionHasErrors('physical_state');

    expect(DB::table('carriers')->where('dot_number', '5551234')->count())->toBe(0);
});

it('rechaza un país que no despachamos', function () {
    signIn($this->scenario, Role::Admin);

    $this->post('/carriers', carrierWithAddress([
        'physical_country' => 'ES',
        'physical_state' => 'MA',
    ]))->assertSessionHasErrors('physical_country');
});

it('una dirección sin estado sigue valiendo', function () {
    signIn($this->scenario, Role::Admin);

    // Un transportista recién traído de FMCSA puede no venir con estado, y el
    // esquema deja NULL. Lo que la regla impide no es que falte: es que sea
    // imposible.
    $this->post('/carriers', carrierWithAddress([
        'physical_country' => 'US',
        'physical_state' => '',
    ]))->assertRedirect()->assertSessionHasNoErrors();
});

it('el estado del cliente y el de facturación se validan por separado', function () {
    signIn($this->scenario, Role::Admin);

    $this->post('/customers', [
        'company_name' => 'Clientes del Norte SA',
        // `status` es obligatorio en el alta de cliente. Faltaba aquí, y el
        // fallo se leía como un problema de estados/provincias porque en
        // español el atributo se llama «estado» igual que la subdivisión.
        'status' => 'active',
        'physical_country' => 'MX',
        'physical_state' => 'NLE',
        'billing_same_as_physical' => false,
        'billing_country' => 'US',
        // TX no es de México, pero aquí el país de facturación es US: vale.
        'billing_state' => 'TX',
    ])->assertSessionHasNoErrors();
});

it('el conductor guarda el país de su licencia', function () {
    signIn($this->scenario, Role::Admin);

    $this->post('/drivers', [
        'first_name' => 'Luis',
        'last_name' => 'Ravelo',
        'license_country' => 'CA',
        'license_state' => 'ON',
    ])->assertSessionHasNoErrors();

    $conductor = DB::table('drivers')->where('last_name', 'Ravelo')->first();

    expect($conductor->license_state)->toBe('ON')
        ->and($conductor->license_country)->toBe('CA');
});
