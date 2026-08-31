<?php

declare(strict_types=1);

use App\Enums\Role;
use App\Support\Equipment\Eligibility;
use App\Support\Equipment\UnitFacts;
use App\Support\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Support\Scenario;

uses(DatabaseTransactions::class);

beforeEach(function () {
    app(TenantContext::class)->forget();
    $this->scenario = Scenario::create();
});

afterEach(fn () => app(TenantContext::class)->forget());

/** El camión que el escenario engancha a la carga. */
function camionDeLaCarga(Scenario $scenario): string
{
    $scenario->crew($scenario->load);

    return (string) DB::table('load_assignments')
        ->where('load_id', $scenario->load->id)
        ->whereNotNull('truck_id')
        ->value('truck_id');
}

function conEstado(string $truckId, array $cambios): void
{
    app(TenantContext::class)->withoutTenant(fn () => DB::table('trucks')
        ->where('id', $truckId)
        ->update([...$cambios, 'updated_at' => now()]));
}

// ────────────────────────────────────────────────────────────── la regla, sola

it('una fecha que no consta no bloquea', function () {
    // Nula es «nadie lo ha rellenado», no «está vencido». Cerrar la puerta por
    // un dato que falta pararía la operación de quien no lleve el mantenimiento
    // aquí, y le enseñaría a rellenar cualquier cosa con tal de seguir.
    $facts = new UnitFacts('T-1', 'active', null, null);

    expect(Eligibility::reasons($facts))->toBe([]);
});

it('enumera TODOS los motivos, no el primero', function () {
    // Quien prepara un camión quiere saber de una vez todo lo que le falta, no
    // arreglar una cosa y volver a chocarse con la siguiente.
    $facts = new UnitFacts(
        'T-1',
        'pending_verification',
        CarbonImmutable::parse('2026-01-01'),
        CarbonImmutable::parse('2026-02-01'),
    );

    expect(Eligibility::reasons($facts, CarbonImmutable::parse('2026-08-31')))->toBe([
        Eligibility::SIN_VERIFICAR,
        Eligibility::INSPECCION_VENCIDA,
        Eligibility::MATRICULA_VENCIDA,
    ]);
});

it('la inspección que vence hoy todavía vale', function () {
    $hoy = CarbonImmutable::parse('2026-08-31');

    expect(Eligibility::allows(new UnitFacts('T-1', 'active', $hoy, null), $hoy))->toBeTrue()
        ->and(Eligibility::allows(new UnitFacts('T-1', 'active', $hoy->subDay(), null), $hoy))->toBeFalse();
});

// ──────────────────────────────────────────────────────────────── y la puerta

it('no deja poner en una carga una unidad que nadie ha verificado', function () {
    // La frase que el diccionario lleva prometiendo desde el primer día:
    // «no se puede poner en una carga hasta que alguien la haya revisado».
    // Hasta el lote 57 era falsa.
    signIn($this->scenario, Role::Admin);

    $truckId = camionDeLaCarga($this->scenario);
    conEstado($truckId, ['status' => 'pending_verification']);

    $this->post("/loads/{$this->scenario->load->id}/resources", [
        'resource_type' => 'truck',
        'resource_id' => $truckId,
    ])->assertSessionHasErrors('resource_id');

    expect(session('errors')->first('resource_id'))
        ->toContain((string) __('equipment.blocking.notVerified'));
});

it('no deja poner una unidad con la inspección anual vencida', function () {
    // Y esta es la que más duele: la fecha YA se guardaba en la instantánea de
    // la asignación, como prueba de lo que se sabía en ese momento. Se anotaba
    // que la inspección venció hace ocho meses y se asignaba igual.
    signIn($this->scenario, Role::Admin);

    $truckId = camionDeLaCarga($this->scenario);
    conEstado($truckId, ['status' => 'active', 'next_inspection_due_at' => now()->subMonths(8)]);

    $this->post("/loads/{$this->scenario->load->id}/resources", [
        'resource_type' => 'truck',
        'resource_id' => $truckId,
    ])->assertSessionHasErrors('resource_id');

    expect(session('errors')->first('resource_id'))
        ->toContain((string) __('equipment.blocking.inspectionOverdue'));
});

it('deja poner una unidad en regla', function () {
    signIn($this->scenario, Role::Admin);

    $truckId = camionDeLaCarga($this->scenario);
    conEstado($truckId, [
        'status' => 'active',
        'next_inspection_due_at' => now()->addMonths(6),
        'registration_expires_at' => now()->addYear(),
    ]);

    $this->post("/loads/{$this->scenario->load->id}/resources", [
        'resource_type' => 'truck',
        'resource_id' => $truckId,
    ])->assertSessionHasNoErrors();
});

it('el desplegable dice lo mismo que la puerta', function () {
    // Si la lista marcara en regla una unidad que la asignación va a rechazar,
    // se descubriría el muro chocándose con él. Los dos sitios leen la misma
    // regla, y esto es lo que lo comprueba.
    signIn($this->scenario, Role::Admin);

    $truckId = camionDeLaCarga($this->scenario);
    conEstado($truckId, ['status' => 'pending_verification']);

    $props = $this->get("/loads/{$this->scenario->load->id}")
        ->assertOk()
        ->viewData('page')['props'];

    $camiones = collect($props['assignable']['trucks'])->firstWhere('id', $truckId);

    expect($camiones['ok'])->toBeFalse()
        ->and($camiones['blockingKeys'])->toContain(Eligibility::SIN_VERIFICAR);
});

// ─────────────────────────────────────────────── qué significa «verificada»

it('no deja poner en servicio una unidad sin verificar', function () {
    // La llave de la puerta del lote 57 era un desplegable: se cambiaba el
    // estado a «activa» y ya estaba, sin que constara qué se había mirado.
    signIn($this->scenario, Role::Admin);

    $truckId = camionDeLaCarga($this->scenario);
    conEstado($truckId, ['status' => 'pending_verification']);

    $this->post("/equipment/trucks/{$truckId}/status", ['status' => 'active'])
        ->assertSessionHasErrors('status');

    expect(DB::table('trucks')->where('id', $truckId)->value('status'))->toBe('pending_verification');
});

it('no verifica sin certificado de seguro vigente, y dice cuál de las dos cosas pasa', function () {
    signIn($this->scenario, Role::Admin);

    $truckId = camionDeLaCarga($this->scenario);

    $this->post("/equipment/trucks/{$truckId}/verification", ['action' => 'confirm'])
        ->assertSessionHasErrors('action');

    expect(session('errors')->first('action'))
        ->toBe((string) __('equipment.verification.no_coi_on_file'));
});

it('verifica contra el certificado y deja constancia de cuál', function () {
    $this->scenario->approveCarrierDocuments();

    signIn($this->scenario, Role::Admin);

    $truckId = camionDeLaCarga($this->scenario);
    conEstado($truckId, ['status' => 'pending_verification']);

    $this->post("/equipment/trucks/{$truckId}/verification", ['action' => 'confirm'])
        ->assertSessionHasNoErrors();

    $fila = DB::table('equipment_verifications')->where('equipment_id', $truckId)->first();

    expect($fila)->not->toBeNull()
        ->and($fila->status)->toBe('verified')
        // Contra QUÉ documento se miró. Si la póliza se sustituye mañana, la
        // verificación de ayer sigue diciendo lo que se miró ayer.
        ->and($fila->coi_document_id)->not->toBeNull()
        ->and($fila->matched_vin)->not->toBeNull();

    // Y ahora sí se puede poner en servicio.
    $this->post("/equipment/trucks/{$truckId}/status", ['status' => 'active'])
        ->assertSessionHasNoErrors();

    expect(DB::table('trucks')->where('id', $truckId)->value('status'))->toBe('active');
});

it('la anulación exige motivo, y el motivo se queda con la unidad', function () {
    signIn($this->scenario, Role::Admin);

    $truckId = camionDeLaCarga($this->scenario);
    conEstado($truckId, ['status' => 'pending_verification']);

    $this->post("/equipment/trucks/{$truckId}/verification", ['action' => 'override', 'reason' => 'ok'])
        ->assertSessionHasErrors('reason');

    expect(DB::table('equipment_verifications')->where('equipment_id', $truckId)->count())->toBe(0);

    $this->post("/equipment/trucks/{$truckId}/verification", [
        'action' => 'override',
        'reason' => 'Póliza confirmada por teléfono con la aseguradora; el certificado llega mañana.',
    ])->assertSessionHasNoErrors();

    $fila = DB::table('equipment_verifications')->where('equipment_id', $truckId)->first();

    expect($fila->status)->toBe('manually_overridden')
        ->and($fila->override_reason)->toContain('aseguradora')
        ->and($fila->overridden_by_user_id)->not->toBeNull();
});

it('un despachador no puede anular la verificación', function () {
    // La asimetría está en la matriz de roles desde el principio: el despachador
    // da de alta la unidad y sube sus fotos, y no decide que entre en servicio
    // sin póliza. Solo tiene sentido si alguien la usa.
    signIn($this->scenario, Role::Dispatcher);

    $truckId = camionDeLaCarga($this->scenario);
    conEstado($truckId, ['status' => 'pending_verification']);

    $this->post("/equipment/trucks/{$truckId}/verification", [
        'action' => 'override',
        'reason' => 'Me corre prisa y el camión está listo para salir hoy.',
    ])->assertRedirect();

    expect(DB::table('equipment_verifications')->where('equipment_id', $truckId)->count())->toBe(0);
});

it('la bitácora distingue confirmar de anular', function () {
    // Usar `verification.override` para las dos cosas dejaría la bitácora
    // diciendo que se anuló algo cada vez que alguien confirmó un VIN.
    $this->scenario->approveCarrierDocuments();

    signIn($this->scenario, Role::Admin);

    $truckId = camionDeLaCarga($this->scenario);

    $this->post("/equipment/trucks/{$truckId}/verification", ['action' => 'confirm'])
        ->assertSessionHasNoErrors();

    expect(DB::table('audit_events')->where('entity_type', 'equipment_verification')->value('action'))
        ->toBe('equipment.verified');
});
