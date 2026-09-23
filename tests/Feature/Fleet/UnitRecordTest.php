<?php

declare(strict_types=1);

use App\Enums\Role;
use App\Http\Controllers\App\EquipmentController;
use App\Support\Equipment\AxleSpacings;
use App\Support\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
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
 * La ficha de la unidad: propiedad, medidas y ejes.
 *
 * Cuatro cosas que se pidieron juntas porque son la misma ficha:
 *
 *  1. El tipo de equipo de un tractor es de tractor.
 *  2. Se puede decir si es propia, arrendada o con opción a compra.
 *  3. Todas las medidas se dan en pies y pulgadas por separado.
 *  4. Se guardan el número de ejes y la distancia entre cada par.
 *
 * La forma de las pantallas la sujetan `tests/Unit/Suite/MeasureUnitsTest.php`
 * y `EquipmentCategoryTest.php`. Esto mide lo que de verdad queda en la base
 * cuando alguien rellena el formulario, que es lo que ninguna lectura del
 * código puede comprobar.
 */
function unidadNueva(Scenario $s, array $cambios = []): array
{
    return [
        'carrier_id' => $s->assignedCarrier->id,
        'unit_number' => '410',
        'vin' => '3AKJHHDR9LSLP1234',
        'year' => 2024,
        'make' => 'Freightliner',
        'model' => 'Cascadia',
        'status' => 'active',
        ...$cambios,
    ];
}

/** Un tipo de equipo de la categoría que se pida. */
function tipoDeEquipo(Scenario $s, string $categoria, string $codigo, string $en, string $es): string
{
    $id = (string) Str::uuid();

    DB::table('equipment_types')->insert([
        'id' => $id,
        'tenant_id' => $s->tenant->id,
        'code' => $codigo,
        'label_en' => $en,
        'label_es' => $es,
        'category' => $categoria,
        'is_system' => true,
        'supports_rgn' => false,
        'sort_order' => 10,
        'active' => true,
        'created_at' => now(),
        'updated_at' => now(),
    ]);

    return $id;
}

function huecos(string $tipo, string $id): array
{
    return AxleSpacings::de($tipo, $id);
}

/* ── Las medidas ────────────────────────────────────────────────────────── */

it('las medidas llegan en pies y pulgadas y se guardan en una sola cifra', function () {
    signIn($this->scenario, Role::Admin);

    $this->post('/equipment/trucks', unidadNueva($this->scenario, [
        'length_feet' => 25,
        'length_inches' => 6,
        'height_feet' => 13,
        'height_inches' => 2,
        'width_feet' => 8,
        'width_inches' => 6,
    ]))->assertRedirect();

    $fila = DB::table('trucks')->where('unit_number', '410')->first();

    expect((int) $fila->length_inches)->toBe(306);
    expect((int) $fila->height_inches)->toBe(158);
    expect((int) $fila->width_inches)->toBe(102);
});

it('una duodécima pulgada no es una medida', function () {
    // Doce pulgadas son un pie: admitirlas dejaría dos maneras de escribir la
    // misma medida y dos fichas idénticas que no se parecen.
    signIn($this->scenario, Role::Admin);

    $this->post('/equipment/trucks', unidadNueva($this->scenario, [
        'length_feet' => 25,
        'length_inches' => 12,
    ]))->assertSessionHasErrors('length_inches');
});

it('una medida a medias vale, y ninguna deja la columna vacía', function () {
    signIn($this->scenario, Role::Admin);

    $this->post('/equipment/trucks', unidadNueva($this->scenario, [
        'length_feet' => 25,
        'height_inches' => 9,
    ]))->assertRedirect();

    $fila = DB::table('trucks')->where('unit_number', '410')->first();

    // Pies sin pulgadas y pulgadas sin pies: las dos son una medida.
    expect((int) $fila->length_inches)->toBe(300);
    expect((int) $fila->height_inches)->toBe(9);
    // Y ninguna de las dos casillas es cero: eso es no haber medido.
    expect($fila->width_inches)->toBeNull();
});

it('cada medida que el formulario pide tiene su columna', function () {
    // Si `medidasDe()` nombrara una medida sin columna, el dato pasaría la
    // validación y se perdería al guardar, en silencio.
    foreach (['trucks', 'trailers'] as $tabla) {
        foreach (EquipmentController::medidasDe($tabla) as $medida) {
            expect(Schema::hasColumn($tabla, $medida.'_inches'))
                ->toBeTrue("`{$tabla}` no tiene columna para la medida `{$medida}`.");
        }
    }
});

/* ── La propiedad ───────────────────────────────────────────────────────── */

it('una unidad nace propia si no se dice otra cosa', function () {
    signIn($this->scenario, Role::Admin);

    $this->post('/equipment/trucks', unidadNueva($this->scenario))->assertRedirect();

    expect(DB::table('trucks')->where('unit_number', '410')->value('ownership'))->toBe('owned');
});

it('lo arrendado guarda quién lo arrienda y hasta cuándo', function () {
    signIn($this->scenario, Role::Admin);

    $this->post('/equipment/trucks', unidadNueva($this->scenario, [
        'ownership' => 'lease_to_own',
        'lessor_name' => 'Bravo Fleet Leasing, LLC',
        'lease_ends_on' => '2029-04-30',
    ]))->assertRedirect();

    $fila = DB::table('trucks')->where('unit_number', '410')->first();

    expect($fila->ownership)->toBe('lease_to_own');
    expect($fila->lessor_name)->toBe('Bravo Fleet Leasing, LLC');
    expect((string) $fila->lease_ends_on)->toStartWith('2029-04-30');
});

it('pasarla a propia borra el arrendador y el vencimiento', function () {
    // Si no, la ficha diría «Propia» con un arrendador debajo, y quien lo lea
    // después no sabrá cuál de los dos vale.
    signIn($this->scenario, Role::Admin);

    $this->post('/equipment/trucks', unidadNueva($this->scenario, [
        'ownership' => 'leased',
        'lessor_name' => 'Bravo Fleet Leasing, LLC',
        'lease_ends_on' => '2029-04-30',
    ]))->assertRedirect();

    $id = (string) DB::table('trucks')->where('unit_number', '410')->value('id');

    $this->patch("/equipment/trucks/{$id}", unidadNueva($this->scenario, [
        'ownership' => 'owned',
        'lessor_name' => 'Bravo Fleet Leasing, LLC',
        'lease_ends_on' => '2029-04-30',
    ]))->assertRedirect();

    $fila = DB::table('trucks')->where('id', $id)->first();

    expect($fila->ownership)->toBe('owned');
    expect($fila->lessor_name)->toBeNull();
    expect($fila->lease_ends_on)->toBeNull();
});

it('una propiedad inventada no entra', function () {
    signIn($this->scenario, Role::Admin);

    $this->post('/equipment/trucks', unidadNueva($this->scenario, ['ownership' => 'rented']))
        ->assertSessionHasErrors('ownership');
});

/* ── Los ejes ───────────────────────────────────────────────────────────── */

it('con tres ejes se guardan dos distancias', function () {
    signIn($this->scenario, Role::Admin);

    $this->post('/equipment/trucks', unidadNueva($this->scenario, [
        'axle_count' => 3,
        'axle_configuration' => '6x4',
        'axle_spacings' => [
            ['feet' => 19, 'inches' => 4],
            ['feet' => 4, 'inches' => 6],
        ],
    ]))->assertRedirect();

    $id = (string) DB::table('trucks')->where('unit_number', '410')->value('id');

    // En orden, de delante atrás, y en pulgadas.
    expect(huecos(AxleSpacings::CAMION, $id))->toBe([232, 54]);
});

it('tres huecos de cuatro no se guardan', function () {
    // Un conjunto a medias no sirve para calcular nada y parece un dato.
    signIn($this->scenario, Role::Admin);

    $this->post('/equipment/trucks', unidadNueva($this->scenario, [
        'axle_count' => 3,
        'axle_spacings' => [['feet' => 19, 'inches' => 4]],
    ]))->assertSessionHasErrors('axle_spacings');

    expect(DB::table('trucks')->where('unit_number', '410')->exists())->toBeFalse();
});

it('no haber medido ninguna sí se guarda', function () {
    // Las fichas que ya existen tienen ejes y no tienen distancias: la tabla
    // acaba de nacer, y exigirlas dejaría esas fichas sin poder guardarse.
    signIn($this->scenario, Role::Admin);

    $this->post('/equipment/trucks', unidadNueva($this->scenario, [
        'axle_count' => 5,
        'axle_spacings' => [
            ['feet' => null, 'inches' => null],
            ['feet' => null, 'inches' => null],
            ['feet' => null, 'inches' => null],
            ['feet' => null, 'inches' => null],
        ],
    ]))->assertRedirect();

    $id = (string) DB::table('trucks')->where('unit_number', '410')->value('id');

    expect((int) DB::table('trucks')->where('id', $id)->value('axle_count'))->toBe(5);
    expect(huecos(AxleSpacings::CAMION, $id))->toBe([]);
});

it('un hueco de cero pulgadas no es un hueco', function () {
    signIn($this->scenario, Role::Admin);

    $this->post('/equipment/trucks', unidadNueva($this->scenario, [
        'axle_count' => 2,
        'axle_spacings' => [['feet' => 0, 'inches' => 0]],
    ]))->assertSessionHasErrors('axle_spacings.0.inches');
});

it('bajar el número de ejes borra los huecos que sobran', function () {
    signIn($this->scenario, Role::Admin);

    $this->post('/equipment/trucks', unidadNueva($this->scenario, [
        'axle_count' => 4,
        'axle_spacings' => [
            ['feet' => 19, 'inches' => 4],
            ['feet' => 4, 'inches' => 6],
            ['feet' => 4, 'inches' => 6],
        ],
    ]))->assertRedirect();

    $id = (string) DB::table('trucks')->where('unit_number', '410')->value('id');
    expect(huecos(AxleSpacings::CAMION, $id))->toHaveCount(3);

    $this->patch("/equipment/trucks/{$id}", unidadNueva($this->scenario, [
        'axle_count' => 2,
        'axle_spacings' => [['feet' => 15, 'inches' => 0]],
    ]))->assertRedirect();

    // Un hueco número tres de una unidad que ya solo tiene dos ejes no es un
    // dato que se pueda conservar por si acaso.
    expect(huecos(AxleSpacings::CAMION, $id))->toBe([180]);
});

it('las distancias de un remolque son suyas y no las del tractor', function () {
    signIn($this->scenario, Role::Admin);

    $this->post('/equipment/trucks', unidadNueva($this->scenario, [
        'axle_count' => 2,
        'axle_spacings' => [['feet' => 19, 'inches' => 4]],
    ]))->assertRedirect();

    $camion = (string) DB::table('trucks')->where('unit_number', '410')->value('id');

    // Mismo identificador es imposible, pero la consulta filtra por tipo
    // además de por identificador: sin eso, dos tablas con UUID comparten
    // espacio de nombres y un día se cruzan.
    expect(huecos(AxleSpacings::REMOLQUE, $camion))->toBe([]);
});

/* ── La clase de equipo ─────────────────────────────────────────────────── */

it('el alta de un tractor solo ofrece tipos de tractor', function () {
    $camion = tipoDeEquipo($this->scenario, 'truck', 'sleeper', 'Sleeper tractor', 'Tractocamión con dormitorio');
    tipoDeEquipo($this->scenario, 'trailer', 'lowboy', 'Lowboy', 'Cama baja');

    signIn($this->scenario, Role::Admin);

    $this->get('/equipment/trucks/create')
        ->assertOk()
        ->assertInertia(function (Assert $page) use ($camion) {
            $tipos = collect($page->toArray()['props']['choices']['equipmentTypes']);

            expect($tipos->pluck('id')->all())->toBe([$camion]);
        });
});

it('y el de un remolque solo tipos de remolque', function () {
    tipoDeEquipo($this->scenario, 'truck', 'sleeper', 'Sleeper tractor', 'Tractocamión con dormitorio');
    $remolque = tipoDeEquipo($this->scenario, 'trailer', 'lowboy', 'Lowboy', 'Cama baja');

    signIn($this->scenario, Role::Admin);

    $this->get('/equipment/trailers/create')
        ->assertOk()
        ->assertInertia(function (Assert $page) use ($remolque) {
            $tipos = collect($page->toArray()['props']['choices']['equipmentTypes']);

            expect($tipos->pluck('id')->all())->toBe([$remolque]);
        });
});

it('el equipo que una carga requiere es un remolque', function () {
    // Toda carga necesita un tractor: pedir uno como requisito no dice nada, y
    // guarda un requisito que ningún remolque puede cumplir.
    tipoDeEquipo($this->scenario, 'truck', 'sleeper', 'Sleeper tractor', 'Tractocamión con dormitorio');
    $remolque = tipoDeEquipo($this->scenario, 'trailer', 'lowboy', 'Lowboy', 'Cama baja');

    signIn($this->scenario, Role::Admin);

    $this->get('/loads/create')
        ->assertOk()
        ->assertInertia(function (Assert $page) use ($remolque) {
            $tipos = collect($page->toArray()['props']['choices']['equipmentTypes']);

            expect($tipos->pluck('id')->all())->toBe([$remolque]);
        });
});

/* ── Lo que enseña la ficha ─────────────────────────────────────────────── */

it('la ficha lleva la propiedad y las distancias', function () {
    signIn($this->scenario, Role::Admin);

    $this->post('/equipment/trucks', unidadNueva($this->scenario, [
        'ownership' => 'leased',
        'lessor_name' => 'Bravo Fleet Leasing, LLC',
        'lease_ends_on' => '2029-04-30',
        'length_feet' => 25,
        'length_inches' => 6,
        'axle_count' => 3,
        'axle_spacings' => [
            ['feet' => 19, 'inches' => 4],
            ['feet' => 4, 'inches' => 6],
        ],
    ]))->assertRedirect();

    $id = (string) DB::table('trucks')->where('unit_number', '410')->value('id');

    $this->get("/equipment/trucks/{$id}")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->where('unit.ownership', 'leased')
            ->where('unit.lessorName', 'Bravo Fleet Leasing, LLC')
            // Un día, no un instante: la fecha de vencimiento de un contrato
            // no se mueve con el huso horario de quien la mira.
            ->where('unit.leaseEndsOn', '2029-04-30')
            ->where('unit.lengthInches', 306)
            ->where('unit.axleSpacings', [232, 54]));
});
