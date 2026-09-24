<?php

declare(strict_types=1);

use App\Enums\Role;
use App\Services\Map\MapProvider;
use App\Support\Fleet\StandingAssignment;
use App\Support\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
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
 * El tablero de despacho.
 *
 * Lo que aquí se mide es lo que la pantalla AFIRMA: que la pestaña de las
 * asignadas solo trae cargas con conductor, que la tarjeta dice si la fecha es
 * de recogida o de entrega, que la columna de conductores enseña el equipo
 * habitual, y que el mapa no coloca lo que no sabe dónde está.
 *
 * La forma de la pantalla la sujetan los guardianes de `tests/Unit/Suite`.
 */
/**
 * El tablero abierto en una pestaña, con el periodo ANCHO.
 *
 * `period=this_year` y no el de por omisión: el tablero viene puesto en «hoy»
 * y las cargas del escenario tienen sus citas dentro de los próximos días, así
 * que con el periodo por omisión estas pruebas medirían el filtro de fechas en
 * vez de lo que dicen medir —cómo se reparten las pestañas, qué dice la
 * tarjeta, qué se dibuja en el mapa—. El filtro tiene sus propias pruebas en
 * `BoardFiltersTest`.
 */
function tablero(string $pestana = 'unassigned'): Assert
{
    /** @var Assert $pagina */
    $pagina = null;

    test()->get('/home?period=this_year&tab='.$pestana)
        ->assertOk()
        ->assertInertia(function (Assert $p) use (&$pagina): void {
            $pagina = $p;
        });

    return $pagina;
}

/* ── Dónde vive cada panel ──────────────────────────────────────────────── */

it('la raíz es el tablero y el panel de siempre se fue a Análisis', function () {
    signIn($this->scenario, Role::Admin);

    $this->get('/home')->assertOk()->assertInertia(fn (Assert $p) => $p->component('App/Board'));
    $this->get('/insight/dashboard')->assertOk()
        ->assertInertia(fn (Assert $p) => $p->component('App/Dashboard'));
});

/* ── Las tres pestañas ──────────────────────────────────────────────────── */

it('las tres pestañas se reparten las cargas y no repiten ninguna', function () {
    // Una partición: cada carga viva cae en una y solo una. Si una cayera en
    // dos, el tablero la contaría dos veces; si no cayera en ninguna,
    // desaparecería sin que nadie la echara de menos.
    signIn($this->scenario, Role::Admin);

    $conductor = FleetFixtures::conductor($this->scenario, 'Ana', 'Ruiz');
    FleetFixtures::enLaCarga($this->scenario, (string) $this->scenario->load->id, 'driver', $conductor);

    $cuentas = tablero()->toArray()['props']['counts'];

    $vivas = DB::table('loads')
        ->where('tenant_id', $this->scenario->tenant->id)
        ->whereNotIn('status', ['cancelled', 'draft'])
        ->whereNull('deleted_at')
        ->count();

    expect(array_sum($cuentas))->toBe($vivas);
});

it('una carga con camión pero sin conductor sigue sin asignar', function () {
    // «Sin asignar» es la ausencia de CONDUCTOR, no la de asignaciones: una
    // carga despachada a la que alguien le quitó el conductor conserva el
    // camión puesto, y es justo la que hay que ver primero. Medirlo con una
    // carga sin ninguna asignación no distinguía las dos reglas.
    signIn($this->scenario, Role::Admin);

    DB::table('loads')->where('id', $this->scenario->load->id)->update(['status' => 'dispatched']);
    FleetFixtures::enLaCarga(
        $this->scenario,
        (string) $this->scenario->load->id,
        'truck',
        FleetFixtures::camion($this->scenario, 'T-900'),
    );

    $sin = collect(tablero('unassigned')->toArray()['props']['loads'])->pluck('id');
    $asignadas = collect(tablero('assigned')->toArray()['props']['loads'])->pluck('id');

    expect($sin)->toContain((string) $this->scenario->load->id);
    expect($asignadas)->not->toContain((string) $this->scenario->load->id);
});

it('con conductor pasa a las asignadas y la tarjeta lo nombra con su equipo', function () {
    signIn($this->scenario, Role::Admin);

    $conductor = FleetFixtures::conductor($this->scenario, 'Ana', 'Ruiz');
    $camion = FleetFixtures::camion($this->scenario, 'T-900');
    $remolque = FleetFixtures::remolque($this->scenario, 'R-900');

    DB::table('loads')->where('id', $this->scenario->load->id)->update(['status' => 'in_transit']);
    FleetFixtures::enLaCarga($this->scenario, (string) $this->scenario->load->id, 'driver', $conductor);
    FleetFixtures::enLaCarga($this->scenario, (string) $this->scenario->load->id, 'truck', $camion);
    FleetFixtures::enLaCarga($this->scenario, (string) $this->scenario->load->id, 'trailer', $remolque);

    $tarjeta = collect(tablero('assigned')->toArray()['props']['loads'])
        ->firstWhere('id', (string) $this->scenario->load->id);

    expect($tarjeta)->not->toBeNull();
    // Las tres piezas vienen en TRES filas de `load_assignments`, una por
    // recurso. Quedarse con la primera dejaba la tarjeta diciendo «sin
    // conductor» en la pestaña de las que sí lo tienen.
    expect($tarjeta['driver']['firstName'])->toBe('Ana');
    expect($tarjeta['truck'])->toBe('T-900');
    expect($tarjeta['trailer'])->toBe('R-900');
});

/* ── La fecha dice de qué es ────────────────────────────────────────────── */

it('la tarjeta dice si la fecha es de recogida o de entrega', function () {
    signIn($this->scenario, Role::Admin);

    DB::table('loads')->where('id', $this->scenario->load->id)->update(['status' => 'available']);

    $tarjeta = collect(tablero()->toArray()['props']['loads'])
        ->firstWhere('id', (string) $this->scenario->load->id);

    expect($tarjeta['nextStop'])->not->toBeNull();
    expect($tarjeta['nextStop']['type'])->toBe('pickup');
});

it('llegada la recogida, la tarjeta pasa a la entrega', function () {
    // La siguiente parada es la primera a la que NO se ha llegado. Quien mira
    // el tablero quiere saber qué falta, no qué ya pasó.
    signIn($this->scenario, Role::Admin);

    DB::table('loads')->where('id', $this->scenario->load->id)->update(['status' => 'available']);

    DB::table('load_stops')
        ->where('load_id', $this->scenario->load->id)
        ->where('stop_type', 'pickup')
        ->update(['actual_arrival_at' => now()->subHour()]);

    $tarjeta = collect(tablero()->toArray()['props']['loads'])
        ->firstWhere('id', (string) $this->scenario->load->id);

    expect($tarjeta['nextStop']['type'])->toBe('delivery');
});

/* ── La columna de conductores ──────────────────────────────────────────── */

it('el conductor enseña el equipo que lleva habitualmente', function () {
    signIn($this->scenario, Role::Admin);

    $conductor = FleetFixtures::conductor($this->scenario, 'Ana', 'Ruiz');
    $camion = FleetFixtures::camion($this->scenario, 'T-900');
    $remolque = FleetFixtures::remolque($this->scenario, 'R-900');

    $this->post("/drivers/{$conductor}/equipment", [
        'truck_id' => $camion,
        'trailer_id' => $remolque,
        'starts_on' => now()->subDay()->toDateString(),
    ])->assertRedirect();

    $fila = collect(tablero()->toArray()['props']['drivers'])->firstWhere('id', $conductor);

    expect($fila['truck']['unitNumber'])->toBe('T-900');
    expect($fila['trailer']['unitNumber'])->toBe('R-900');
    // El teléfono va, porque el tablero se mira desde el móvil y se marca.
    expect($fila['phone'])->toBe('+1 555 0100');
});

it('un conductor puede no tener remolque', function () {
    // En una flota los remolques se sueltan y se recogen: exigirlo obligaría a
    // inventar uno.
    signIn($this->scenario, Role::Admin);

    $conductor = FleetFixtures::conductor($this->scenario, 'Ana', 'Ruiz');

    $this->post("/drivers/{$conductor}/equipment", [
        'truck_id' => FleetFixtures::camion($this->scenario, 'T-900'),
        'starts_on' => now()->toDateString(),
    ])->assertRedirect();

    $fila = collect(tablero()->toArray()['props']['drivers'])->firstWhere('id', $conductor);

    expect($fila['truck']['unitNumber'])->toBe('T-900');
    expect($fila['trailer'])->toBeNull();
});

/* ── Las reglas de la asignación fija ───────────────────────────────────── */

it('un camión no puede estar con dos conductores a la vez', function () {
    signIn($this->scenario, Role::Admin);

    $camion = FleetFixtures::camion($this->scenario, 'T-900');
    $uno = FleetFixtures::conductor($this->scenario, 'Ana', 'Ruiz');
    $otro = FleetFixtures::conductor($this->scenario, 'Luis', 'Paz');

    $this->post("/drivers/{$uno}/equipment", [
        'truck_id' => $camion,
        'starts_on' => now()->subDay()->toDateString(),
    ])->assertRedirect();

    $this->post("/drivers/{$otro}/equipment", [
        'truck_id' => $camion,
        'starts_on' => now()->toDateString(),
    ])->assertSessionHasErrors('truck_id');
});

it('pero sí después, cuando el primero la ha terminado', function () {
    // El solapamiento es lo que se rechaza, no el reúso: un camión cambia de
    // conductor, y el historial tiene que poder contarlo.
    signIn($this->scenario, Role::Admin);

    $camion = FleetFixtures::camion($this->scenario, 'T-900');
    $uno = FleetFixtures::conductor($this->scenario, 'Ana', 'Ruiz');
    $otro = FleetFixtures::conductor($this->scenario, 'Luis', 'Paz');

    $this->post("/drivers/{$uno}/equipment", [
        'truck_id' => $camion,
        'starts_on' => now()->subDays(30)->toDateString(),
        'ends_on' => now()->subDays(2)->toDateString(),
    ])->assertRedirect();

    $this->post("/drivers/{$otro}/equipment", [
        'truck_id' => $camion,
        'starts_on' => now()->subDay()->toDateString(),
    ])->assertRedirect();

    expect(StandingAssignment::conductorDeCamion((string) $this->scenario->tenant->id, $camion))
        ->toBe($otro);
});

it('un conductor no puede tener dos equipos a la vez', function () {
    signIn($this->scenario, Role::Admin);

    $conductor = FleetFixtures::conductor($this->scenario, 'Ana', 'Ruiz');

    $this->post("/drivers/{$conductor}/equipment", [
        'truck_id' => FleetFixtures::camion($this->scenario, 'T-900'),
        'starts_on' => now()->subDay()->toDateString(),
    ])->assertRedirect();

    $this->post("/drivers/{$conductor}/equipment", [
        'truck_id' => FleetFixtures::camion($this->scenario, 'T-901'),
        'starts_on' => now()->toDateString(),
    ])->assertSessionHasErrors('truck_id');
});

it('una unidad de otra empresa no se puede asignar', function () {
    signIn($this->scenario, Role::Admin);

    $otra = Scenario::create();
    $conductor = FleetFixtures::conductor($this->scenario, 'Ana', 'Ruiz');

    $this->post("/drivers/{$conductor}/equipment", [
        'truck_id' => FleetFixtures::camion($otra, 'T-900'),
        'starts_on' => now()->toDateString(),
    ])->assertSessionHasErrors('truck_id');
});

/* ── El mapa ────────────────────────────────────────────────────────────── */

it('sin coordenadas no hay punto', function () {
    // Un municipio no se coloca «más o menos»: un PIN a doscientos kilómetros
    // de la fábrica es peor que un PIN que falta, porque quien lo ve lo cree.
    signIn($this->scenario, Role::Admin);

    $conductor = FleetFixtures::conductor($this->scenario, 'Ana', 'Ruiz');
    DB::table('loads')->where('id', $this->scenario->load->id)->update(['status' => 'in_transit']);
    FleetFixtures::enLaCarga($this->scenario, (string) $this->scenario->load->id, 'driver', $conductor);

    $mapa = tablero()->toArray()['props']['map'];

    expect($mapa['stops'])->toBe([]);
    // Y la carga viva sin posición se CUENTA, para poder decirlo.
    expect($mapa['withoutSignal'])->toBe(1);
});

it('con coordenadas, cada parada es un punto que dice de qué es', function () {
    signIn($this->scenario, Role::Admin);

    $conductor = FleetFixtures::conductor($this->scenario, 'Ana', 'Ruiz');
    DB::table('loads')->where('id', $this->scenario->load->id)->update(['status' => 'in_transit']);
    FleetFixtures::enLaCarga($this->scenario, (string) $this->scenario->load->id, 'driver', $conductor);

    DB::table('load_stops')
        ->where('load_id', $this->scenario->load->id)
        ->where('stop_type', 'pickup')
        ->update(['latitude' => '27.5064', 'longitude' => '-99.5075']);

    $mapa = tablero()->toArray()['props']['map'];
    $punto = collect($mapa['stops'])->firstWhere('type', 'pickup');

    expect($punto)->not->toBeNull();
    expect($punto['lat'])->toBe(27.5064);
});

it('con clave, el tablero manda la de Google y nada más', function () {
    // La clave de mapas VIAJA al navegador y es pública por diseño: la API
    // corre ahí. Lo que la protege es restringirla por dominio en la consola de
    // Google. Lo que no puede pasar es que viaje ninguna OTRA.
    config(['services.google_maps.key' => 'clave-de-prueba', 'services.google_maps.map_id' => null]);
    app()->forgetInstance(MapProvider::class);

    signIn($this->scenario, Role::Admin);

    $mapa = tablero()->toArray()['props']['map'];

    expect($mapa['provider'])->toBe('google');
    expect($mapa['live'])->toBeTrue();
    expect(array_keys($mapa['config']))->toBe(['apiKey', 'mapId']);
    expect($mapa['config']['apiKey'])->toBe('clave-de-prueba');
});

it('sin clave de Google el mapa se dibuja igual, y lo dice', function () {
    // Un tablero que no se puede abrir sin cuenta de Google sería un tablero
    // que no se puede probar.
    //
    // La ausencia se pone a mano y no se hereda del entorno: con una clave en
    // el `.env` de quien corre las pruebas, esto medía otra cosa — y así falló,
    // en verde durante semanas de haberla tenido puesta.
    config(['services.google_maps.key' => null]);
    app()->forgetInstance(MapProvider::class);

    signIn($this->scenario, Role::Admin);

    $mapa = tablero()->toArray()['props']['map'];

    expect($mapa['provider'])->toBe('none');
    expect($mapa['live'])->toBeFalse();
    expect($mapa['config'])->toBe([]);
});
