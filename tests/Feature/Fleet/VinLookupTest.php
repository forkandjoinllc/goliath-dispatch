<?php

declare(strict_types=1);

use App\Enums\Role;
use App\Models\Truck;
use App\Services\Vin\ChainVinDecoder;
use App\Services\Vin\NhtsaVinDecoder;
use App\Services\Vin\OfflineVinDecoder;
use App\Services\Vin\VinDecoder;
use App\Support\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\Client\Factory as HttpFactory;
use Illuminate\Support\Facades\Http;
use Tests\Support\Scenario;

uses(DatabaseTransactions::class);

beforeEach(function () {
    app(TenantContext::class)->forget();
    $this->scenario = Scenario::create();
});

afterEach(fn () => app(TenantContext::class)->forget());

/** Un VIN de verdad, con su dígito de control cuadrado. */
const VIN_FREIGHTLINER = '1FUJGLDR8MLBA1101';

/**
 * Las cabeceras que manda el formulario.
 *
 * Y NO `getJson()`: el cliente de pruebas prepara las cookies de otra manera
 * para esas llamadas y la sesión no llega, así que la petición entra sin
 * empresa y el permiso deniega. El navegador sí manda la cookie —es una
 * petición al mismo origen—, de modo que `getJson()` estaría midiendo una
 * limitación del cliente de pruebas y no el comportamiento de la pantalla.
 *
 * @var array<string, string>
 */
const COMO_EL_FORMULARIO = ['Accept' => 'application/json', 'X-Requested-With' => 'XMLHttpRequest'];

/** Ata el decodificador encadenado con la NHTSA fingida. */
function conLaNhtsaFingida(array $respuesta): void
{
    Http::fake([
        '*vpic.nhtsa.dot.gov*' => Http::response($respuesta, 200),
    ]);

    app()->instance(VinDecoder::class, new ChainVinDecoder([
        new NhtsaVinDecoder(app(HttpFactory::class), 'https://vpic.nhtsa.dot.gov/api/vehicles'),
        new OfflineVinDecoder,
    ]));
}

/* ── Quién puede preguntar ───────────────────────────────────────────────── */

it('hace falta poder dar de alta o editar equipo', function (): void {
    // Es una consulta barata, pero es una consulta a un servicio de fuera hecha
    // con el servidor de la empresa: sin permiso sería una pasarela abierta.
    signIn($this->scenario, Role::Driver);

    $this->get('/equipment/trucks/vin/'.VIN_FREIGHTLINER, COMO_EL_FORMULARIO)->assertForbidden();
});

it('un despachador sí puede', function (): void {
    signIn($this->scenario, Role::Dispatcher);

    $this->get('/equipment/trucks/vin/'.VIN_FREIGHTLINER, COMO_EL_FORMULARIO)->assertOk();
});

it('sin sesión no se contesta', function (): void {
    $this->get('/equipment/trucks/vin/'.VIN_FREIGHTLINER, COMO_EL_FORMULARIO)->assertUnauthorized();
});

/* ── Lo que contesta ─────────────────────────────────────────────────────── */

it('sin la NHTSA encendida devuelve año y marca del propio número', function (): void {
    // Es lo que corre en una instalación sin salida a internet, y lo que tapa
    // los huecos cuando la NHTSA no contesta.
    signIn($this->scenario, Role::Admin);

    $this->get('/equipment/trucks/vin/'.VIN_FREIGHTLINER, COMO_EL_FORMULARIO)
        ->assertOk()
        ->assertJson([
            'vin' => VIN_FREIGHTLINER,
            'wellFormed' => true,
            'checksumOk' => true,
            'live' => false,
            'decoded' => ['make' => 'Freightliner', 'model' => null, 'year' => 2021],
        ]);
});

it('con la NHTSA encendida llega además el modelo', function (): void {
    // El modelo es la única de las tres que no está en el número.
    signIn($this->scenario, Role::Admin);

    conLaNhtsaFingida(['Results' => [[
        'Make' => 'FREIGHTLINER',
        'Model' => 'Cascadia',
        'ModelYear' => '2021',
    ]]]);

    $this->get('/equipment/trucks/vin/'.VIN_FREIGHTLINER, COMO_EL_FORMULARIO)
        ->assertOk()
        ->assertJson([
            'live' => true,
            'decoded' => ['make' => 'FREIGHTLINER', 'model' => 'Cascadia', 'year' => 2021],
        ]);
});

it('si la NHTSA se cae, el año y la marca siguen saliendo', function (): void {
    // ESTE es el motivo de que haya cadena y no un solo proveedor: que el
    // servicio esté caído no puede dejar el formulario sin ayudar.
    signIn($this->scenario, Role::Admin);

    Http::fake(['*vpic.nhtsa.dot.gov*' => Http::response('', 500)]);

    app()->instance(VinDecoder::class, new ChainVinDecoder([
        new NhtsaVinDecoder(app(HttpFactory::class), 'https://vpic.nhtsa.dot.gov/api/vehicles'),
        new OfflineVinDecoder,
    ]));

    $this->get('/equipment/trucks/vin/'.VIN_FREIGHTLINER, COMO_EL_FORMULARIO)
        ->assertOk()
        ->assertJson(['decoded' => ['make' => 'Freightliner', 'year' => 2021]]);
});

it('vPIC contestando vacío no inventa nada', function (): void {
    // vPIC devuelve 200 con los campos en blanco cuando no conoce el número.
    signIn($this->scenario, Role::Admin);

    conLaNhtsaFingida(['Results' => [['Make' => '', 'Model' => '', 'ModelYear' => '']]]);

    $this->get('/equipment/trucks/vin/'.VIN_FREIGHTLINER, COMO_EL_FORMULARIO)
        ->assertOk()
        // El respaldo sigue sabiendo lo suyo; lo que no hace nadie es
        // rellenar el modelo con una cadena vacía.
        ->assertJson(['decoded' => ['make' => 'Freightliner', 'model' => null, 'year' => 2021]])
        // Y no se le atribuye a la NHTSA lo que la NHTSA no contestó: la
        // pantalla dice de dónde salió cada dato, y decir «de la base oficial»
        // sobre algo que se leyó del propio número es mentir sobre la fuente.
        ->assertJson(['decoded' => ['sources' => ['vin']]]);
});

it('un VIN con el dígito mal se dice, y no se decodifica', function (): void {
    signIn($this->scenario, Role::Admin);

    $this->get('/equipment/trucks/vin/1M8GDM9AXKP042789', COMO_EL_FORMULARIO)
        ->assertOk()
        ->assertJson([
            'wellFormed' => true,
            'checksumOk' => false,
            'decoded' => null,
        ]);
});

it('una cadena que no es un VIN no revienta nada', function (): void {
    signIn($this->scenario, Role::Admin);

    $this->get('/equipment/trucks/vin/HOLA123', COMO_EL_FORMULARIO)
        ->assertOk()
        ->assertJson(['wellFormed' => false, 'checksumOk' => false, 'decoded' => null]);
});

it('la consulta no guarda nada', function (): void {
    // Contesta y ya: lo que se guarde lo decide la persona al enviar el
    // formulario. Un alta a medias por consultar un número sería una sorpresa.
    signIn($this->scenario, Role::Admin);

    $antes = Truck::query()->count();

    $this->get('/equipment/trucks/vin/'.VIN_FREIGHTLINER, COMO_EL_FORMULARIO)->assertOk();

    expect(Truck::query()->count())->toBe($antes);
});

it('vale igual para remolques', function (): void {
    signIn($this->scenario, Role::Admin);

    $this->get('/equipment/trailers/vin/1UYFS2H88KU212121', COMO_EL_FORMULARIO)
        ->assertOk()
        ->assertJson(['decoded' => ['make' => 'Utility Trailer', 'year' => 2019]]);
});
