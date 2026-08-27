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
 * @param  array<string, mixed>  $overrides
 * @return array<string, mixed>
 */
function factoringPayload(array $overrides = []): array
{
    return [
        'name' => 'Rio Grande Funding LLC',
        'website' => 'https://riograndefunding.test',
        'address_line1' => '120 Commerce St',
        'address_city' => 'Laredo',
        'address_state' => 'TX',
        'address_postal_code' => '78040',
        'active' => true,
        'contacts' => [
            [
                'first_name' => 'Marta',
                'last_name' => 'Ibanez',
                'email' => 'marta@riograndefunding.test',
                'phone' => '+19565550100',
                'position' => 'noa',
            ],
        ],
        ...$overrides,
    ];
}

/**
 * El formulario del transportista manda la ficha entera, así que hay que
 * reenviar lo obligatorio junto al cambio que se quiere probar.
 *
 * @param  array<string, mixed>  $overrides
 * @return array<string, mixed>
 */
function carrierPayloadForFactoring(object $carrier, array $overrides = []): array
{
    return [
        'legal_name' => $carrier->legal_name,
        'dot_number' => $carrier->dot_number,
        'contact_first_name' => 'Ana',
        'contact_last_name' => 'Diaz',
        'email' => $carrier->email,
        'phone' => '+15550100',
        'preferred_locale' => 'es',
        ...$overrides,
    ];
}

/* ── Quién entra ────────────────────────────────────────────────────────── */

it('cada rol ve lo que le toca', function (Role $role, bool $entra) {
    signIn($this->scenario, $role);

    $response = $this->get('/factoring');

    $entra
        ? $response->assertOk()
        : $response->assertForbidden();
})->with([
    'admin' => [Role::Admin, true],
    'contabilidad' => [Role::Accounting, true],
    // Quién financia a quién es información comercial de la casa de despacho.
    'despachador' => [Role::Dispatcher, false],
    'transportista' => [Role::Carrier, false],
    'conductor' => [Role::Driver, false],
]);

/* ── Alta ───────────────────────────────────────────────────────────────── */

it('crea una empresa con sus contactos', function () {
    signIn($this->scenario, Role::Admin);

    $this->post('/factoring', factoringPayload())->assertRedirect();

    $company = DB::table('factoring_companies')->where('name', 'Rio Grande Funding LLC')->first();

    expect($company)->not->toBeNull()
        ->and($company->website)->toBe('https://riograndefunding.test')
        // Sin decir nada, una empresa nueva nace activa: se da de alta porque
        // se va a usar.
        ->and((bool) $company->active)->toBeTrue();

    $contact = DB::table('factoring_company_contacts')
        ->where('factoring_company_id', $company->id)
        ->first();

    expect($contact->position)->toBe('noa')
        ->and($contact->last_name)->toBe('Ibanez');
});

it('el cargo del contacto es una lista cerrada', function () {
    signIn($this->scenario, Role::Admin);

    // Con texto libre acaban conviviendo «cobros», «Cobranzas» y «AR», y
    // entonces el campo no orienta a nadie.
    $this->post('/factoring', factoringPayload([
        'contacts' => [[
            'first_name' => 'X',
            'last_name' => 'Y',
            'position' => 'el que coge el telefono',
        ]],
    ]))->assertSessionHasErrors('contacts.0.position');

    expect(DB::table('factoring_companies')->count())->toBe(0);
});

it('la web tiene que ser una URL', function () {
    signIn($this->scenario, Role::Admin);

    $this->post('/factoring', factoringPayload(['website' => 'riogrande']))
        ->assertSessionHasErrors('website');
});

/* ── Edición de contactos ───────────────────────────────────────────────── */

it('editar deja los contactos como los mandó el formulario', function () {
    signIn($this->scenario, Role::Admin);
    $this->post('/factoring', factoringPayload());

    $company = DB::table('factoring_companies')->first();
    $contact = DB::table('factoring_company_contacts')->first();

    $this->patch("/factoring/{$company->id}", factoringPayload([
        'contacts' => [
            ['id' => $contact->id, 'first_name' => 'Marta', 'last_name' => 'Ibanez', 'position' => 'collections'],
            ['first_name' => 'Diego', 'last_name' => 'Ruiz', 'position' => 'funding'],
        ],
    ]))->assertRedirect();

    $vivos = DB::table('factoring_company_contacts')
        ->where('factoring_company_id', $company->id)
        ->whereNull('deleted_at')
        ->pluck('position')
        ->all();

    sort($vivos);

    expect($vivos)->toBe(['collections', 'funding']);
});

it('quitar un contacto lo borra en suave, no de verdad', function () {
    signIn($this->scenario, Role::Admin);
    $this->post('/factoring', factoringPayload());

    $company = DB::table('factoring_companies')->first();

    $this->patch("/factoring/{$company->id}", factoringPayload(['contacts' => []]))->assertRedirect();

    // Un contacto que aparece en el historial de una carta de cesión tiene que
    // poder seguir nombrándose dentro de dos años.
    expect(DB::table('factoring_company_contacts')->count())->toBe(1)
        ->and(DB::table('factoring_company_contacts')->whereNull('deleted_at')->count())->toBe(0);
});

/* ── Borrado ────────────────────────────────────────────────────────────── */

it('no se borra una empresa que un transportista está usando', function () {
    signIn($this->scenario, Role::Admin);
    $this->post('/factoring', factoringPayload());

    $company = DB::table('factoring_companies')->first();

    DB::table('factoring_assignments')->insert([
        'id' => (string) Str::uuid(),
        'tenant_id' => $this->scenario->tenant->id,
        'carrier_id' => $this->scenario->assignedCarrier->id,
        'factoring_company_id' => $company->id,
        'verification_status' => 'not_started',
        'created_at' => now(),
        'updated_at' => now(),
    ]);

    // La carta de cesión sigue vigente y las liquidaciones históricas la
    // nombran. Lo que se hace es marcarla inactiva.
    $this->delete("/factoring/{$company->id}")->assertSessionHasErrors('company');

    expect(DB::table('factoring_companies')->whereNull('deleted_at')->count())->toBe(1);
});

/* ── El desplegable del transportista ───────────────────────────────────── */

it('el formulario del transportista solo ofrece las empresas ACTIVAS', function () {
    signIn($this->scenario, Role::Admin);

    $this->post('/factoring', factoringPayload());
    $this->post('/factoring', factoringPayload(['name' => 'Cerrada LLC', 'active' => false, 'contacts' => []]));

    $this->get('/carriers/create')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->has('factoringCompanies', 1)
            ->where('factoringCompanies.0.name', 'Rio Grande Funding LLC'));
});

it('marcar la casilla y elegir una empresa deja la asignación escrita', function () {
    signIn($this->scenario, Role::Admin);
    $this->post('/factoring', factoringPayload());

    $company = DB::table('factoring_companies')->first();
    $carrier = $this->scenario->assignedCarrier;

    $this->patch("/carriers/{$carrier->id}", carrierPayloadForFactoring($carrier, [
        'uses_factoring' => true,
        'factoring_company_id' => $company->id,
    ]))->assertRedirect();

    $assignment = DB::table('factoring_assignments')
        ->where('carrier_id', $carrier->id)
        ->whereNull('deleted_at')
        ->first();

    expect($assignment)->not->toBeNull()
        ->and((string) $assignment->factoring_company_id)->toBe((string) $company->id);
});

it('desmarcar la casilla cierra la asignación sin borrarla', function () {
    signIn($this->scenario, Role::Admin);
    $this->post('/factoring', factoringPayload());

    $company = DB::table('factoring_companies')->first();
    $carrier = $this->scenario->assignedCarrier;

    $this->patch("/carriers/{$carrier->id}", carrierPayloadForFactoring($carrier, [
        'uses_factoring' => true,
        'factoring_company_id' => $company->id,
    ]));

    $this->patch("/carriers/{$carrier->id}", carrierPayloadForFactoring($carrier, [
        'uses_factoring' => false,
    ]))->assertRedirect();

    // La carta de cesión que se firmó el mes pasado siguió existiendo.
    expect(DB::table('factoring_assignments')->count())->toBe(1)
        ->and(DB::table('factoring_assignments')->whereNull('deleted_at')->count())->toBe(0);
});

it('no se puede asignar una empresa de otra empresa cliente', function () {
    $otro = Scenario::create();
    $ajena = (string) Str::uuid();

    app(TenantContext::class)->runAs($otro->tenant->id, function () use ($otro, $ajena) {
        DB::table('factoring_companies')->insert([
            'id' => $ajena,
            'tenant_id' => $otro->tenant->id,
            'name' => 'Ajena LLC',
            'active' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    });

    app(TenantContext::class)->forget();
    signIn($this->scenario, Role::Admin);

    $carrier = $this->scenario->assignedCarrier;

    // Un identificador de otra empresa pasa la validación de formato. El scope
    // global impide LEERLO, pero no impediría escribirlo.
    $this->patch("/carriers/{$carrier->id}", carrierPayloadForFactoring($carrier, [
        'uses_factoring' => true,
        'factoring_company_id' => $ajena,
    ]))->assertSessionHasErrors('factoring_company_id');

    expect(DB::table('factoring_assignments')->count())->toBe(0);
});

/* ── El nombre no se repite ─────────────────────────────────────────────── */

it('dos empresas de factoring no pueden llamarse igual', function () {
    signIn($this->scenario, Role::Admin);

    $this->post('/factoring', factoringPayload());

    // Sin la regla el choque llegaría como un 500 de integridad —la base de
    // datos tiene su propio índice único— en vez de como un mensaje bajo el
    // campo.
    $this->post('/factoring', factoringPayload(['contacts' => []]))
        ->assertSessionHasErrors('name');

    expect(DB::table('factoring_companies')->whereNull('deleted_at')->count())->toBe(1);
});
