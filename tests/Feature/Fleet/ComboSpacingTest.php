<?php

declare(strict_types=1);

use App\Enums\Role;
use App\Support\Equipment\AxleSpacings;
use App\Support\Equipment\ComboSpacing;
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
    $this->scenario->approveCarrierDocuments();
});

afterEach(fn () => app(TenantContext::class)->forget());

/**
 * Lo que mide un camión CON un remolque.
 *
 * Lo que aquí se prueba es lo que la pantalla PROMETE: que la distancia del
 * primer eje al último aparece cuando están las tres piezas, y que cuando
 * falta una lo dice en vez de enseñar una suma corta.
 */
function unidadMedida(Scenario $s, string $tabla, string $unidad, int $ejes, array $huecos): string
{
    $id = $tabla === 'trucks'
        ? FleetFixtures::camion($s, $unidad)
        : FleetFixtures::remolque($s, $unidad);

    DB::table($tabla)->where('id', $id)->update(['axle_count' => $ejes]);

    AxleSpacings::guardar(
        (string) $s->tenant->id,
        $tabla === 'trucks' ? AxleSpacings::CAMION : AxleSpacings::REMOLQUE,
        $id,
        $huecos,
    );

    return $id;
}

/** Un conjunto de tres ejes de tractor y cinco de remolque, sin medir. */
function parejaSinMedir(Scenario $s, string $sufijo = ''): array
{
    return [
        unidadMedida($s, 'trucks', 'CT'.$sufijo, 3, [232, 54]),
        unidadMedida($s, 'trailers', 'CR'.$sufijo, 5, [61, 61, 61, 61]),
    ];
}

/* ── La cadena entera ───────────────────────────────────────────────────── */

it('con el enganche medido la pantalla da la distancia del primer eje al último', function () {
    signIn($this->scenario, Role::Admin);

    [$camion, $remolque] = parejaSinMedir($this->scenario);

    $this->post('/equipment/combos', [
        'truck_id' => $camion,
        'trailer_id' => $remolque,
        'drive_to_trailer' => ['feet' => 35, 'inches' => 6],
    ])->assertRedirect();

    // 232 + 54 + 426 + 61 × 4 = 956 pulgadas.
    $this->get('/equipment/combos')->assertInertia(
        fn (Assert $page) => $page
            ->component('App/Equipment/Combos')
            ->where('combos.0.driveToTrailerInches', 426)
            ->where('combos.0.overallInches', 956)
            ->where('combos.0.axles', 8)
            ->where('combos.0.chain', [232, 54, 426, 61, 61, 61, 61]),
    );
});

it('sin el enganche la pareja sale sin total y marcada como pendiente', function () {
    // El estado normal de una flota el día que instala esto. La pareja tiene
    // que salir —es la que hay que medir— y no puede traer una suma corta.
    signIn($this->scenario, Role::Admin);

    [$camion, $remolque] = parejaSinMedir($this->scenario);
    $conductor = FleetFixtures::conductor($this->scenario, 'Noé', 'Arriaga');

    StandingAssignment::crear(
        (string) $this->scenario->tenant->id,
        $conductor,
        $camion,
        $remolque,
        now()->subDays(10)->toDateString(),
    );

    $this->get('/equipment/combos')->assertInertia(
        fn (Assert $page) => $page
            ->where('combos.0.driveToTrailerInches', null)
            ->where('combos.0.overallInches', null)
            ->where('combos.0.chain', null)
            ->where('combos.0.driver', 'Noé Arriaga'),
    );
});

it('si a una de las dos fichas le faltan sus huecos no hay total', function () {
    // El enganche está tomado y aun así no hay cadena: al remolque le faltan
    // dos de sus cuatro distancias. Media cadena no es media respuesta.
    signIn($this->scenario, Role::Admin);

    $camion = unidadMedida($this->scenario, 'trucks', 'CT-2', 3, [232, 54]);
    $remolque = unidadMedida($this->scenario, 'trailers', 'CR-2', 5, [61, 61]);

    $this->post('/equipment/combos', [
        'truck_id' => $camion,
        'trailer_id' => $remolque,
        'drive_to_trailer' => ['feet' => 35, 'inches' => 6],
    ])->assertRedirect();

    $this->get('/equipment/combos')->assertInertia(
        fn (Assert $page) => $page
            ->where('combos.0.driveToTrailerInches', 426)
            ->where('combos.0.overallInches', null)
            ->where('combos.0.chain', null),
    );
});

/* ── Lo que no se guarda ────────────────────────────────────────────────── */

it('sin el enganche no se guarda nada, ni siquiera las medidas del margen', function () {
    signIn($this->scenario, Role::Admin);

    [$camion, $remolque] = parejaSinMedir($this->scenario);

    $this->from('/equipment/combos')->post('/equipment/combos', [
        'truck_id' => $camion,
        'trailer_id' => $remolque,
        'drive_to_trailer' => ['feet' => null, 'inches' => null],
        'bumper_to_bumper' => ['feet' => 68, 'inches' => 5],
        'kingpin' => ['feet' => 44, 'inches' => 5],
    ])->assertSessionHasErrors('drive_to_trailer.inches');

    expect(ComboSpacing::de((string) $this->scenario->tenant->id, $camion, $remolque))->toBeNull();
});

it('un cero no es una casilla en blanco', function () {
    signIn($this->scenario, Role::Admin);

    [$camion, $remolque] = parejaSinMedir($this->scenario);

    $this->from('/equipment/combos')->post('/equipment/combos', [
        'truck_id' => $camion,
        'trailer_id' => $remolque,
        'drive_to_trailer' => ['feet' => 35, 'inches' => 6],
        'kingpin_to_rear' => ['feet' => 0, 'inches' => 0],
    ])->assertSessionHasErrors('kingpin_to_rear.inches');
});

it('un remolque de otra empresa no se puede emparejar', function () {
    signIn($this->scenario, Role::Admin);

    [$camion] = parejaSinMedir($this->scenario);

    $otro = Scenario::create();
    $ajeno = FleetFixtures::remolque($otro, 'AJENO');
    app(TenantContext::class)->forget();
    signIn($this->scenario, Role::Admin);

    $this->from('/equipment/combos')->post('/equipment/combos', [
        'truck_id' => $camion,
        'trailer_id' => $ajeno,
        'drive_to_trailer' => ['feet' => 35, 'inches' => 6],
    ])->assertSessionHasErrors('trailer_id');
});

/* ── Volver a medir y dejar de medir ────────────────────────────────────── */

it('volver a medir la misma pareja cambia la medida y no crea otra', function () {
    signIn($this->scenario, Role::Admin);

    [$camion, $remolque] = parejaSinMedir($this->scenario);

    foreach ([[35, 6], [43, 3]] as [$pies, $pulgadas]) {
        $this->post('/equipment/combos', [
            'truck_id' => $camion,
            'trailer_id' => $remolque,
            'drive_to_trailer' => ['feet' => $pies, 'inches' => $pulgadas],
        ])->assertRedirect();
    }

    $vivas = DB::table('equipment_combo_spacings')
        ->where('truck_id', $camion)->where('trailer_id', $remolque)
        ->whereNull('deleted_at')->count();

    expect($vivas)->toBe(1);
    expect(ComboSpacing::de((string) $this->scenario->tenant->id, $camion, $remolque)['driveToTrailerInches'])
        ->toBe(519);
});

it('quitar la medida conserva la fila y deja la pareja pendiente', function () {
    signIn($this->scenario, Role::Admin);

    [$camion, $remolque] = parejaSinMedir($this->scenario);
    $conductor = FleetFixtures::conductor($this->scenario, 'Rita', 'Okonkwo');

    StandingAssignment::crear(
        (string) $this->scenario->tenant->id,
        $conductor,
        $camion,
        $remolque,
        now()->subDays(5)->toDateString(),
    );

    $this->post('/equipment/combos', [
        'truck_id' => $camion,
        'trailer_id' => $remolque,
        'drive_to_trailer' => ['feet' => 35, 'inches' => 6],
    ])->assertRedirect();

    $this->delete("/equipment/combos/{$camion}/{$remolque}")->assertRedirect();

    // La medida ya no cuenta…
    expect(ComboSpacing::de((string) $this->scenario->tenant->id, $camion, $remolque))->toBeNull();

    // …y la fila sigue ahí, porque explica con qué cifra se pidió un permiso.
    expect(DB::table('equipment_combo_spacings')
        ->where('truck_id', $camion)->whereNotNull('deleted_at')->count())->toBe(1);

    // Y la pareja sigue en la lista: alguien la conduce, y sigue sin medir.
    $this->get('/equipment/combos')->assertInertia(
        fn (Assert $page) => $page->where('combos.0.driveToTrailerInches', null),
    );
});

it('volver a medir después de quitarla no choca con la fila retirada', function () {
    // La unicidad vive en una columna generada que solo cuenta las vivas. Si
    // contara todas, una pareja medida, retirada y vuelta a medir daría un
    // error de clave duplicada que nadie entendería.
    signIn($this->scenario, Role::Admin);

    [$camion, $remolque] = parejaSinMedir($this->scenario);

    $medir = fn (int $pies) => $this->post('/equipment/combos', [
        'truck_id' => $camion,
        'trailer_id' => $remolque,
        'drive_to_trailer' => ['feet' => $pies, 'inches' => 0],
    ]);

    $medir(35)->assertRedirect();
    $this->delete("/equipment/combos/{$camion}/{$remolque}")->assertRedirect();
    $medir(40)->assertRedirect();

    expect(ComboSpacing::de((string) $this->scenario->tenant->id, $camion, $remolque)['driveToTrailerInches'])
        ->toBe(480);
});

/* ── Que el conjunto quepa dentro de sí mismo ───────────────────────────── */

it('un parachoques más corto que la cadena de ejes se rechaza', function () {
    // Es lo que se sembró la primera vez: cifras de una hoja real pegadas a
    // otro conjunto. La pantalla enseñó un camión más corto que su propia
    // distancia entre ejes y no dijo nada.
    signIn($this->scenario, Role::Admin);

    [$camion, $remolque] = parejaSinMedir($this->scenario);

    // La cadena mide 232 + 54 + 426 + 61 × 4 = 956 pulgadas.
    $this->from('/equipment/combos')->post('/equipment/combos', [
        'truck_id' => $camion,
        'trailer_id' => $remolque,
        'drive_to_trailer' => ['feet' => 35, 'inches' => 6],
        'bumper_to_bumper' => ['feet' => 68, 'inches' => 5],
    ])->assertSessionHasErrors('bumper_to_bumper.inches');

    expect(ComboSpacing::de((string) $this->scenario->tenant->id, $camion, $remolque))->toBeNull();
});

it('sin cadena no se exige coherencia: se guarda lo que hay', function () {
    // Al remolque le faltan dos huecos, así que no hay contra qué comparar.
    // Negarse por no poder comprobar dejaría sin guardar la única medida que
    // alguien tiene tomada.
    signIn($this->scenario, Role::Admin);

    $camion = unidadMedida($this->scenario, 'trucks', 'CT-9', 3, [232, 54]);
    $remolque = unidadMedida($this->scenario, 'trailers', 'CR-9', 5, [61, 61]);

    $this->post('/equipment/combos', [
        'truck_id' => $camion,
        'trailer_id' => $remolque,
        'drive_to_trailer' => ['feet' => 35, 'inches' => 6],
        'bumper_to_bumper' => ['feet' => 20, 'inches' => 0],
    ])->assertSessionHasNoErrors();

    expect(ComboSpacing::de((string) $this->scenario->tenant->id, $camion, $remolque)['bumperToBumperInches'])
        ->toBe(240);
});

it('los ejes del remolque no pueden quedar por detrás de su final', function () {
    signIn($this->scenario, Role::Admin);

    [$camion, $remolque] = parejaSinMedir($this->scenario);

    $this->from('/equipment/combos')->post('/equipment/combos', [
        'truck_id' => $camion,
        'trailer_id' => $remolque,
        'drive_to_trailer' => ['feet' => 35, 'inches' => 6],
        'kingpin_to_rear' => ['feet' => 42, 'inches' => 4],
        'kingpin_to_trailer_axles' => ['feet' => 50, 'inches' => 0],
    ])->assertSessionHasErrors('kingpin_to_trailer_axles.inches');
});
