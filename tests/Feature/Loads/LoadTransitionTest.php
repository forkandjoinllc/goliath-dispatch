<?php

declare(strict_types=1);

use App\Enums\LoadStatus;
use App\Enums\Role;
use App\Support\Loads\Guards;
use App\Support\Loads\Transitions;
use App\Support\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Tests\Support\Scenario;

uses(DatabaseTransactions::class);

/*
| ADVERTENCIA: escritas sin poder ejecutarse (ver docs/testing.md). Las
| transiciones y los bloqueos que afirman se ejercitaron a mano contra la
| aplicación en marcha.
*/

beforeEach(function () {
    app(TenantContext::class)->forget();
    $this->scenario = Scenario::create();
    $this->load = $this->scenario->load;
});

afterEach(fn () => app(TenantContext::class)->forget());

function loadStatus(string $id): string
{
    return (string) DB::table('loads')->where('id', $id)->value('status');
}

/* ── El grafo, sin tocar HTTP ───────────────────────────────────────────── */

it('es una cadena: no se salta de asignada a entregada', function () {
    // Cada paso deja una fila con su hora, y esa cadena de horas es lo que
    // responde «¿cuándo llegó de verdad el camión?» cuando el cliente reclama
    // una detención. Un atajo convertiría el historial en un campo con el
    // último valor.
    expect(Transitions::allowedFrom('delivered', LoadStatus::Assigned))->toBeFalse();
    expect(Transitions::allowedFrom('dispatched', LoadStatus::Assigned))->toBeTrue();
});

it('cancelar se puede desde casi cualquier estado', function (LoadStatus $from, bool $can) {
    // Un cliente que anula a las tres de la mañana no consulta en qué estado
    // tenemos su carga.
    expect(Transitions::allowedFrom('cancelled', $from))->toBe($can);
})->with([
    'borrador' => [LoadStatus::Draft, true],
    'en tránsito' => [LoadStatus::InTransit, true],
    'facturada' => [LoadStatus::Invoiced, true],
    'pagada no: eso es un abono' => [LoadStatus::Paid, false],
    'ya cancelada' => [LoadStatus::Cancelled, false],
]);

it('de asignada se puede VOLVER a disponible', function () {
    // El transportista que se cae a última hora es el caso más común de todos.
    // Sin esta arista habría que cancelar y duplicar, perdiendo el historial
    // justo cuando más falta hace para explicarle al cliente por qué llegó tarde.
    expect(Transitions::allowedFrom('available', LoadStatus::Assigned))->toBeTrue();
});

it('solo cancelar exige motivo', function () {
    expect(Transitions::requiresReason('cancelled'))->toBeTrue();

    foreach (['available', 'assigned', 'dispatched', 'delivered', 'paid'] as $action) {
        expect(Transitions::requiresReason($action))->toBeFalse();
    }
});

/* ── Las puertas de cumplimiento ────────────────────────────────────────── */

it('no publica una carga sin paradas', function () {
    DB::table('load_stops')->where('load_id', $this->load->id)->delete();

    expect(Guards::blocking($this->load->fresh(), 'available'))
        ->toContain('noPickup')
        ->toContain('noDelivery');
});

it('no despacha sin camión ni conductor', function () {
    $this->load->status = LoadStatus::Assigned;

    expect(Guards::blocking($this->load, 'dispatched'))
        ->toContain('noTruck')
        ->toContain('noDriver');
});

it('no despacha si el alta del transportista no está aprobada', function () {
    // El transportista «otro» del escenario está en borrador a propósito.
    $load = $this->scenario->otherLoad;
    $load->status = LoadStatus::Assigned;

    expect(Guards::blocking($load, 'dispatched'))->toContain('carrierNotApproved');
});

it('no despacha una sobredimensionada sin permiso aprobado por una persona', function () {
    $this->scenario->crew($this->load);

    DB::table('loads')->where('id', $this->load->id)->update([
        'is_oversize' => true,
        'permit_ready_approved_at' => null,
    ]);

    $fresh = $this->load->fresh();
    $fresh->status = LoadStatus::Assigned;

    // No basta con que exista una fila en `permits`: alguien tiene que haber
    // dicho que la ruta es transitable con esas medidas. Es la diferencia entre
    // tener el papel y haberlo leído.
    expect(Guards::blocking($fresh, 'dispatched'))->toContain('permitNotApproved');
});

it('no despacha con la licencia de un conductor vencida', function () {
    $this->scenario->crew($this->load);

    DB::table('drivers')
        ->whereIn('id', DB::table('load_assignments')
            ->where('load_id', $this->load->id)
            ->whereNotNull('driver_id')
            ->pluck('driver_id'))
        ->update(['license_expires_at' => now()->subDay()]);

    $fresh = $this->load->fresh();
    $fresh->status = LoadStatus::Assigned;

    // Este es el motivo de que Guards exista aparte de Transitions: la carga se
    // podía despachar ayer y hoy no, sin que nadie haya tocado nada.
    expect(Guards::blocking($fresh, 'dispatched'))->toContain('driverNotCompliant');
});

it('no marca comprobante recibido sin documento adjunto', function () {
    $this->load->status = LoadStatus::Delivered;

    // Es justo el papel que se le enseña al cliente para cobrar.
    expect(Guards::blocking($this->load, 'pod_received'))->toContain('noPodDocument');
});

/* ── Por HTTP ───────────────────────────────────────────────────────────── */

it('el admin recorre el principio del ciclo', function () {
    signIn($this->scenario, Role::Admin);
    $id = $this->load->id;

    $this->post("/loads/{$id}/status/available")->assertRedirect();
    expect(loadStatus($id))->toBe('available');

    $this->post("/loads/{$id}/status/assigned")->assertRedirect();
    expect(loadStatus($id))->toBe('assigned');
});

it('un salto ilegal da 422 y no mueve nada', function () {
    signIn($this->scenario, Role::Admin);
    $id = $this->load->id;

    // 422 y no 403: distinguirlos importa. Con un 403 alguien iría a revisar
    // permisos durante una hora cuando el problema es que otra persona ya movió
    // la carga desde otra pestaña.
    $this->post("/loads/{$id}/status/delivered")->assertSessionHasErrors('action');
    expect(loadStatus($id))->toBe('draft');
});

it('un bloqueo de cumplimiento NOMBRA cada motivo', function () {
    signIn($this->scenario, Role::Admin);
    $id = $this->load->id;

    $this->post("/loads/{$id}/status/available");
    $this->post("/loads/{$id}/status/assigned");
    $this->post("/loads/{$id}/status/dispatched")->assertSessionHasErrors('action');

    // «No se puede despachar» a secas obliga a adivinar cuál de las siete
    // condiciones falla.
    expect(session('errors')->first('action'))
        ->toContain(__('loads.blocking.noTruck'))
        ->toContain(__('loads.blocking.noDriver'));

    expect(loadStatus($id))->toBe('assigned');
});

it('con camión y conductor al día, despacha', function () {
    signIn($this->scenario, Role::Admin);
    $id = $this->load->id;

    $this->post("/loads/{$id}/status/available");
    $this->post("/loads/{$id}/status/assigned");
    $this->scenario->crew($this->load);

    $this->post("/loads/{$id}/status/dispatched")->assertRedirect();
    expect(loadStatus($id))->toBe('dispatched');
});

it('cancelar sin motivo no pasa; con motivo sí, y queda escrito', function () {
    signIn($this->scenario, Role::Admin);
    $id = $this->load->id;

    $this->post("/loads/{$id}/status/cancelled")->assertSessionHasErrors('reason');
    expect(loadStatus($id))->toBe('draft');

    // Menos de diez caracteres tampoco: «ok» no es un motivo.
    $this->post("/loads/{$id}/status/cancelled", ['reason' => 'corto'])
        ->assertSessionHasErrors('reason');

    $this->post("/loads/{$id}/status/cancelled", [
        'reason' => 'El cliente aplazó la producción hasta el próximo trimestre.',
    ])->assertRedirect();

    expect(loadStatus($id))->toBe('cancelled');
    expect(DB::table('loads')->where('id', $id)->value('cancellation_reason'))
        ->toContain('trimestre');
});

it('el transportista no puede mover el estado de su propia carga', function () {
    signIn($this->scenario, Role::Carrier);

    // Tiene load:read con ámbito carrier, pero no load:status:update. Quien
    // mueve la carga es la oficina de despacho.
    $this->post("/loads/{$this->scenario->load->id}/status/available")->assertForbidden();
});

it('el despachador no mueve una carga que no lleva', function () {
    signIn($this->scenario, Role::Dispatcher);

    $this->post("/loads/{$this->scenario->otherLoad->id}/status/available")->assertForbidden();
    expect(loadStatus($this->scenario->otherLoad->id))->toBe('draft');
});

/* ── El rastro ──────────────────────────────────────────────────────────── */

it('cada paso deja historial y auditoría, y el historial no se puede borrar', function () {
    signIn($this->scenario, Role::Admin);
    $id = $this->load->id;

    $this->post("/loads/{$id}/status/available");
    $this->post("/loads/{$id}/status/assigned");

    $rows = DB::table('load_status_history')->where('load_id', $id)->orderBy('occurred_at')->get();

    expect($rows)->toHaveCount(2)
        ->and($rows[0]->from_status)->toBe('draft')
        ->and($rows[0]->to_status)->toBe('available')
        // `source` distingue a una persona del seguimiento por GPS. Importa
        // cuando alguien pregunta por qué la carga se marcó entregada a las 3
        // de la mañana.
        ->and($rows[0]->source)->toBe('user');

    expect(DB::table('audit_events')
        ->where('action', 'load.status_changed')
        ->where('entity_id', $id)
        ->count())->toBe(2);

    // El esquema lo impone con un trigger, no la aplicación. Comprobado de
    // verdad al intentar limpiar los datos de prueba: ERROR 1644.
    expect(fn () => DB::table('load_status_history')->where('load_id', $id)->delete())
        ->toThrow(Illuminate\Database\QueryException::class);
});
