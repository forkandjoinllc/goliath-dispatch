<?php

declare(strict_types=1);

use App\Enums\Role;
use App\Support\TenantContext;
use App\Support\Time\Clock;
use Carbon\CarbonImmutable;
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
 * Los dos filtros del tablero: el periodo y el transportista.
 *
 * ## Qué significa «hoy»
 *
 * No «las cargas cuya fecha es hoy», sino las que están rodando hoy: una carga
 * que recogió ayer y entrega mañana tiene que salir, porque es exactamente la
 * que hay que tener delante. Medir eso con una carga de un solo día no
 * distingue las dos lecturas, así que aquí se mide con una de tres.
 *
 * ## Y qué NO recorta
 *
 * La columna de conductores, que contesta «¿a quién se la doy?». Esconder a los
 * que hoy no han hecho nada la deja sin contestar nada. Lo que sí se recorta es
 * la cronología del panel del conductor.
 */
function pantalla(string $query = ''): array
{
    /** @var Assert $pagina */
    $pagina = null;

    test()->get('/home'.($query === '' ? '' : '?'.$query))
        ->assertOk()
        ->assertInertia(function (Assert $p) use (&$pagina): void {
            $pagina = $p;
        });

    return $pagina->toArray()['props'];
}

/**
 * Un instante en el reloj DE QUIEN MIRA, devuelto en UTC para guardarlo.
 *
 * La prueba tiene que hablar el mismo reloj que la pantalla. `now()` es UTC, y
 * «hoy a las ocho» en UTC son las cuatro de la madrugada del día siguiente
 * para quien está en Chicago: la carga se guardaba fuera del día que la prueba
 * decía estar midiendo, y la prueba fallaba teniendo razón el código.
 *
 * El huso sale del usuario que ha entrado —`UserFactory` pone
 * `America/Chicago`— y no de una constante escrita aquí, para que siga siendo
 * cierta si esa siembra cambia.
 */
function enElRelojDelQueMira(int $dias = 0, int $hora = 12): CarbonImmutable
{
    $huso = Clock::zona(auth()->user()?->timezone);

    return CarbonImmutable::now($huso)->addDays($dias)->setTime($hora, 0)->setTimezone('UTC');
}

/** El mismo día, como `Y-m-d`, que es lo que manda el campo de fecha. */
function fechaDelQueMira(int $dias = 0): string
{
    return CarbonImmutable::now(Clock::zona(auth()->user()?->timezone))->addDays($dias)->format('Y-m-d');
}

/** Mueve las paradas de la carga del escenario a un tramo concreto. */
function tramo(Scenario $s, mixed $desde, mixed $hasta): void
{
    $paradas = DB::table('load_stops')
        ->where('load_id', $s->load->id)
        ->orderBy('sequence')
        ->get(['id']);

    DB::table('load_stops')->where('id', $paradas[0]->id)->update(['window_start' => $desde, 'window_end' => $desde]);
    DB::table('load_stops')->where('id', $paradas[1]->id)->update(['window_start' => $hasta, 'window_end' => $hasta]);
    DB::table('loads')->where('id', $s->load->id)->update([
        'planned_pickup_at' => $desde,
        'planned_delivery_at' => $hasta,
        // Y VIVA. El escenario nace en borrador, y un borrador no está en
        // ninguna pestaña —todavía no es una carga que despachar—, así que sin
        // esto la prueba mediría el filtro de fechas sobre un tablero que ya
        // estaba vacío por otro motivo, y habría pasado en verde por la razón
        // equivocada cuando midiera una ausencia.
        'status' => 'available',
    ]);
}

function idsEnElTablero(array $props): array
{
    return collect($props['loads'])->pluck('id')->all();
}

/* ── El periodo por omisión ─────────────────────────────────────────────── */

it('el tablero viene puesto en hoy', function () {
    signIn($this->scenario, Role::Admin);

    expect(pantalla()['period']['key'])->toBe('today');
});

it('una carga que empieza y acaba hoy sale en hoy', function () {
    signIn($this->scenario, Role::Admin);

    tramo($this->scenario, enElRelojDelQueMira(0, 8), enElRelojDelQueMira(0, 17));

    expect(idsEnElTablero(pantalla()))->toContain((string) $this->scenario->load->id);
});

it('una carga de la semana que viene no sale en hoy, y sí en esta semana', function () {
    signIn($this->scenario, Role::Admin);

    // Ocho días: fuera de hoy y fuera de esta semana la mire quien la mire,
    // sea domingo o sábado.
    tramo($this->scenario, enElRelojDelQueMira(8), enElRelojDelQueMira(9));

    expect(idsEnElTablero(pantalla()))->not->toContain((string) $this->scenario->load->id);
    expect(idsEnElTablero(pantalla('period=this_year')))->toContain((string) $this->scenario->load->id);
});

it('la carga que recogió ayer y entrega mañana sale hoy', function () {
    // El caso que separa «lo de hoy» de «la fecha es hoy». Con el criterio
    // literal esta carga desaparecería del tablero justo los días en que está
    // en la carretera, que son los días en que hace falta verla.
    signIn($this->scenario, Role::Admin);

    tramo($this->scenario, enElRelojDelQueMira(-1), enElRelojDelQueMira(1));

    expect(idsEnElTablero(pantalla()))->toContain((string) $this->scenario->load->id);
});

it('una carga sin citas sale igual el día que se crea', function () {
    signIn($this->scenario, Role::Admin);

    DB::table('load_stops')->where('load_id', $this->scenario->load->id)
        ->update(['window_start' => null, 'window_end' => null]);
    DB::table('loads')->where('id', $this->scenario->load->id)->update([
        'planned_pickup_at' => null,
        'planned_delivery_at' => null,
        'created_at' => enElRelojDelQueMira(0, 10),
        'status' => 'available',
    ]);

    // Sin la segunda mitad del filtro, un alta a medio hacer desaparecía del
    // tablero el mismo día que se creó, que es cuando más falta hace verla.
    expect(idsEnElTablero(pantalla()))->toContain((string) $this->scenario->load->id);
});

/* ── Las cuentas de las pestañas van por el mismo filtro ────────────────── */

it('las cuentas de las pestañas cuentan lo mismo que enseña la lista', function () {
    signIn($this->scenario, Role::Admin);

    tramo($this->scenario, now()->addDays(8), now()->addDays(9));

    $hoy = pantalla();

    // Una pestaña que dice «3» encima de cero tarjetas hace concluir que
    // faltan tres.
    expect(array_sum($hoy['counts']))->toBe(count($hoy['loads']));

    $ancho = pantalla('period=this_year');
    expect(array_sum($ancho['counts']))->toBeGreaterThan(array_sum($hoy['counts']));
});

/* ── El rango a medida ──────────────────────────────────────────────────── */

it('el rango a medida filtra por las dos fechas', function () {
    signIn($this->scenario, Role::Admin);

    tramo($this->scenario, enElRelojDelQueMira(10, 9), enElRelojDelQueMira(10, 18));

    $dentro = fechaDelQueMira(10);
    $fuera = fechaDelQueMira(20);

    expect(idsEnElTablero(pantalla("period=custom&from={$dentro}&to={$dentro}")))
        ->toContain((string) $this->scenario->load->id);
    expect(idsEnElTablero(pantalla("period=custom&from={$fuera}&to={$fuera}")))
        ->not->toContain((string) $this->scenario->load->id);
});

it('el último día del rango entra entero', function () {
    signIn($this->scenario, Role::Admin);

    // Las cinco de la tarde del último día. Con el límite puesto a medianoche
    // esta carga caía fuera del rango que la nombra.
    tramo($this->scenario, enElRelojDelQueMira(10, 17), enElRelojDelQueMira(10, 19));

    $desde = fechaDelQueMira(5);
    $hasta = fechaDelQueMira(10);

    expect(idsEnElTablero(pantalla("period=custom&from={$desde}&to={$hasta}")))
        ->toContain((string) $this->scenario->load->id);
});

it('un rango a medida del revés vuelve a hoy y lo dice', function () {
    signIn($this->scenario, Role::Admin);

    // Y lo DICE: el desplegable tiene que enseñar el periodo que se está
    // usando. Uno que diga «a medida» sobre una lista de hoy es peor que uno
    // que diga «hoy».
    $periodo = pantalla('period=custom&from=2026-03-15&to=2026-03-01')['period'];

    expect($periodo['key'])->toBe('today');
});

it('un periodo que no existe vuelve a hoy', function () {
    signIn($this->scenario, Role::Admin);

    expect(pantalla('period=el-trimestre-que-viene')['period']['key'])->toBe('today');
});

/* ── El filtro de transportista ─────────────────────────────────────────── */

it('el filtro de transportista recorta las cargas', function () {
    signIn($this->scenario, Role::Admin);

    tramo($this->scenario, enElRelojDelQueMira(0, 9), enElRelojDelQueMira(0, 15));

    $id = (string) $this->scenario->load->id;

    expect(idsEnElTablero(pantalla('carrier='.$this->scenario->assignedCarrier->id)))->toContain($id);
    expect(idsEnElTablero(pantalla('carrier='.$this->scenario->otherCarrier->id)))->not->toContain($id);
});

it('el filtro de transportista recorta también los conductores', function () {
    signIn($this->scenario, Role::Admin);

    $conductor = FleetFixtures::conductor($this->scenario, 'Ana', 'Ruiz');

    $suyos = collect(pantalla('carrier='.$this->scenario->assignedCarrier->id)['drivers'])->pluck('id');
    $ajenos = collect(pantalla('carrier='.$this->scenario->otherCarrier->id)['drivers'])->pluck('id');

    expect($suyos)->toContain($conductor);
    expect($ajenos)->not->toContain($conductor);
});

it('un transportista que no se le ofrece se ignora y el filtro queda vacío', function () {
    signIn($this->scenario, Role::Admin);

    // Sin esto, escribir en la barra de direcciones el identificador de un
    // transportista de otra empresa dejaba el tablero vacío con su nombre
    // puesto en el desplegable, y eso ya confirma que existe.
    $props = pantalla('carrier=00000000-0000-4000-8000-000000000000');

    expect($props['carrierFilter']['selected'])->toBeNull();
});

/* ── Lo que el periodo NO recorta ───────────────────────────────────────── */

it('el periodo no esconde a los conductores libres', function () {
    signIn($this->scenario, Role::Admin);

    $conductor = FleetFixtures::conductor($this->scenario, 'Ana', 'Ruiz');

    // La columna contesta «¿a quién se la doy?». Esconder a quien hoy no ha
    // hecho nada la deja sin contestar nada, que es justo lo contrario de lo
    // que se busca al filtrar por hoy.
    expect(collect(pantalla('period=today')['drivers'])->pluck('id'))->toContain($conductor);
});

it('la cronología del conductor sí va por el periodo', function () {
    signIn($this->scenario, Role::Admin);

    $conductor = FleetFixtures::conductor($this->scenario, 'Ana', 'Ruiz');
    $id = (string) $this->scenario->load->id;
    FleetFixtures::enLaCarga($this->scenario, $id, 'driver', $conductor);

    // La asignación se hizo hoy y se retiró hoy: queda dentro de «hoy» y fuera
    // del año pasado.
    DB::table('load_assignments')->where('load_id', $id)->update(['unassigned_at' => now()]);

    $hoy = pantalla('period=today&driver='.$conductor)['selectedDriver']['timeline'];
    $anoPasado = pantalla('period=last_year&driver='.$conductor)['selectedDriver']['timeline'];

    expect($hoy)->not->toBeEmpty();
    expect($anoPasado)->toBeEmpty();
});

it('la asignación que sigue en pie sale aunque se hiciera antes del periodo', function () {
    signIn($this->scenario, Role::Admin);

    $conductor = FleetFixtures::conductor($this->scenario, 'Ana', 'Ruiz');
    $id = (string) $this->scenario->load->id;
    FleetFixtures::enLaCarga($this->scenario, $id, 'driver', $conductor);

    // Asignado hace un mes y todavía con la carga. Preguntar «¿qué hizo hoy?»
    // y que conteste «nada» sería falso: la lleva puesta.
    DB::table('load_assignments')->where('load_id', $id)
        ->update(['created_at' => now()->subMonth(), 'unassigned_at' => null]);

    expect(pantalla('period=today&driver='.$conductor)['selectedDriver']['timeline'])->not->toBeEmpty();
});

/* ── La carga abierta no la cierra el filtro ────────────────────────────── */

it('una carga se abre por su enlace aunque el periodo la deje fuera', function () {
    signIn($this->scenario, Role::Admin);

    tramo($this->scenario, enElRelojDelQueMira(40), enElRelojDelQueMira(41));

    $id = (string) $this->scenario->load->id;

    // El filtro recorta LO QUE SE LISTA, no lo que se puede abrir. Pegar en un
    // mensaje el enlace de una carga de marzo tiene que abrirla aunque el
    // tablero esté puesto en «hoy»; si el filtro cerrara esa puerta, el enlace
    // contestaría «no existe» a alguien que sí puede verla.
    expect(idsEnElTablero(pantalla('period=today')))->not->toContain($id);
    expect(pantalla('period=today&load='.$id)['selectedLoad'])->not->toBeNull();
});
