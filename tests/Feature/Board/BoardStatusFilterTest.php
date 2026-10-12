<?php

declare(strict_types=1);

use App\Enums\Role;
use App\Support\Board\Statuses;
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
 * Filtrar el tablero por estado: el de las cargas y el de los conductores.
 *
 * ## Lo que se mide aquí y no en el guardián
 *
 * El EFECTO. Que la carga desaparece de la lista y de las tres cuentas a la
 * vez, que el conductor dado de baja deja de salir y que la pantalla dice
 * cuántos esconde, y que un enlace a un conductor escondido sigue abriéndolo.
 */
function tableroCon(string $query = ''): array
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

/** Pone la carga del escenario en un estado y dentro del periodo de hoy. */
function enEstado(Scenario $s, string $estado): void
{
    DB::table('loads')->where('id', $s->load->id)->update([
        'status' => $estado,
        'planned_pickup_at' => now(),
        'planned_delivery_at' => now()->addDay(),
    ]);

    DB::table('load_stops')->where('load_id', $s->load->id)->update([
        'window_start' => now(),
        'window_end' => now()->addDay(),
    ]);
}

function idsDelTablero(array $p): array
{
    return collect($p['loads'])->pluck('id')->all();
}

function nombresDeConductor(array $p): array
{
    return collect($p['drivers'])->pluck('lastName')->all();
}

/* ── El filtro por estado de carga ──────────────────────────────────────── */

it('elegir un estado deja fuera las cargas de los demás', function () {
    signIn($this->scenario, Role::Admin);

    enEstado($this->scenario, 'available');
    $id = (string) $this->scenario->load->id;

    expect(idsDelTablero(tableroCon('period=this_year')))->toContain($id);
    expect(idsDelTablero(tableroCon('period=this_year&status=available')))->toContain($id);
    expect(idsDelTablero(tableroCon('period=this_year&status=in_transit')))->not->toContain($id);
});

it('se pueden elegir varios estados a la vez', function () {
    // En despacho se mira «en tránsito» y «en entrega» juntas: son una sola
    // pregunta, y un desplegable de uno solo obliga a mirar dos veces.
    signIn($this->scenario, Role::Admin);

    enEstado($this->scenario, 'in_transit');
    $id = (string) $this->scenario->load->id;

    expect(idsDelTablero(tableroCon('period=this_year&status=at_delivery')))->not->toContain($id);
    expect(idsDelTablero(tableroCon('period=this_year&status=in_transit,at_delivery')))->toContain($id);
});

it('las cuentas de las pestañas se mueven con el filtro', function () {
    // Una pestaña que dice «1» encima de cero tarjetas manda a buscar.
    signIn($this->scenario, Role::Admin);

    enEstado($this->scenario, 'available');

    $conFiltro = tableroCon('period=this_year&status=in_transit')['counts'];

    expect(array_sum($conFiltro))->toBe(0);
    expect(array_sum(tableroCon('period=this_year&status=available')['counts']))->toBeGreaterThan(0);
});

it('las cuentas dicen en qué pestaña está lo que se buscaba', function () {
    // Elegir «entregada» estando en «sin asignar» da cero ahí, y eso es
    // cierto. Lo que lo hace legible es el número de al lado.
    signIn($this->scenario, Role::Admin);

    enEstado($this->scenario, 'delivered');

    $p = tableroCon('period=this_year&status=delivered&tab=unassigned');

    expect($p['counts']['unassigned'])->toBe(0);
    expect($p['counts']['done'])->toBeGreaterThan(0);
    expect($p['loads'])->toBe([]);
});

it('un estado que ninguna pestaña enseña se ignora, y no vacía el tablero', function () {
    /*
    | `?status=cancelled` no es una elección posible: el desplegable no lo
    | ofrece porque las tres pestañas lo dejan fuera. Tomárselo al pie de la
    | letra daría un tablero en blanco con un filtro puesto que nadie ve.
    */
    signIn($this->scenario, Role::Admin);

    enEstado($this->scenario, 'available');
    $id = (string) $this->scenario->load->id;

    expect(idsDelTablero(tableroCon('period=this_year&status=cancelled')))->toContain($id);
    expect(tableroCon('period=this_year&status=cancelled')['loadStatusFilter']['selected'])->toBe([]);
});

it('el mapa dibuja lo mismo que enseña la lista', function () {
    /*
    | Puntos sin tarjeta: se pulsa uno y no hay dónde ir.
    |
    | La primera versión de esta prueba medía la ausencia sin enseñar antes la
    | presencia: la carga no tenía conductor, así que no estaba en «asignadas»
    | y el mapa salía vacío con filtro y sin él. Pasaba en verde con el filtro
    | del mapa quitado.
    */
    signIn($this->scenario, Role::Admin);

    enEstado($this->scenario, 'in_transit');
    FleetFixtures::enLaCarga(
        $this->scenario,
        (string) $this->scenario->load->id,
        'driver',
        FleetFixtures::conductor($this->scenario, 'Olga', 'Narváez'),
    );

    // Una parada sin coordenadas no se dibuja, con filtro o sin él.
    DB::table('load_stops')->where('load_id', $this->scenario->load->id)->update([
        'latitude' => '29.76040',
        'longitude' => '-95.36980',
    ]);

    // Primero la presencia.
    expect(tableroCon('period=this_year')['map']['stops'])->not->toBe([]);

    // Y solo entonces la ausencia.
    expect(tableroCon('period=this_year&status=delivered')['map']['stops'])->toBe([]);
});

it('las opciones que viajan son las que el tablero puede enseñar', function () {
    signIn($this->scenario, Role::Admin);

    $opciones = tableroCon()['loadStatusFilter']['options'];

    expect($opciones)->toBe(Statuses::deCarga());
    expect($opciones)->not->toContain('draft')->not->toContain('cancelled');
});

/* ── El filtro por estado de conductor ──────────────────────────────────── */

it('el dado de baja ya no sale en la columna, y se dice cuántos faltan', function () {
    /*
    | La columna contesta «¿a quién le doy esta carga?» y enseñaba también a
    | quien ya no trabaja ahí. Esconderlo en silencio sería el mismo defecto
    | del revés: un conductor que falta de una lista sin explicación se busca
    | durante un rato.
    */
    signIn($this->scenario, Role::Admin);

    $id = FleetFixtures::conductor($this->scenario, 'Rodrigo', 'Villalba');
    DB::table('drivers')->where('id', $id)->update(['status' => 'terminated']);

    $p = tableroCon();

    expect(nombresDeConductor($p))->not->toContain('Villalba');
    expect($p['driverStatusFilter']['hidden'])->toBe(1);
    expect($p['driverStatusFilter']['isDefault'])->toBeTrue();
});

it('pedirlo expresamente lo trae de vuelta', function () {
    signIn($this->scenario, Role::Admin);

    $id = FleetFixtures::conductor($this->scenario, 'Rodrigo', 'Villalba');
    DB::table('drivers')->where('id', $id)->update(['status' => 'terminated']);

    $p = tableroCon('driverStatus=terminated');

    expect(nombresDeConductor($p))->toContain('Villalba');
    expect($p['driverStatusFilter']['isDefault'])->toBeFalse();
});

it('el disponible sigue saliendo sin tocar nada', function () {
    signIn($this->scenario, Role::Admin);

    FleetFixtures::conductor($this->scenario, 'Inés', 'Carvajal');

    expect(nombresDeConductor(tableroCon()))->toContain('Carvajal');
    expect(tableroCon()['driverStatusFilter']['hidden'])->toBe(0);
});

it('una URL con basura devuelve la columna de siempre, no una vacía', function () {
    signIn($this->scenario, Role::Admin);

    FleetFixtures::conductor($this->scenario, 'Inés', 'Carvajal');

    $p = tableroCon('driverStatus=inventado');

    expect(nombresDeConductor($p))->toContain('Carvajal');
    expect($p['driverStatusFilter']['selected'])->toBe(Statuses::porDefectoDeConductor());
});

it('lo que se esconde se cuenta dentro del transportista elegido', function () {
    // Contar sobre la empresa entera daría un número que no cuadra con nada de
    // lo que se está mirando.
    signIn($this->scenario, Role::Admin);

    $id = FleetFixtures::conductor($this->scenario, 'Rodrigo', 'Villalba');
    DB::table('drivers')->where('id', $id)->update(['status' => 'terminated']);

    $otro = DB::table('carriers')
        ->where('tenant_id', $this->scenario->tenant->id)
        ->where('id', '!=', $this->scenario->assignedCarrier->id)
        ->value('id');

    if ($otro === null) {
        expect(tableroCon()['driverStatusFilter']['hidden'])->toBe(1);

        return;
    }

    // Villalba no es de ese transportista, así que detrás del filtro de ese
    // transportista no hay nadie escondido.
    expect(tableroCon('carrier='.$otro)['driverStatusFilter']['hidden'])->toBe(0);
});

/* ── Lo que el filtro NO decide ─────────────────────────────────────────── */

it('un enlace a un conductor escondido lo abre igual', function () {
    /*
    | Lo mismo que ya hacía la carga que se abre por su enlace: el panel no
    | pasa por el filtro. Si pasara, pegar en un mensaje el enlace de alguien
    | dado de baja abriría el tablero con el panel vacío, y quien lo recibe
    | concluiría que la ficha no existe.
    */
    signIn($this->scenario, Role::Admin);

    $id = FleetFixtures::conductor($this->scenario, 'Rodrigo', 'Villalba');
    DB::table('drivers')->where('id', $id)->update(['status' => 'terminated']);

    $p = tableroCon('driver='.$id);

    expect(nombresDeConductor($p))->not->toContain('Villalba');
    expect($p['selectedDriver'])->not->toBeNull();
    expect($p['selectedDriver']['lastName'])->toBe('Villalba');
});

it('una carga de un estado filtrado se abre igual por su enlace', function () {
    signIn($this->scenario, Role::Admin);

    enEstado($this->scenario, 'available');
    $id = (string) $this->scenario->load->id;

    $p = tableroCon('period=this_year&status=in_transit&load='.$id);

    expect(idsDelTablero($p))->not->toContain($id);
    expect($p['selectedLoad'])->not->toBeNull();
});
