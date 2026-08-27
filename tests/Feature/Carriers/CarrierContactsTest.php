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
function carrierPayload(array $overrides = []): array
{
    return [
        'legal_name' => 'Cuatro Vientos Trucking LLC',
        'dot_number' => '7412580',
        'preferred_locale' => 'es',
        'contacts' => [
            ['first_name' => 'Ana', 'last_name' => 'Diaz', 'email' => 'ana@cuatrovientos.test', 'phone' => '+15550100'],
            ['first_name' => 'Beto', 'last_name' => 'Ruiz', 'email' => 'beto@cuatrovientos.test', 'phone' => '+15550101'],
        ],
        ...$overrides,
    ];
}

/* ── Varios contactos ───────────────────────────────────────────────────── */

it('guarda todos los contactos y marca principal al primero', function () {
    signIn($this->scenario, Role::Admin);

    $this->post('/carriers', carrierPayload())->assertRedirect()->assertSessionHasNoErrors();

    $carrier = DB::table('carriers')->where('dot_number', '7412580')->first();

    $contactos = DB::table('carrier_contacts')
        ->where('carrier_id', $carrier->id)
        ->whereNull('deleted_at')
        ->orderByDesc('is_primary')
        ->get();

    expect($contactos)->toHaveCount(2)
        ->and((bool) $contactos[0]->is_primary)->toBeTrue()
        ->and($contactos[0]->first_name)->toBe('Ana')
        ->and((bool) $contactos[1]->is_primary)->toBeFalse();

    // Las columnas de `carriers` son el ESPEJO del principal: medio sistema las
    // lee y siguen siendo NOT NULL.
    expect($carrier->contact_first_name)->toBe('Ana')
        ->and($carrier->email)->toBe('ana@cuatrovientos.test')
        ->and($carrier->phone)->toBe('+15550100');
});

it('valida el correo de cada contacto', function () {
    signIn($this->scenario, Role::Admin);

    $this->post('/carriers', carrierPayload([
        'contacts' => [
            ['first_name' => 'Ana', 'last_name' => 'Diaz', 'email' => 'ana@cuatrovientos.test', 'phone' => '+15550100'],
            ['first_name' => 'Beto', 'last_name' => 'Ruiz', 'email' => 'esto-no-es-un-correo', 'phone' => ''],
        ],
    ]))->assertSessionHasErrors('contacts.1.email');

    expect(DB::table('carriers')->where('dot_number', '7412580')->count())->toBe(0);
});

it('el correo del principal es obligatorio', function () {
    signIn($this->scenario, Role::Admin);

    // La columna `carriers.email` es NOT NULL: sin correo en el principal no
    // hay nada que copiar.
    $this->post('/carriers', carrierPayload([
        'contacts' => [
            ['first_name' => 'Ana', 'last_name' => 'Diaz', 'email' => '', 'phone' => '+15550100'],
        ],
    ]))->assertSessionHasErrors('contacts.0.email');
});

it('un contacto de más puede no tener correo', function () {
    signIn($this->scenario, Role::Admin);

    // El de guardia a las tres de la mañana es un teléfono, no un buzón.
    $this->post('/carriers', carrierPayload([
        'contacts' => [
            ['first_name' => 'Ana', 'last_name' => 'Diaz', 'email' => 'ana@cuatrovientos.test', 'phone' => '+15550100'],
            ['first_name' => 'Noche', 'last_name' => 'Guardia', 'email' => '', 'phone' => '+15550199'],
        ],
    ]))->assertRedirect()->assertSessionHasNoErrors();
});

it('quitar un contacto lo borra en suave', function () {
    signIn($this->scenario, Role::Admin);
    $this->post('/carriers', carrierPayload());

    $carrier = DB::table('carriers')->where('dot_number', '7412580')->first();
    $principal = DB::table('carrier_contacts')->where('carrier_id', $carrier->id)->where('is_primary', true)->first();

    $this->patch("/carriers/{$carrier->id}", carrierPayload([
        'contacts' => [
            ['id' => $principal->id, 'first_name' => 'Ana', 'last_name' => 'Diaz', 'email' => 'ana@cuatrovientos.test', 'phone' => '+15550100'],
        ],
    ]))->assertRedirect()->assertSessionHasNoErrors();

    expect(DB::table('carrier_contacts')->where('carrier_id', $carrier->id)->count())->toBe(2)
        ->and(DB::table('carrier_contacts')->where('carrier_id', $carrier->id)->whereNull('deleted_at')->count())->toBe(1);
});

it('cambiar el orden cambia el principal y las columnas espejo', function () {
    signIn($this->scenario, Role::Admin);
    $this->post('/carriers', carrierPayload());

    $carrier = DB::table('carriers')->where('dot_number', '7412580')->first();

    $this->patch("/carriers/{$carrier->id}", carrierPayload([
        'contacts' => [
            ['first_name' => 'Beto', 'last_name' => 'Ruiz', 'email' => 'beto@cuatrovientos.test', 'phone' => '+15550101'],
            ['first_name' => 'Ana', 'last_name' => 'Diaz', 'email' => 'ana@cuatrovientos.test', 'phone' => '+15550100'],
        ],
    ]))->assertRedirect()->assertSessionHasNoErrors();

    $vivos = DB::table('carrier_contacts')
        ->where('carrier_id', $carrier->id)
        ->whereNull('deleted_at')
        ->where('is_primary', true)
        ->get();

    // El índice único de la base no admite dos principales vivos.
    expect($vivos)->toHaveCount(1)
        ->and($vivos[0]->first_name)->toBe('Beto');

    expect(DB::table('carriers')->where('id', $carrier->id)->value('email'))
        ->toBe('beto@cuatrovientos.test');
});

it('el alta con los cuatro campos sueltos sigue creando el principal', function () {
    signIn($this->scenario, Role::Admin);

    // Sin `contacts`. Una integración vieja, o una prueba escrita antes de esto,
    // no puede quedarse con una lista de contactos vacía.
    $this->post('/carriers', [
        'legal_name' => 'Antigua Forma LLC',
        'dot_number' => '3692580',
        'contact_first_name' => 'Carmen',
        'contact_last_name' => 'Soto',
        'email' => 'carmen@antigua.test',
        'phone' => '+15550120',
        'preferred_locale' => 'en',
    ])->assertRedirect()->assertSessionHasNoErrors();

    $carrier = DB::table('carriers')->where('dot_number', '3692580')->first();

    $contacto = DB::table('carrier_contacts')->where('carrier_id', $carrier->id)->first();

    expect($contacto)->not->toBeNull()
        ->and($contacto->first_name)->toBe('Carmen')
        ->and((bool) $contacto->is_primary)->toBeTrue();
});

/* ── Dirección postal ───────────────────────────────────────────────────── */

it('la dirección postal viene marcada como igual a la física', function () {
    signIn($this->scenario, Role::Admin);

    $this->post('/carriers', carrierPayload([
        'physical_line1' => '4474 Weston Rd',
        'physical_city' => 'Davie',
        'physical_country' => 'US',
        'physical_state' => 'FL',
    ]))->assertRedirect();

    expect((bool) DB::table('carriers')->where('dot_number', '7412580')->value('mailing_same_as_physical'))
        ->toBeTrue();
});

it('al desmarcarla guarda su propia dirección', function () {
    signIn($this->scenario, Role::Admin);

    $this->post('/carriers', carrierPayload([
        'physical_country' => 'US',
        'physical_state' => 'FL',
        'mailing_same_as_physical' => false,
        'mailing_line1' => 'PO Box 990',
        'mailing_city' => 'Monterrey',
        'mailing_country' => 'MX',
        'mailing_state' => 'NLE',
        'mailing_postal_code' => '64000',
    ]))->assertRedirect()->assertSessionHasNoErrors();

    $carrier = DB::table('carriers')->where('dot_number', '7412580')->first();

    expect((bool) $carrier->mailing_same_as_physical)->toBeFalse()
        ->and($carrier->mailing_city)->toBe('Monterrey')
        ->and($carrier->mailing_state)->toBe('NLE')
        ->and($carrier->mailing_country)->toBe('MX');
});

it('el estado postal también tiene que ser de su país', function () {
    signIn($this->scenario, Role::Admin);

    $this->post('/carriers', carrierPayload([
        'mailing_same_as_physical' => false,
        'mailing_country' => 'MX',
        'mailing_state' => 'FL',
    ]))->assertSessionHasErrors('mailing_state');
});
