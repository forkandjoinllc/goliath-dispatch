<?php

declare(strict_types=1);

use App\Enums\Role;
use App\Support\Oversize\DefaultRules;
use App\Support\Oversize\Evaluator;
use App\Support\Oversize\Rules;
use App\Support\Routing\StopDerivedRouteProvider;
use App\Support\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Inertia\Testing\AssertableInertia as Assert;
use Tests\Support\Scenario;

uses(DatabaseTransactions::class);

beforeEach(function () {
    app(TenantContext::class)->forget();
    $this->scenario = Scenario::create();
});

afterEach(function () {
    app(TenantContext::class)->forget();
});

/** Pone medidas a la carga y estados a sus paradas. */
function cargaConMedidas(Scenario $scenario, array $medidas = [], array $estados = ['TX', 'TX']): string
{
    $id = (string) $scenario->load->id;

    DB::table('loads')->where('id', $id)->update(array_merge([
        'width_inches' => 102,
        'height_inches' => 162,
        'length_inches' => 636,
        'gross_vehicle_weight_pounds' => 79000,
        'carrier_id' => $scenario->assignedCarrier->id,
        'updated_at' => now(),
    ], $medidas));

    $paradas = DB::table('load_stops')->where('load_id', $id)->orderBy('sequence')->pluck('id')->all();

    foreach ($paradas as $i => $paradaId) {
        DB::table('load_stops')->where('id', $paradaId)->update([
            'customer_location_id' => null,
            'city' => 'Ciudad '.$i,
            'state' => $estados[$i] ?? 'TX',
            'updated_at' => now(),
        ]);
    }

    return $id;
}

/* ── Las reglas ─────────────────────────────────────────────────────────── */

it('siembra los cincuenta y pico estados sin fecha de revisión', function () {
    $creados = app(TenantContext::class)->runAs(
        $this->scenario->tenant->id,
        fn (): int => Rules::install((string) $this->scenario->tenant->id),
    );

    expect($creados)->toBeGreaterThan(50);

    $tx = DB::table('oversize_rules')
        ->where('tenant_id', $this->scenario->tenant->id)
        ->where('state_code', 'TX')
        ->first();

    expect((int) $tx->max_width_inches)->toBe(DefaultRules::ANCHO);
    expect((int) $tx->max_gross_weight_pounds)->toBe(DefaultRules::PESO_BRUTO);
    // NULL a propósito: nadie ha revisado estos números. Ponerle fecha diría
    // que alguien los miró, y es justo la columna que separa un valor sembrado
    // de uno verificado.
    expect($tx->last_reviewed_at)->toBeNull();
    expect((string) $tx->source_note)->toContain('FEDERAL');
});

it('sembrar dos veces no pisa lo que alguien ya revisó', function () {
    app(TenantContext::class)->runAs($this->scenario->tenant->id, function () {
        Rules::install((string) $this->scenario->tenant->id);

        Rules::update((string) $this->scenario->tenant->id, 'TX', ['max_height_inches' => 168], 'Verificado con TxDMV');

        $segunda = Rules::install((string) $this->scenario->tenant->id);
        expect($segunda)->toBe(0);
    });

    $tx = DB::table('oversize_rules')
        ->where('tenant_id', $this->scenario->tenant->id)
        ->where('state_code', 'TX')
        ->first();

    expect((int) $tx->max_height_inches)->toBe(168);
    expect((string) $tx->source_note)->toBe('Verificado con TxDMV');
    // Editar ES revisar.
    expect($tx->last_reviewed_at)->not->toBeNull();
});

/* ── El recorrido ───────────────────────────────────────────────────────── */

it('el proveedor simulado avisa de que no conoce los estados de paso', function () {
    $proveedor = new StopDerivedRouteProvider;

    $resultado = $proveedor->calculate([
        ['sequence' => 0, 'city' => 'Laredo', 'state' => 'TX'],
        ['sequence' => 1, 'city' => 'Chicago', 'state' => 'IL'],
    ]);

    expect(array_column($resultado['states'], 'state'))->toBe(['TX', 'IL']);
    // Es la advertencia más importante de todo el módulo: un Laredo → Chicago
    // cruza estados que esto no ha mirado.
    expect($resultado['warnings'])->toContain(StopDerivedRouteProvider::AVISO_ESTADOS_DE_PASO);
    // Y no se inventa millas.
    expect($resultado['totalMiles'])->toBeNull();
});

it('dos paradas en el mismo estado no son dos tramos', function () {
    $resultado = (new StopDerivedRouteProvider)->calculate([
        ['sequence' => 0, 'city' => 'Laredo', 'state' => 'TX'],
        ['sequence' => 1, 'city' => 'Odessa', 'state' => 'TX'],
    ]);

    expect(array_column($resultado['states'], 'state'))->toBe(['TX']);
    // Un solo estado: no hay recorrido entre estados del que avisar.
    expect($resultado['warnings'])->not->toContain(StopDerivedRouteProvider::AVISO_ESTADOS_DE_PASO);
});

it('una parada sin estado se avisa, no se supone', function () {
    $resultado = (new StopDerivedRouteProvider)->calculate([
        ['sequence' => 0, 'city' => 'Laredo', 'state' => 'TX'],
        ['sequence' => 1, 'city' => null, 'state' => null],
    ]);

    expect($resultado['warnings'])->toContain(StopDerivedRouteProvider::AVISO_ESTADO_SIN_ESCRIBIR);
});

/* ── La evaluación ──────────────────────────────────────────────────────── */

it('una carga dentro de límite sale limpia', function () {
    $id = cargaConMedidas($this->scenario);

    signIn($this->scenario, Role::Admin);
    $this->post("/loads/{$id}/permits/evaluate", ['axle_weight_pounds' => 19000])->assertRedirect();

    $e = DB::table('oversize_evaluations')->where('load_id', $id)->first();

    expect((string) $e->outcome)->toBe(Evaluator::LIMPIO);
    expect((bool) $e->permit_likely_required)->toBeFalse();
    // Y nace pendiente de firma, siempre.
    expect((string) $e->human_validation_status)->toBe(Evaluator::PENDIENTE);
});

it('una carga ancha sale sobredimensionada y con permiso probable', function () {
    $id = cargaConMedidas($this->scenario, ['width_inches' => 150]);

    signIn($this->scenario, Role::Admin);
    $this->post("/loads/{$id}/permits/evaluate", ['axle_weight_pounds' => 19000])->assertRedirect();

    $e = DB::table('oversize_evaluations')->where('load_id', $id)->first();

    expect((string) $e->outcome)->toBe(Evaluator::SOBREDIMENSIONADA);
    expect((bool) $e->permit_likely_required)->toBeTrue();
    // 150 pulgadas pasa del umbral de escolta (144) pero no del de policía (192).
    expect((bool) $e->escort_likely_required)->toBeTrue();
    expect((bool) $e->police_escort_likely_required)->toBeFalse();

    $porEstado = json_decode((string) $e->state_results, true);
    expect($porEstado[0]['exceeds'][0]['dimension'])->toBe('width');
    expect($porEstado[0]['exceeds'][0]['limit'])->toBe(DefaultRules::ANCHO);

    // Y la bandera de la carga se pone al día.
    expect((bool) DB::table('loads')->where('id', $id)->value('is_oversize'))->toBeTrue();
});

it('faltar una medida NO es estar dentro de límite', function () {
    // Una carga sin ancho escrito no es una carga de 102 pulgadas: es una carga
    // que no se sabe. Es el fallo más caro que podría cometer este módulo.
    $id = cargaConMedidas($this->scenario, [
        'width_inches' => null, 'height_inches' => null,
        'length_inches' => null, 'gross_vehicle_weight_pounds' => null,
        'weight_pounds' => null,
    ]);

    signIn($this->scenario, Role::Admin);
    $this->post("/loads/{$id}/permits/evaluate")->assertRedirect();

    $e = DB::table('oversize_evaluations')->where('load_id', $id)->first();

    expect((string) $e->outcome)->toBe(Evaluator::DATOS_INSUFICIENTES);

    $avisos = json_decode((string) $e->missing_data_warnings, true);
    expect($avisos)->toContain(Evaluator::FALTA_ANCHO);
    expect($avisos)->toContain(Evaluator::FALTA_ALTURA);
    expect($avisos)->toContain(Evaluator::FALTA_PESO);
});

it('el aviso de estados de paso llega hasta la evaluación', function () {
    $id = cargaConMedidas($this->scenario, [], ['TX', 'IL']);

    signIn($this->scenario, Role::Admin);
    $this->post("/loads/{$id}/permits/evaluate", ['axle_weight_pounds' => 19000])->assertRedirect();

    $avisos = json_decode(
        (string) DB::table('oversize_evaluations')->where('load_id', $id)->value('missing_data_warnings'),
        true,
    );

    expect($avisos)->toContain(StopDerivedRouteProvider::AVISO_ESTADOS_DE_PASO);
});

it('las medidas se congelan: cambiarlas después no reescribe la evaluación', function () {
    $id = cargaConMedidas($this->scenario, ['width_inches' => 150]);

    signIn($this->scenario, Role::Admin);
    $this->post("/loads/{$id}/permits/evaluate", ['axle_weight_pounds' => 19000])->assertRedirect();

    DB::table('loads')->where('id', $id)->update(['width_inches' => 96]);

    $entradas = json_decode(
        (string) DB::table('oversize_evaluations')->where('load_id', $id)->value('inputs'),
        true,
    );

    expect($entradas['widthInches'])->toBe(150);
});

it('el peso por eje se teclea en la evaluación y no se guarda en la carga', function () {
    $id = cargaConMedidas($this->scenario);

    signIn($this->scenario, Role::Admin);
    $this->post("/loads/{$id}/permits/evaluate", ['axle_weight_pounds' => 26000])->assertRedirect();

    $e = DB::table('oversize_evaluations')->where('load_id', $id)->first();

    expect((string) $e->outcome)->toBe(Evaluator::SOBREPESO);

    $entradas = json_decode((string) $e->inputs, true);
    expect($entradas['axleWeightPounds'])->toBe(26000);

    // La carga no tiene columna para esto y no se le inventa ninguna.
    expect(Schema::hasColumn('loads', 'axle_weight_pounds'))->toBeFalse();
});

/* ── La firma humana ────────────────────────────────────────────────────── */

it('validar enciende la columna de la carga; rechazar la apaga', function () {
    $id = cargaConMedidas($this->scenario, ['width_inches' => 150]);

    signIn($this->scenario, Role::Admin);
    $this->post("/loads/{$id}/permits/evaluate", ['axle_weight_pounds' => 19000])->assertRedirect();

    $this->post("/loads/{$id}/permits/validate", ['status' => 'validated'])->assertRedirect();

    $carga = DB::table('loads')->where('id', $id)->first();
    expect($carga->oversize_validated_at)->not->toBeNull();
    expect($carga->oversize_validated_by_user_id)->not->toBeNull();

    $this->post("/loads/{$id}/permits/validate", [
        'status' => 'rejected',
        'reason' => 'x',
        'notes' => 'Las medidas no cuadran con el plano',
    ])->assertRedirect();

    $carga = DB::table('loads')->where('id', $id)->first();
    // Una carga cuya evaluación se rechazó NO está validada.
    expect($carga->oversize_validated_at)->toBeNull();
});

it('rechazar sin notas no pasa', function () {
    $id = cargaConMedidas($this->scenario);

    signIn($this->scenario, Role::Admin);
    $this->post("/loads/{$id}/permits/evaluate")->assertRedirect();

    $this->post("/loads/{$id}/permits/validate", ['status' => 'rejected'])
        ->assertSessionHasErrors('notes');
});

/* ── La compuerta ───────────────────────────────────────────────────────── */

it('no se aprueba lo que nadie ha firmado', function () {
    $id = cargaConMedidas($this->scenario, ['width_inches' => 150]);

    signIn($this->scenario, Role::Admin);
    $this->post("/loads/{$id}/permits/evaluate", ['axle_weight_pounds' => 19000])->assertRedirect();

    // Evaluada pero sin firmar.
    $this->post("/loads/{$id}/permits/ready")->assertRedirect();

    expect(DB::table('loads')->where('id', $id)->value('permit_ready_approved_at'))->toBeNull();
});

it('un permiso sin tramitar bloquea la compuerta', function () {
    $id = cargaConMedidas($this->scenario, ['width_inches' => 150]);

    signIn($this->scenario, Role::Admin);
    $this->post("/loads/{$id}/permits/evaluate", ['axle_weight_pounds' => 19000])->assertRedirect();
    $this->post("/loads/{$id}/permits/validate", ['status' => 'validated'])->assertRedirect();

    $this->post("/loads/{$id}/permits/items", ['state_code' => 'TX', 'status' => 'pending'])->assertRedirect();

    $this->post("/loads/{$id}/permits/ready")->assertRedirect();
    expect(DB::table('loads')->where('id', $id)->value('permit_ready_approved_at'))->toBeNull();

    // Emitido, sigue sin pasar: falta el PAPEL.
    //
    // Hasta el lote 67 aquí bastaba con marcarlo emitido, y esa era justo la
    // mentira: la casilla decía que estaba y el conductor salía sin el permiso
    // que le piden en una báscula.
    $permisoId = DB::table('permits')->where('load_id', $id)->value('id');
    $this->post("/loads/{$id}/permits/items/{$permisoId}", ['status' => 'issued'])->assertRedirect();

    $this->post("/loads/{$id}/permits/ready")->assertRedirect();
    expect(DB::table('loads')->where('id', $id)->value('permit_ready_approved_at'))->toBeNull();

    // Con el papel adjunto, ya pasa.
    $this->post("/loads/{$id}/papers/permit/{$permisoId}", [
        'file' => \Illuminate\Http\UploadedFile::fake()->create('permiso.pdf', 60, 'application/pdf'),
    ])->assertSessionHasNoErrors();

    $this->post("/loads/{$id}/permits/ready")->assertRedirect();
    expect(DB::table('loads')->where('id', $id)->value('permit_ready_approved_at'))->not->toBeNull();
});

it('añadir un permiso pendiente reabre una compuerta ya aprobada', function () {
    // Si no lo hiciera, una carga aprobada el lunes seguiría aprobada el martes
    // con un permiso nuevo sin tramitar dentro.
    $id = cargaConMedidas($this->scenario, ['width_inches' => 150]);

    signIn($this->scenario, Role::Admin);
    $this->post("/loads/{$id}/permits/evaluate", ['axle_weight_pounds' => 19000])->assertRedirect();
    $this->post("/loads/{$id}/permits/validate", ['status' => 'validated'])->assertRedirect();
    $this->post("/loads/{$id}/permits/ready")->assertRedirect();

    expect(DB::table('loads')->where('id', $id)->value('permit_ready_approved_at'))->not->toBeNull();

    $this->post("/loads/{$id}/permits/items", ['state_code' => 'NM', 'status' => 'pending'])->assertRedirect();

    expect(DB::table('loads')->where('id', $id)->value('permit_ready_approved_at'))->toBeNull();
});

/* ── Permisos y escoltas ────────────────────────────────────────────────── */

it('guarda un permiso y una escolta', function () {
    $id = cargaConMedidas($this->scenario);

    signIn($this->scenario, Role::Admin);

    $this->post("/loads/{$id}/permits/items", [
        'state_code' => 'tx',
        'permit_number' => 'TX-99',
        'status' => 'issued',
        'cost_cents' => 12500,
    ])->assertRedirect();

    $p = DB::table('permits')->where('load_id', $id)->first();
    // El código se guarda en mayúsculas venga como venga.
    expect((string) $p->state_code)->toBe('TX');
    expect((int) $p->cost_cents)->toBe(12500);

    $this->post("/loads/{$id}/escorts", [
        'escort_type' => 'pilot_car',
        'provider_name' => 'Escoltas del Norte',
        'status' => 'confirmed',
    ])->assertRedirect();

    expect(DB::table('escorts')->where('load_id', $id)->count())->toBe(1);
});

it('un código de estado inventado no entra', function () {
    $id = cargaConMedidas($this->scenario);

    signIn($this->scenario, Role::Admin);
    $this->post("/loads/{$id}/permits/items", ['state_code' => 'ZZ', 'status' => 'pending'])->assertRedirect();

    expect(DB::table('permits')->where('load_id', $id)->count())->toBe(0);
});

/* ── Quién puede qué ────────────────────────────────────────────────────── */

it('el conductor no puede evaluar ni tramitar', function () {
    $id = cargaConMedidas($this->scenario);

    signIn($this->scenario, Role::Driver);

    $this->post("/loads/{$id}/permits/evaluate")->assertRedirect();
    expect(DB::table('oversize_evaluations')->where('load_id', $id)->count())->toBe(0);

    $this->post("/loads/{$id}/permits/items", ['state_code' => 'TX', 'status' => 'pending'])->assertRedirect();
    expect(DB::table('permits')->where('load_id', $id)->count())->toBe(0);
});

it('no se ven los permisos de una carga de otra empresa', function () {
    $otra = Scenario::create();
    app(TenantContext::class)->forget();
    $ajena = (string) $otra->load->id;

    signIn($this->scenario, Role::Admin);

    $this->get("/loads/{$ajena}/permits")->assertNotFound();
});

/* ── Lo que la pantalla tiene que contar ────────────────────────────────── */

it('el índice solo trae las cargas marcadas', function () {
    $id = cargaConMedidas($this->scenario, ['width_inches' => 150]);

    signIn($this->scenario, Role::Admin);
    $this->post("/loads/{$id}/permits/evaluate", ['axle_weight_pounds' => 19000])->assertRedirect();

    $this->get('/permits')->assertOk()->assertInertia(function (Assert $p) use ($id) {
        $ids = collect($p->toArray()['props']['loads'])->pluck('id')->all();
        expect($ids)->toContain($id);
    });
});

it('la pantalla se renderiza con el aviso de que esto orienta, no determina', function () {
    // Es el texto que no puede faltar: la evaluación compara cinco números y le
    // faltan los estados de paso, los horarios y los puentes.
    $id = cargaConMedidas($this->scenario);

    signIn($this->scenario, Role::Admin);
    $cuerpo = $this->get("/loads/{$id}/permits")->assertOk()->getContent();

    // La sesión de pruebas va en inglés, así que se comprueba el texto inglés.
    // Lo que importa es que el aviso ESTÁ, no en qué idioma.
    expect($cuerpo)->toContain('not a legal determination');
    // Y que no queda ninguna clave sin traducir a la vista.
    expect($cuerpo)->not->toContain('oversize.disclaimer');
    expect($cuerpo)->not->toContain('oversize.evaluation.');
});
