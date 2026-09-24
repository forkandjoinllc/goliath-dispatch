<?php

declare(strict_types=1);

use App\Enums\Role;
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
 * Parar a un conductor, darle de baja, y elegir su equipo al darle de alta.
 *
 * Lo que aquí se mide es lo que pasa ADEMÁS de cambiar una palabra: que se le
 * retira de las cargas en curso, que la baja suelta su camión, que la nota no
 * es opcional, y que la decisión de recontratación se toma en el momento.
 */
function conductorNuevo(Scenario $s, array $extra = []): array
{
    return [
        'first_name' => 'Ignacio',
        'last_name' => 'Beltrán',
        'license_number' => 'TX-'.random_int(1000000, 9999999),
        'license_state' => 'TX',
        'cdl_class' => 'A',
        'license_expires_at' => now()->addYears(3)->toDateString(),
        'medical_card_expires_at' => now()->addYear()->toDateString(),
        'status' => 'available',
        'carrier_ids' => [$s->assignedCarrier->id],
        ...$extra,
    ];
}

/* ── El equipo, al dar de alta ──────────────────────────────────────────── */

it('el alta de un conductor le deja elegir camión y remolque', function () {
    signIn($this->scenario, Role::Admin);

    $camion = FleetFixtures::camion($this->scenario, 'T-900');
    $remolque = FleetFixtures::remolque($this->scenario, 'R-900');

    $this->post('/drivers', conductorNuevo($this->scenario, [
        'truck_id' => $camion,
        'trailer_id' => $remolque,
    ]))->assertRedirect();

    $conductor = (string) DB::table('drivers')->where('last_name', 'Beltrán')->value('id');
    $fija = StandingAssignment::deConductor((string) $this->scenario->tenant->id, $conductor);

    expect($fija)->not->toBeNull();
    expect($fija['truckId'])->toBe($camion);
    expect($fija['trailerId'])->toBe($remolque);
});

it('solo se ofrecen los camiones que no lleva ya otro conductor', function () {
    // Ofrecer algo que la regla va a rechazar al guardar es hacer perder el
    // viaje. Y se dice cuántos hay escondidos: un camión que falta de la lista
    // sin explicación se busca durante un rato.
    signIn($this->scenario, Role::Admin);

    $libre = FleetFixtures::camion($this->scenario, 'T-900');
    $ocupado = FleetFixtures::camion($this->scenario, 'T-901');
    $otro = FleetFixtures::conductor($this->scenario, 'Ana', 'Ruiz');

    $this->post("/drivers/{$otro}/equipment", [
        'truck_id' => $ocupado,
        'starts_on' => now()->subDay()->toDateString(),
    ])->assertRedirect();

    $this->get('/drivers/create')
        ->assertOk()
        ->assertInertia(function (Assert $page) use ($libre, $ocupado) {
            $equipo = $page->toArray()['props']['equipment'];
            $ids = collect($equipo['trucks'])->pluck('id');

            expect($ids)->toContain($libre);
            expect($ids)->not->toContain($ocupado);
            expect($equipo['takenTrucks'])->toBe(1);

            // Y cada unidad dice de qué transportista es, para que la pantalla
            // ofrezca las del que se acaba de marcar.
            expect($equipo['trucks'][0])->toHaveKey('carrierId');
        });
});

it('un camión que otro ya lleva no se cuela por el alta', function () {
    // El alta usa el MISMO `StandingAssignment` que la ficha: si no, sería la
    // puerta de atrás de una regla que no tiene red debajo en la base.
    signIn($this->scenario, Role::Admin);

    $camion = FleetFixtures::camion($this->scenario, 'T-900');
    $otro = FleetFixtures::conductor($this->scenario, 'Ana', 'Ruiz');

    $this->post("/drivers/{$otro}/equipment", [
        'truck_id' => $camion,
        'starts_on' => now()->subDay()->toDateString(),
    ])->assertRedirect();

    $this->post('/drivers', conductorNuevo($this->scenario, ['truck_id' => $camion]))
        ->assertRedirect();

    $nuevo = (string) DB::table('drivers')->where('last_name', 'Beltrán')->value('id');

    // El conductor SÍ se dio de alta —eso era correcto— y el equipo no se puso.
    expect($nuevo)->not->toBe('');
    expect(StandingAssignment::deConductor((string) $this->scenario->tenant->id, $nuevo))->toBeNull();
    expect(session('warning'))->not->toBeNull();
});

/* ── En espera y de baja ────────────────────────────────────────────────── */

it('poner en espera exige una nota', function () {
    signIn($this->scenario, Role::Admin);

    $conductor = FleetFixtures::conductor($this->scenario, 'Ana', 'Ruiz');

    $this->post("/drivers/{$conductor}/employment", ['status' => 'on_hold', 'note' => ''])
        ->assertSessionHasErrors('note');

    // Y una de dos letras tampoco es un motivo. «ok» pasa la regla de campo
    // obligatorio y no explica nada a quien lo lea dentro de un año.
    $this->post("/drivers/{$conductor}/employment", ['status' => 'on_hold', 'note' => 'ok'])
        ->assertSessionHasErrors('note');

    expect(DB::table('drivers')->where('id', $conductor)->value('status'))->toBe('available');
});

it('la baja exige además decir si se le volvería a contratar', function () {
    // Quien firma la baja es quien lo sabe. Preguntarlo dos años después es
    // preguntárselo a alguien que no estaba.
    signIn($this->scenario, Role::Admin);

    $conductor = FleetFixtures::conductor($this->scenario, 'Ana', 'Ruiz');

    $this->post("/drivers/{$conductor}/employment", [
        'status' => 'terminated',
        'note' => 'Abandonó el camión en ruta.',
    ])->assertSessionHasErrors('rehire_eligible');

    expect(DB::table('drivers')->where('id', $conductor)->value('status'))->toBe('available');
});

it('con las dos cosas, la baja queda escrita con su decisión', function () {
    signIn($this->scenario, Role::Admin);

    $conductor = FleetFixtures::conductor($this->scenario, 'Ana', 'Ruiz');

    $this->post("/drivers/{$conductor}/employment", [
        'status' => 'terminated',
        'note' => 'Abandonó el camión en ruta.',
        'rehire_eligible' => '0',
    ])->assertRedirect();

    $fila = DB::table('drivers')->where('id', $conductor)->first();

    expect($fila->status)->toBe('terminated');
    expect((bool) $fila->rehire_eligible)->toBeFalse();
    expect($fila->status_note)->toBe('Abandonó el camión en ruta.');
    expect($fila->status_changed_at)->not->toBeNull();
});

it('la baja suelta su equipo para que se lo pueda quedar otro', function () {
    // Un camión atado a alguien que ya no trabaja aquí no se le puede dar a
    // nadie: la regla de «un camión, un conductor» lo impide, y la flota se
    // queda con un camión fantasma.
    signIn($this->scenario, Role::Admin);

    $camion = FleetFixtures::camion($this->scenario, 'T-900');
    $conductor = FleetFixtures::conductor($this->scenario, 'Ana', 'Ruiz');
    $relevo = FleetFixtures::conductor($this->scenario, 'Luis', 'Paz');

    $this->post("/drivers/{$conductor}/equipment", [
        'truck_id' => $camion,
        'starts_on' => now()->subDay()->toDateString(),
    ])->assertRedirect();

    $this->post("/drivers/{$conductor}/employment", [
        'status' => 'terminated',
        'note' => 'Se acabó el contrato.',
        'rehire_eligible' => '1',
    ])->assertRedirect();

    // Terminada, no borrada: una carga de marzo se mira con el camión que se
    // llevó en marzo.
    expect(DB::table('driver_equipment_assignments')->where('driver_id', $conductor)->count())->toBe(1);
    expect(StandingAssignment::conductorDeCamion((string) $this->scenario->tenant->id, $camion))->toBeNull();

    $this->post("/drivers/{$relevo}/equipment", [
        'truck_id' => $camion,
        'starts_on' => now()->toDateString(),
    ])->assertRedirect();

    expect(StandingAssignment::conductorDeCamion((string) $this->scenario->tenant->id, $camion))->toBe($relevo);
});

it('en espera NO suelta el equipo, porque es temporal', function () {
    signIn($this->scenario, Role::Admin);

    $camion = FleetFixtures::camion($this->scenario, 'T-900');
    $conductor = FleetFixtures::conductor($this->scenario, 'Ana', 'Ruiz');

    $this->post("/drivers/{$conductor}/equipment", [
        'truck_id' => $camion,
        'starts_on' => now()->subDay()->toDateString(),
    ])->assertRedirect();

    $this->post("/drivers/{$conductor}/employment", [
        'status' => 'on_hold',
        'note' => 'Pendiente del resultado de la prueba.',
    ])->assertRedirect();

    expect(StandingAssignment::conductorDeCamion((string) $this->scenario->tenant->id, $camion))
        ->toBe($conductor);
});

it('se le retira de las cargas en curso, no de las entregadas', function () {
    // Sin esto, la carga seguiría diciendo que tiene conductor mientras el
    // conductor no puede salir. De las entregadas no se le quita: eso
    // reescribiría el historial de quién las llevó.
    signIn($this->scenario, Role::Admin);

    $conductor = FleetFixtures::conductor($this->scenario, 'Ana', 'Ruiz');
    $enCurso = (string) $this->scenario->load->id;
    $entregada = (string) $this->scenario->otherLoad->id;

    DB::table('loads')->where('id', $enCurso)->update(['status' => 'in_transit']);
    DB::table('loads')->where('id', $entregada)->update(['status' => 'delivered']);

    FleetFixtures::enLaCarga($this->scenario, $enCurso, 'driver', $conductor);
    FleetFixtures::enLaCarga($this->scenario, $entregada, 'driver', $conductor);

    $this->post("/drivers/{$conductor}/employment", [
        'status' => 'on_hold',
        'note' => 'Pendiente del resultado de la prueba.',
    ])->assertRedirect();

    expect(FleetFixtures::puestoEn($enCurso, 'driver'))->toBeNull();
    expect(FleetFixtures::puestoEn($entregada, 'driver'))->toBe($conductor);
});

it('un conductor en espera o de baja no se puede poner en una carga', function () {
    signIn($this->scenario, Role::Admin);

    foreach ([['on_hold', []], ['terminated', ['rehire_eligible' => '1']]] as [$estado, $extra]) {
        $conductor = FleetFixtures::conductor($this->scenario, 'Ana', 'Ruiz'.$estado);

        $this->post("/drivers/{$conductor}/employment", [
            'status' => $estado,
            'note' => 'Motivo suficiente para dejarlo escrito.',
            ...$extra,
        ])->assertRedirect();

        $this->post('/loads/'.$this->scenario->load->id.'/resources', [
            'resource_type' => 'driver',
            'resource_id' => $conductor,
        ])->assertSessionHasErrors('resource_id');
    }
});

it('volver a activarlo borra la decisión de recontratación', function () {
    // Un «no volver a contratar» colgando de alguien que está trabajando aquí
    // es una contradicción que alguien leerá como dato.
    signIn($this->scenario, Role::Admin);

    $conductor = FleetFixtures::conductor($this->scenario, 'Ana', 'Ruiz');

    $this->post("/drivers/{$conductor}/employment", [
        'status' => 'terminated',
        'note' => 'Se acabó el contrato.',
        'rehire_eligible' => '1',
    ])->assertRedirect();

    $this->post("/drivers/{$conductor}/employment", [
        'status' => 'available',
        'note' => 'Vuelve a la flota.',
    ])->assertRedirect();

    $fila = DB::table('drivers')->where('id', $conductor)->first();

    expect($fila->status)->toBe('available');
    expect($fila->rehire_eligible)->toBeNull();
});

it('el cambio queda en la pista de auditoría con su motivo', function () {
    signIn($this->scenario, Role::Admin);

    $conductor = FleetFixtures::conductor($this->scenario, 'Ana', 'Ruiz');

    $this->post("/drivers/{$conductor}/employment", [
        'status' => 'on_hold',
        'note' => 'Pendiente del resultado de la prueba.',
    ])->assertRedirect();

    $evento = DB::table('audit_events')
        ->where('entity_type', 'driver')
        ->where('entity_id', $conductor)
        ->orderByDesc('created_at')
        ->first(['after_summary']);

    expect($evento)->not->toBeNull();
    expect((string) $evento->after_summary)->toContain('on_hold');
});
