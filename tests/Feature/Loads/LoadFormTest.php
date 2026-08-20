<?php

declare(strict_types=1);

use App\Enums\LoadStatus;
use App\Enums\Role;
use App\Support\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Inertia\Testing\AssertableInertia as Assert;
use Tests\Support\Scenario;

uses(DatabaseTransactions::class);

/*
| ADVERTENCIA: escritas sin poder ejecutarse (ver docs/testing.md). El
| comportamiento que afirman se recorrió a mano por HTTP y con navegador: una
| carga creada desde cero y llevada hasta entregada.
*/

beforeEach(function () {
    app(TenantContext::class)->forget();
    $this->scenario = Scenario::create();
});

afterEach(fn () => app(TenantContext::class)->forget());

/**
 * @return array<string, mixed>
 */
function loadPayload(Scenario $scenario, array $overrides = []): array
{
    return [
        'customer_id' => $scenario->customer->id,
        'commodity' => 'Viga de puente prefabricada',
        'weight_pounds' => 68000,
        'customer_charge_cents' => 780000,
        'miles' => 390,
        'stops' => [
            ['stop_type' => 'pickup', 'facility_name' => 'Planta Odessa', 'city' => 'Odessa', 'state' => 'TX'],
            ['stop_type' => 'delivery', 'facility_name' => 'Obra Dallas', 'city' => 'Dallas', 'state' => 'TX'],
        ],
        ...$overrides,
    ];
}

/* ── Alta ───────────────────────────────────────────────────────────────── */

it('crea una carga con su número y sus paradas', function () {
    signIn($this->scenario, Role::Admin);

    $this->post('/loads', loadPayload($this->scenario))->assertRedirect();

    $load = DB::table('loads')->where('commodity', 'Viga de puente prefabricada')->first();

    expect($load)->not->toBeNull()
        // Nace en borrador pase lo que pase: publicarla es un acto aparte.
        ->and($load->status)->toBe('draft')
        ->and($load->load_number)->toStartWith('GD-');

    expect(DB::table('load_stops')->where('load_id', $load->id)->count())->toBe(2);
});

it('la numeración no se salta ni repite', function () {
    signIn($this->scenario, Role::Admin);

    $this->post('/loads', loadPayload($this->scenario, ['commodity' => 'Primera']));
    $this->post('/loads', loadPayload($this->scenario, ['commodity' => 'Segunda']));

    $numbers = DB::table('loads')
        ->whereIn('commodity', ['Primera', 'Segunda'])
        ->pluck('load_number');

    expect($numbers)->toHaveCount(2)
        ->and($numbers->unique())->toHaveCount(2);
});

it('rechaza una carga sin recogida o sin entrega', function () {
    signIn($this->scenario, Role::Admin);

    // Es la misma regla que Guards comprueba al publicar, adelantada al
    // formulario para que nadie guarde algo que no va a poder publicar.
    $this->post('/loads', loadPayload($this->scenario, [
        'stops' => [
            ['stop_type' => 'pickup', 'city' => 'Odessa'],
            ['stop_type' => 'pickup', 'city' => 'Midland'],
        ],
    ]))->assertSessionHasErrors('stops');
});

it('rechaza un cliente de otra empresa', function () {
    signIn($this->scenario, Role::Admin);

    $other = Scenario::create();
    app(TenantContext::class)->forget();

    // Un id válido de OTRA empresa pasa la validación de formato. El scope
    // global impide leerlo, pero no impediría escribirlo aquí.
    $this->post('/loads', loadPayload($this->scenario, ['customer_id' => $other->customer->id]))
        ->assertSessionHasErrors('customer_id');
});

it('contabilidad no puede crear cargas', function () {
    signIn($this->scenario, Role::Accounting);

    $this->post('/loads', loadPayload($this->scenario))->assertForbidden();
});

/* ── Los dos permisos de edición, que no se implican ────────────────────── */

it('el despachador edita la mercancía pero no el reparto', function () {
    signIn($this->scenario, Role::Dispatcher);

    $load = $this->scenario->load;
    $rateBefore = (int) $load->carrier_gross_rate_cents;

    $this->patch("/loads/{$load->id}", loadPayload($this->scenario, [
        'commodity' => 'Cambiada por el despachador',
        'customer_charge_cents' => 800000,
        'carrier_gross_rate_cents' => 1,
        'dispatcher_commission_bps' => 9000,
    ]))->assertRedirect();

    $fresh = DB::table('loads')->where('id', $load->id)->first();

    // La mercancía y el precio de VENTA sí: se los fija quien habló con el
    // cliente. El reparto no: sin esto, un despachador podría subirse su propia
    // comisión al 90 %.
    expect($fresh->commodity)->toBe('Cambiada por el despachador')
        ->and((int) $fresh->customer_charge_cents)->toBe(800000)
        ->and((int) $fresh->carrier_gross_rate_cents)->toBe($rateBefore)
        ->and((int) $fresh->dispatcher_commission_bps)->toBe(2500);
});

it('contabilidad edita el reparto aunque no tenga load:update', function () {
    signIn($this->scenario, Role::Accounting);

    $load = $this->scenario->load;

    // Este es el fallo de diseño que salió al probar: la pantalla estaba
    // cerrada con `load:update` a secas, dejando fuera precisamente al rol que
    // existe para tocar el dinero.
    $this->get("/loads/{$load->id}/edit")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->where('canEditFreight', false)
            ->where('canEditFinancials', true));

    $this->patch("/loads/{$load->id}", [
        'carrier_gross_rate_cents' => 600000,
        'dispatcher_commission_bps' => 3000,
        'carrier_dispatch_fee_bps' => 1100,
    ])->assertRedirect();

    $fresh = DB::table('loads')->where('id', $load->id)->first();

    expect((int) $fresh->carrier_gross_rate_cents)->toBe(600000)
        ->and((int) $fresh->dispatcher_commission_bps)->toBe(3000)
        ->and((int) $fresh->carrier_dispatch_fee_bps)->toBe(1100);
});

it('contabilidad no puede tocar la mercancía ni las paradas', function () {
    signIn($this->scenario, Role::Accounting);

    $load = $this->scenario->load;
    $before = $load->commodity;

    $this->patch("/loads/{$load->id}", [
        'commodity' => 'Contabilidad no debería poder cambiar esto',
        'carrier_gross_rate_cents' => 600000,
    ])->assertRedirect();

    expect(DB::table('loads')->where('id', $load->id)->value('commodity'))->toBe($before);
    expect(DB::table('load_stops')->where('load_id', $load->id)->count())->toBe(2);
});

it('el transportista no puede editar nada de la carga', function () {
    signIn($this->scenario, Role::Carrier);

    $this->get("/loads/{$this->scenario->load->id}/edit")->assertForbidden();
});

it('todo cambio de dinero deja rastro', function () {
    signIn($this->scenario, Role::Accounting);

    $this->patch("/loads/{$this->scenario->load->id}", ['carrier_gross_rate_cents' => 555000]);

    // «¿Quién bajó la tarifa de esta carga?» es una pregunta que se hace meses
    // después, cuando el transportista reclama.
    $event = DB::table('audit_events')
        ->where('entity_id', $this->scenario->load->id)
        ->where('action', 'financial.changed')
        ->latest('created_at')
        ->first();

    expect($event)->not->toBeNull()
        ->and(json_decode((string) $event->after_summary, true)['carrier_gross_rate_cents'])->toBe(555000);
});

/* ── Asignación ─────────────────────────────────────────────────────────── */

it('asignar transportista CONGELA su tarifa en la carga', function () {
    signIn($this->scenario, Role::Admin);

    $load = $this->scenario->otherLoad;

    DB::table('carriers')->where('id', $this->scenario->assignedCarrier->id)
        ->update(['dispatch_fee_bps' => 1150]);

    $this->post("/loads/{$load->id}/carrier", [
        'carrier_id' => $this->scenario->assignedCarrier->id,
        'carrier_gross_rate_cents' => 620000,
    ])->assertRedirect();

    // Y ahora se le sube el porcentaje al transportista.
    DB::table('carriers')->where('id', $this->scenario->assignedCarrier->id)
        ->update(['dispatch_fee_bps' => 2000]);

    $fresh = DB::table('loads')->where('id', $load->id)->first();

    // La carga conserva lo pactado. Sin esto, subirle la tarifa a alguien
    // reescribiría hacia atrás todas sus cargas anteriores.
    expect((int) $fresh->carrier_dispatch_fee_bps)->toBe(1150)
        ->and((int) $fresh->carrier_gross_rate_cents)->toBe(620000);
});

it('no asigna un transportista sin el alta aprobada', function () {
    signIn($this->scenario, Role::Admin);

    $this->post("/loads/{$this->scenario->load->id}/carrier", [
        'carrier_id' => $this->scenario->otherCarrier->id,
        'carrier_gross_rate_cents' => 500000,
    ])->assertSessionHasErrors('carrier_id');
});

it('rechaza un conductor con la licencia vencida, y dice cuándo venció', function () {
    signIn($this->scenario, Role::Admin);

    $this->scenario->crew($this->scenario->load);

    $driverId = DB::table('load_assignments')
        ->where('load_id', $this->scenario->load->id)
        ->whereNotNull('driver_id')
        ->value('driver_id');

    DB::table('drivers')->where('id', $driverId)->update(['license_expires_at' => '2025-03-03']);

    $this->post("/loads/{$this->scenario->load->id}/resources", [
        'resource_type' => 'driver',
        'resource_id' => $driverId,
    ])->assertSessionHasErrors('resource_id');

    // La fecha, sin los milisegundos de la columna datetime(3).
    expect(session('errors')->first('resource_id'))->toContain('2025-03-03');
});

it('rechaza el camión de otro transportista', function () {
    signIn($this->scenario, Role::Admin);

    $this->scenario->crew($this->scenario->load);
    $this->scenario->crew($this->scenario->otherLoad);

    $foreignTruck = DB::table('load_assignments')
        ->where('load_id', $this->scenario->otherLoad->id)
        ->whereNotNull('truck_id')
        ->value('truck_id');

    // No es un problema de cumplimiento, es un disparate. Sin esta comprobación
    // el selector filtrado sería la única defensa, y una petición a mano se lo
    // salta.
    $this->post("/loads/{$this->scenario->load->id}/resources", [
        'resource_type' => 'truck',
        'resource_id' => $foreignTruck,
    ])->assertSessionHasErrors('resource_id');
});

it('exige transportista antes que camión o conductor', function () {
    signIn($this->scenario, Role::Admin);

    DB::table('loads')->where('id', $this->scenario->load->id)->update(['carrier_id' => null]);

    $this->post("/loads/{$this->scenario->load->id}/resources", [
        'resource_type' => 'truck',
        'resource_id' => (string) Illuminate\Support\Str::uuid(),
    ])->assertSessionHasErrors('resource_id');
});

it('sustituir un recurso retira el anterior sin borrarlo', function () {
    signIn($this->scenario, Role::Admin);
    $this->scenario->crew($this->scenario->load);

    $first = DB::table('load_assignments')
        ->where('load_id', $this->scenario->load->id)
        ->where('resource_type', 'truck')
        ->value('id');

    $this->scenario->crew($this->scenario->load);

    $replacement = DB::table('trucks')
        ->where('carrier_id', $this->scenario->load->carrier_id)
        ->orderByDesc('created_at')
        ->value('id');

    $this->post("/loads/{$this->scenario->load->id}/resources", [
        'resource_type' => 'truck',
        'resource_id' => $replacement,
    ])->assertRedirect();

    // El historial tiene que poder decir quién llevaba la carga el martes.
    expect(DB::table('load_assignments')->where('id', $first)->value('unassigned_at'))->not->toBeNull();

    expect(DB::table('load_assignments')
        ->where('load_id', $this->scenario->load->id)
        ->where('resource_type', 'truck')
        ->whereNull('unassigned_at')
        ->count())->toBe(1);
});

/* ── El cierre del transportista ────────────────────────────────────────── */

it('despachar CIERRA el transportista', function () {
    signIn($this->scenario, Role::Admin);
    $load = $this->scenario->load;

    $this->post("/loads/{$load->id}/status/available");
    $this->post("/loads/{$load->id}/status/assigned");
    $this->scenario->crew($load);
    $this->post("/loads/{$load->id}/status/dispatched")->assertRedirect();

    expect(DB::table('loads')->where('id', $load->id)->value('carrier_locked_at'))->not->toBeNull();
});

it('una carga ya despachada no cambia de transportista', function () {
    signIn($this->scenario, Role::Admin);
    $load = $this->scenario->load;

    DB::table('loads')->where('id', $load->id)->update(['carrier_locked_at' => now()]);

    // Cambiarlo a estas alturas no es una corrección, es otra carga. La columna
    // existía en el esquema y nada la escribía nunca, así que esta comprobación
    // no se disparaba jamás.
    $this->post("/loads/{$load->id}/carrier", [
        'carrier_id' => $this->scenario->assignedCarrier->id,
        'carrier_gross_rate_cents' => 500000,
    ])->assertSessionHasErrors('carrier_id');
});

/* ── El ciclo entero ────────────────────────────────────────────────────── */

it('una carga nace, se asigna, se despacha y se entrega sin tocar la base', function () {
    signIn($this->scenario, Role::Admin);

    $this->post('/loads', loadPayload($this->scenario, ['commodity' => 'Ciclo completo']))
        ->assertRedirect();

    $load = App\Models\Load::query()->where('commodity', 'Ciclo completo')->first();

    $this->post("/loads/{$load->id}/status/available")->assertRedirect();

    $this->post("/loads/{$load->id}/carrier", [
        'carrier_id' => $this->scenario->assignedCarrier->id,
        'carrier_gross_rate_cents' => 620000,
    ])->assertRedirect();

    $this->post("/loads/{$load->id}/status/assigned")->assertRedirect();

    $this->scenario->crew($load->fresh());

    foreach (['dispatched', 'en_route_to_pickup', 'at_pickup', 'in_transit', 'at_delivery', 'delivered'] as $step) {
        $this->post("/loads/{$load->id}/status/{$step}")->assertRedirect();
    }

    expect(DB::table('loads')->where('id', $load->id)->value('status'))->toBe('delivered');

    // Ocho pasos, ocho filas de historial. Es la cadena de horas que responde
    // «¿cuándo llegó de verdad el camión?».
    expect(DB::table('load_status_history')->where('load_id', $load->id)->count())->toBe(7);
});
