<?php

declare(strict_types=1);

use App\Enums\Role;
use App\Services\Fmcsa\FmcsaDirectory;
use App\Services\Fmcsa\MockFmcsaDirectory;
use App\Services\Fmcsa\QcMobileDirectory;
use App\Support\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Inertia\Testing\AssertableInertia as Assert;
use Tests\Support\Scenario;

uses(DatabaseTransactions::class);

beforeEach(function () {
    app(TenantContext::class)->forget();
    $this->scenario = Scenario::create();
});

afterEach(fn () => app(TenantContext::class)->forget());

/* ── El paso uno ────────────────────────────────────────────────────────── */

it('el alta empieza sin ficha, solo con el número', function () {
    signIn($this->scenario, Role::Admin);

    $this->get('/carriers/create')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->where('lookup.status', 'idle')
            ->where('lookup.carrier', null));
});

it('un USDOT conocido trae la ficha', function () {
    signIn($this->scenario, Role::Admin);

    // El adaptador simulado es determinista: terminado en 4 devuelve ficha.
    $this->get('/carriers/create?dot=1234564')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->where('lookup.status', 'found')
            ->where('lookup.carrier.dotNumber', '1234564')
            ->where('lookup.carrier.legalName', 'DEMO CARRIER 1234564 LLC')
            // Sin credenciales NO se puede decir que se consultó nada, y de eso
            // depende que la pantalla deje los campos editables.
            ->where('lookup.live', false)
            ->where('lookup.provider', 'mock'));
});

it('distingue «no existe» de «el proveedor falló»', function () {
    signIn($this->scenario, Role::Admin);

    $this->get('/carriers/create?dot=1234560')
        ->assertInertia(fn (Assert $page) => $page->where('lookup.status', 'not_found'));

    $this->get('/carriers/create?dot=1234561')
        ->assertInertia(fn (Assert $page) => $page->where('lookup.status', 'error'));
});

it('un número con forma imposible ni se consulta', function () {
    signIn($this->scenario, Role::Admin);

    $this->get('/carriers/create?dot=12')
        ->assertInertia(fn (Assert $page) => $page->where('lookup.status', 'invalid'));
});

/* ── El duplicado ───────────────────────────────────────────────────────── */

it('avisa cuando ese USDOT ya está dado de alta', function () {
    signIn($this->scenario, Role::Admin);

    $dot = (string) $this->scenario->assignedCarrier->dot_number;

    $this->get("/carriers/create?dot={$dot}")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            // Lo más útil que devuelve la consulta no es la ficha: es «este ya
            // lo tienes». Un transportista duplicado ensucia las liquidaciones
            // durante meses.
            ->where('lookup.existing.id', (string) $this->scenario->assignedCarrier->id));
});

it('el aviso de duplicado no cruza empresas', function () {
    $otro = Scenario::create();
    app(TenantContext::class)->forget();

    signIn($this->scenario, Role::Admin);

    $dot = (string) $otro->assignedCarrier->dot_number;

    $this->get("/carriers/create?dot={$dot}")
        ->assertInertia(fn (Assert $page) => $page->where('lookup.existing', null));
});

/* ── El freno ───────────────────────────────────────────────────────────── */

it('pone un tope a las consultas por usuario', function () {
    signIn($this->scenario, Role::Admin);

    // FMCSA es un servicio público y gratuito. Pegarle sin freno desde un
    // formulario es la forma más rápida de que dejen de contestarnos.
    for ($i = 0; $i < 30; $i++) {
        $this->get('/carriers/create?dot=1234564');
    }

    $this->get('/carriers/create?dot=1234564')
        ->assertInertia(fn (Assert $page) => $page->where('lookup.status', 'throttled'));
});

/* ── Qué se guarda al crear ─────────────────────────────────────────────── */

it('sin credenciales NO escribe ninguna verificación', function () {
    signIn($this->scenario, Role::Admin);

    $antes = DB::table('fmcsa_verifications')->count();

    $this->post('/carriers', [
        'legal_name' => 'Nuevo Transportista LLC',
        'dot_number' => '9876543',
        'contact_first_name' => 'Ana',
        'contact_last_name' => 'Diaz',
        'email' => 'ana@nuevo.test',
        'phone' => '+15550100',
        'preferred_locale' => 'es',
    ])->assertRedirect();

    // Una fila «verificado» fabricada por un simulacro, puesta ahí sola sin que
    // nadie la pidiera, es la clase de dato que dentro de un año alguien lee
    // como si significara algo.
    expect(DB::table('fmcsa_verifications')->count())->toBe($antes);

    $creado = DB::table('carriers')->where('dot_number', '9876543')->first();

    expect($creado->fmcsa_status)->toBe('not_started')
        ->and($creado->fmcsa_last_verified_at)->toBeNull();
});

/* ── El adaptador real ──────────────────────────────────────────────────── */

it('sin clave se ata el simulado; con clave, el real', function () {
    config()->set('services.fmcsa.web_key', null);
    app()->forgetInstance(FmcsaDirectory::class);
    expect(app(FmcsaDirectory::class))->toBeInstanceOf(MockFmcsaDirectory::class);

    config()->set('services.fmcsa.web_key', 'no-es-una-clave-real');
    app()->forgetInstance(FmcsaDirectory::class);
    expect(app(FmcsaDirectory::class))->toBeInstanceOf(QcMobileDirectory::class);

    config()->set('services.fmcsa.web_key', null);
    app()->forgetInstance(FmcsaDirectory::class);
});

it('mapea la respuesta de QCMobile', function () {
    Http::fake([
        '*' => Http::response([
            'content' => [
                'carrier' => [
                    'dotNumber' => 1234567,
                    'legalName' => 'RIO GRANDE TRUCKING LLC',
                    'dbaName' => 'RIO EXPRESS',
                    'telephone' => '9565550100',
                    'phyStreet' => '120 COMMERCE ST',
                    'phyCity' => 'LAREDO',
                    'phyState' => 'TX',
                    'phyZipcode' => '78040',
                    'phyCountry' => 'US',
                    'allowedToOperate' => 'Y',
                    'statusCode' => 'A',
                    'safetyRating' => 'SATISFACTORY',
                    'safetyRatingDate' => '2024-03-15',
                    'totalPowerUnits' => 12,
                    'totalDrivers' => 14,
                    'censusTypeId' => ['censusTypeDesc' => 'CARRIER'],
                ],
            ],
        ], 200),
    ]);

    $directorio = new QcMobileDirectory(
        app(Illuminate\Http\Client\Factory::class),
        'clave-de-prueba',
        'https://ejemplo.test/qc/services',
    );

    $resultado = $directorio->byDot('1234567');

    expect($resultado->status->value)->toBe('found')
        ->and($resultado->live)->toBeTrue()
        ->and($resultado->carrier->legalName)->toBe('RIO GRANDE TRUCKING LLC')
        ->and($resultado->carrier->city)->toBe('LAREDO')
        ->and($resultado->carrier->allowedToOperate)->toBeTrue()
        ->and($resultado->carrier->operatingStatus)->toBe('ACTIVE')
        ->and($resultado->carrier->safetyRatingDate)->toBe('2024-03-15')
        ->and($resultado->carrier->powerUnits)->toBe(12)
        ->and($resultado->carrier->source)->toBe('FMCSA QCMobile');
});

it('un 200 con contenido vacío es «no existe», no un error', function () {
    Http::fake(['*' => Http::response(['content' => null], 200)]);

    $directorio = new QcMobileDirectory(
        app(Illuminate\Http\Client\Factory::class),
        'clave-de-prueba',
        'https://ejemplo.test/qc/services',
    );

    expect($directorio->byDot('7654321')->status->value)->toBe('not_found');
});

it('un fallo del proveedor no revienta el alta', function () {
    Http::fake(['*' => Http::response('', 500)]);

    $directorio = new QcMobileDirectory(
        app(Illuminate\Http\Client\Factory::class),
        'clave-de-prueba',
        'https://ejemplo.test/qc/services',
    );

    $resultado = $directorio->byDot('7654322');

    // Que FMCSA esté caído no puede impedir dar de alta a un transportista.
    expect($resultado->status->value)->toBe('error')
        ->and($resultado->carrier)->toBeNull();
});

/* ── El número MC ───────────────────────────────────────────────────────── */

it('trae el MC del endpoint de expedientes al buscar por USDOT', function () {
    // QCMobile NO devuelve el número MC en la ficha del transportista: vive en
    // `carriers/{dot}/docket-numbers`, porque una misma empresa puede tener
    // varios expedientes. Sin esa segunda llamada el campo llegaba en blanco.
    Http::fake([
        '*/docket-numbers*' => Http::response([
            'content' => [
                ['docketNumber' => ['docketNumber' => 987654, 'prefix' => 'MC', 'status' => 'I']],
                ['docketNumber' => ['docketNumber' => 445566, 'prefix' => 'MC', 'status' => 'A']],
                ['docketNumber' => ['docketNumber' => 111222, 'prefix' => 'FF', 'status' => 'A']],
            ],
        ], 200),
        '*' => Http::response([
            'content' => ['carrier' => ['dotNumber' => 1234567, 'legalName' => 'RIO GRANDE TRUCKING LLC']],
        ], 200),
    ]);

    $directorio = new QcMobileDirectory(
        app(Illuminate\Http\Client\Factory::class),
        'clave-de-prueba',
        'https://ejemplo.test/qc/services',
    );

    // Se prefiere el expediente ACTIVO, y solo los de prefijo MC.
    expect($directorio->byDot('1234567')->carrier->mcNumber)->toBe('445566');
});

it('sin expediente MC la ficha llega igual, con el campo vacío', function () {
    Http::fake([
        '*/docket-numbers*' => Http::response('', 500),
        '*' => Http::response([
            'content' => ['carrier' => ['dotNumber' => 7654321, 'legalName' => 'SIN MC LLC']],
        ], 200),
    ]);

    $directorio = new QcMobileDirectory(
        app(Illuminate\Http\Client\Factory::class),
        'clave-de-prueba',
        'https://ejemplo.test/qc/services',
    );

    $resultado = $directorio->byDot('7654321');

    // Que falle la segunda llamada no puede tirar la primera, que es la que
    // trae el nombre y la dirección.
    expect($resultado->status->value)->toBe('found')
        ->and($resultado->carrier->legalName)->toBe('SIN MC LLC')
        ->and($resultado->carrier->mcNumber)->toBeNull();
});
