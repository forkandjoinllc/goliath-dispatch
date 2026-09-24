<?php

declare(strict_types=1);

use App\Enums\Role;
use App\Support\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Inertia\Testing\AssertableInertia as Assert;
use Tests\Support\FleetFixtures;
use Tests\Support\Scenario;

uses(DatabaseTransactions::class);

beforeEach(function () {
    app(TenantContext::class)->forget();
    $this->scenario = Scenario::create();
});

afterEach(fn () => app(TenantContext::class)->forget());

/**
 * Lo que abren los paneles del tablero, y lo que NO abren.
 *
 * Aquí se mide lo que la pantalla afirma cuando se pulsa: que una carga de otro
 * transportista no se abre por poner su identificador en la barra de
 * direcciones, que el menú no ofrece cancelar lo que el servidor va a rechazar,
 * que la cronología junta de verdad las cinco fuentes, y que un conductor sin
 * carga en curso no tiene una posición inventada.
 *
 * La forma de las pantallas la sujeta `tests/Unit/Suite/BoardPanelsTest.php`.
 */
function panel(string $query): array
{
    /** @var Assert $pagina */
    $pagina = null;

    test()->get('/home?'.$query)
        ->assertOk()
        ->assertInertia(function (Assert $p) use (&$pagina): void {
            $pagina = $p;
        });

    return $pagina->toArray()['props'];
}

/* ── El alcance: fuera de alcance es igual que no existe ────────────────── */

it('una carga de otro transportista no se abre por poner su id en la URL', function () {
    // Un despachador solo lleva `assignedCarrier`. `otherLoad` es del otro.
    signIn($this->scenario, Role::Dispatcher);

    $props = panel('load='.$this->scenario->otherLoad->id);

    // NULO y no un 403: decir «no puede verla» ya diría que existe, y con eso
    // se enumeran las cargas de la competencia de una en una.
    expect($props['selectedLoad'])->toBeNull();

    // Y la suya sí, para que el nulo de arriba signifique algo.
    expect(panel('load='.$this->scenario->load->id)['selectedLoad'])->not->toBeNull();
});

it('un conductor fuera de alcance tampoco se abre', function () {
    signIn($this->scenario, Role::Dispatcher);

    $ajeno = FleetFixtures::conductor($this->scenario, 'Ana', 'Ruiz');

    // Se le pasa al transportista que este despachador NO lleva.
    DB::table('driver_carrier_relationships')
        ->where('driver_id', $ajeno)
        ->update(['carrier_id' => $this->scenario->otherCarrier->id]);

    expect(panel('driver='.$ajeno)['selectedDriver'])->toBeNull();
});

/* ── El menú no ofrece lo que el servidor va a rechazar ─────────────────── */

it('el menú no ofrece cancelar una carga ya pagada', function () {
    signIn($this->scenario, Role::Admin);

    $id = (string) $this->scenario->load->id;

    // Antes de pagarla, sí se puede: sin esto la prueba pasaría con un menú
    // que no ofrece cancelar NUNCA, que es exactamente el defecto que tenía.
    expect(panel('load='.$id)['selectedLoad']['can']['cancel'])->toBeTrue();

    DB::table('loads')->where('id', $id)->update(['status' => 'paid']);

    expect(panel('load='.$id)['selectedLoad']['can']['cancel'])->toBeFalse();
});

/* ── La cronología junta las fuentes de verdad ──────────────────────────── */

it('la cronología de la carga junta el estado, la asignación y la parada', function () {
    signIn($this->scenario, Role::Admin);

    $id = (string) $this->scenario->load->id;
    $conductor = FleetFixtures::conductor($this->scenario, 'Ana', 'Ruiz');
    FleetFixtures::enLaCarga($this->scenario, $id, 'driver', $conductor);

    DB::table('load_status_history')->insert([
        'id' => (string) Str::uuid(),
        'tenant_id' => (string) $this->scenario->tenant->id,
        'load_id' => $id,
        'from_status' => null,
        'to_status' => 'draft',
        'source' => 'user',
        'occurred_at' => now()->subDays(2),
        'created_at' => now(),
        'updated_at' => now(),
    ]);

    $parada = DB::table('load_stops')->where('load_id', $id)->orderBy('sequence')->first(['id']);
    DB::table('load_stops')->where('id', $parada->id)->update(['actual_arrival_at' => now()->subHour()]);

    $tipos = collect(panel('load='.$id)['selectedLoad']['history'])->pluck('type');

    // Las tres fuentes en una sola lista. Sin juntarlas, contestar «¿qué ha
    // pasado con esta carga?» exige abrir cinco sitios y ordenar de cabeza.
    expect($tipos)->toContain('created')
        ->and($tipos)->toContain('assigned')
        ->and($tipos)->toContain('arrived');
});

it('la cronología va de lo más nuevo a lo más viejo', function () {
    signIn($this->scenario, Role::Admin);

    $id = (string) $this->scenario->load->id;

    foreach ([['draft', 3], ['available', 1]] as [$estado, $dias]) {
        DB::table('load_status_history')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => (string) $this->scenario->tenant->id,
            'load_id' => $id,
            'from_status' => $estado === 'draft' ? null : 'draft',
            'to_status' => $estado,
            'source' => 'user',
            'occurred_at' => now()->subDays($dias),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    $historia = panel('load='.$id)['selectedLoad']['history'];

    expect($historia[0]['detail']['to'])->toBe('available');
});

it('la cronología nombra el sitio del cliente cuando la parada no lo escribe', function () {
    signIn($this->scenario, Role::Admin);

    $id = (string) $this->scenario->load->id;
    $sitio = (string) Str::uuid();

    DB::table('customer_locations')->insert([
        'id' => $sitio,
        'tenant_id' => (string) $this->scenario->tenant->id,
        'customer_id' => (string) $this->scenario->customer->id,
        'name' => 'Bodega Laredo',
        'line1' => '1200 Industrial Blvd',
        'city' => 'Laredo',
        'state' => 'TX',
        'country' => 'US',
        'timezone' => 'America/Chicago',
        'created_at' => now(),
        'updated_at' => now(),
    ]);

    // Una parada que APUNTA a la instalación del cliente y no repite sus
    // datos: es lo que hace el alta de verdad, y deja su nombre, su ciudad y
    // su huso en nulo.
    $parada = DB::table('load_stops')->where('load_id', $id)->orderBy('sequence')->first(['id']);
    DB::table('load_stops')->where('id', $parada->id)->update([
        'customer_location_id' => $sitio,
        'facility_name' => null,
        'city' => null,
        'state' => null,
        'actual_arrival_at' => now()->subHour(),
    ]);

    $llegada = collect(panel('load='.$id)['selectedLoad']['history'])->firstWhere('type', 'arrived');

    // Sin unir `customer_locations`, la cronología decía «Llegó a la recogida ·
    // —» justo debajo del panel que, en la misma pantalla, nombraba el sitio.
    expect($llegada)->not->toBeNull();
    expect($llegada['detail']['place'])->toBe('Bodega Laredo · Laredo, TX');

    // Y la ventana de edición lo nombra en vez de enseñar dos casillas en
    // blanco: la parada no tiene ciudad propia, la tiene el sitio del cliente,
    // y unas casillas vacías que no mandan en lo que se ve son peores que
    // ninguna casilla.
    $muelle = collect(panel('load='.$id)['selectedLoad']['edit']['stops'])
        ->firstWhere('id', (string) $parada->id);

    expect($muelle['locationName'])->toBe('Bodega Laredo · Laredo, TX');
    expect($muelle['city'])->toBeNull();
});

/* ── Lo que el conductor NO tiene ───────────────────────────────────────── */

it('el rastro del conductor son las posiciones de sus cargas, y nada más', function () {
    signIn($this->scenario, Role::Admin);

    $conCarga = FleetFixtures::conductor($this->scenario, 'Ana', 'Ruiz');
    $sinCarga = FleetFixtures::conductor($this->scenario, 'Beto', 'Lara');
    $id = (string) $this->scenario->load->id;

    FleetFixtures::enLaCarga($this->scenario, $id, 'driver', $conCarga);

    DB::table('tracking_events')->insert([
        'id' => (string) Str::uuid(),
        'tenant_id' => (string) $this->scenario->tenant->id,
        'load_id' => $id,
        'provider' => 'manual',
        'event_type' => 'location_update',
        'location_label' => 'Cotulla, TX',
        'occurred_at' => now()->subMinutes(30),
        'ingested_at' => now(),
        'created_at' => now(),
        'updated_at' => now(),
    ]);

    // La mitad que dice que SÍ hay rastro cuando lo hay. Sin ella, «no tiene
    // posición» lo cumple igual de bien una lista que está siempre vacía.
    $llevando = collect(panel('driver='.$conCarga)['selectedDriver']['timeline']);
    expect($llevando->pluck('type'))->toContain('tracking');
    expect($llevando->firstWhere('type', 'tracking')['detail']['place'])->toBe('Cotulla, TX');

    // Y la que dice que no se inventa ninguna. Las posiciones entran POR
    // CARGA: quien no lleva ninguna no tiene rastro, y la lista se queda corta
    // en vez de colocarlo donde estuvo la última vez.
    $parado = panel('driver='.$sinCarga)['selectedDriver'];
    expect($parado['currentLoad'])->toBeNull();
    expect(collect($parado['timeline'])->pluck('type'))->not->toContain('tracking');

    // Y la tercera, que es la que de verdad cierra la puerta: alguien que SÍ
    // lleva cargas, pero otras. Su rastro tiene que ser el de las suyas y no
    // el del compañero. Con solo los dos de arriba, quitarle el filtro de
    // carga a la consulta no cambiaba nada —el parado sale antes por no tener
    // ninguna— y el guardián se quedaba verde con las posiciones cruzadas.
    $otras = FleetFixtures::conductor($this->scenario, 'Carmen', 'Vidal');
    FleetFixtures::enLaCarga($this->scenario, (string) $this->scenario->otherLoad->id, 'driver', $otras);

    $suyo = collect(panel('driver='.$otras)['selectedDriver']['timeline']);

    expect($suyo->pluck('type'))->toContain('assigned');
    expect($suyo->pluck('type'))->not->toContain('tracking');
});

it('la carga en curso no cuenta las ya entregadas', function () {
    signIn($this->scenario, Role::Admin);

    $id = (string) $this->scenario->load->id;
    $conductor = FleetFixtures::conductor($this->scenario, 'Ana', 'Ruiz');
    FleetFixtures::enLaCarga($this->scenario, $id, 'driver', $conductor);

    DB::table('loads')->where('id', $id)->update(['status' => 'in_transit']);
    expect(panel('driver='.$conductor)['selectedDriver']['currentLoad'])->not->toBeNull();

    // Entregada ya no es «en curso»: preguntarle a un conductor qué lleva y
    // que conteste con la de la semana pasada es peor que no contestar.
    DB::table('loads')->where('id', $id)->update(['status' => 'delivered']);
    expect(panel('driver='.$conductor)['selectedDriver']['currentLoad'])->toBeNull();
});

/* ── Las listas del alta rápida ─────────────────────────────────────────── */

it('el alta rápida no ofrece clientes archivados', function () {
    signIn($this->scenario, Role::Admin);

    $otro = (string) Str::uuid();
    DB::table('customers')->insert([
        'id' => $otro,
        'tenant_id' => (string) $this->scenario->tenant->id,
        'company_name' => 'Archivada SA',
        'company_name_normalized' => 'archivada sa',
        'status' => 'archived',
        'created_at' => now(),
        'updated_at' => now(),
    ]);

    $ids = collect(panel('tab=unassigned')['quickAdd']['customers'])->pluck('id');

    expect($ids)->not->toContain($otro);
    expect($ids)->toContain((string) $this->scenario->customer->id);
});

it('quien no puede crear no recibe las listas', function () {
    // Un conductor tiene tablero, pero no da de alta ni cargas ni compañeros.
    // Mandarle la lista de clientes de la empresa es un dato que nadie pidió.
    signIn($this->scenario, Role::Driver);

    $rapidas = panel('tab=unassigned')['quickAdd'];

    expect($rapidas['canLoad'])->toBeFalse()
        ->and($rapidas['customers'])->toBe([])
        ->and($rapidas['carriers'])->toBe([]);
});

/* ── La edición rápida no borra lo que no enseña ────────────────────────── */

it('guardar desde la ventana rápida conserva lo que la ventana no enseña', function () {
    signIn($this->scenario, Role::Admin);

    $id = (string) $this->scenario->load->id;

    DB::table('loads')->where('id', $id)->update([
        'po_number' => 'PO-4471',
        'customer_charge_cents' => 250000,
        'special_instructions' => 'Lona y ocho cadenas.',
        'miles' => 812,
    ]);

    $parada = DB::table('load_stops')->where('load_id', $id)->orderBy('sequence')->first(['id']);
    DB::table('load_stops')->where('id', $parada->id)->update([
        'contact_name' => 'Marta Solís',
        'contact_phone' => '+1 555 0199',
        'postal_code' => '78045',
    ]);

    // Lo que el panel manda de vuelta, tal cual lo construye el servidor, con
    // la mercancía cambiada —que es lo único que la ventana enseña—.
    $formulario = panel('load='.$id)['selectedLoad']['edit'];
    $formulario['commodity'] = 'Acero galvanizado';

    $this->patch('/loads/'.$id, $formulario)->assertRedirect();

    $carga = DB::table('loads')->where('id', $id)->first();
    $muelle = DB::table('load_stops')->where('id', $parada->id)->first();

    expect($carga->commodity)->toBe('Acero galvanizado')
        // Y nada de lo demás se movió. Antes de esto, guardar desde una
        // ventana con cuatro campos dejaba la carga sin PO, sin instrucciones,
        // sin millas, con la tarifa a cero y el muelle sin contacto.
        ->and($carga->po_number)->toBe('PO-4471')
        ->and((int) $carga->customer_charge_cents)->toBe(250000)
        ->and($carga->special_instructions)->toBe('Lona y ocho cadenas.')
        ->and((int) $carga->miles)->toBe(812)
        ->and($muelle->contact_name)->toBe('Marta Solís')
        ->and($muelle->contact_phone)->toBe('+1 555 0199')
        ->and($muelle->postal_code)->toBe('78045');

    // Y las paradas siguen siendo LAS MISMAS, no copias nuevas: sin el id, la
    // hora de llegada real y las detenciones se irían con las viejas.
    expect(DB::table('load_stops')->where('load_id', $id)->whereNull('deleted_at')->count())
        ->toBe(count($formulario['stops']));
    expect(DB::table('load_stops')->where('id', $parada->id)->whereNull('deleted_at')->exists())
        ->toBeTrue();
});
