<?php

declare(strict_types=1);

use App\Enums\Role;
use App\Support\Onboarding\Transitions;
use App\Support\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Tests\Support\Scenario;

uses(DatabaseTransactions::class);

/*
| ADVERTENCIA: escritas sin poder ejecutarse (ver CarrierAccessTest). El
| comportamiento que afirman sí se comprobó a mano contra la aplicación.
*/

beforeEach(function () {
    app(TenantContext::class)->forget();
    $this->scenario = Scenario::create();
    // El de borrador es el que sirve para recorrer el ciclo entero.
    $this->carrier = $this->scenario->otherCarrier;
});

afterEach(fn () => app(TenantContext::class)->forget());

function onboardingStatus(string $carrierId): string
{
    return (string) DB::table('carrier_onboardings')->where('carrier_id', $carrierId)->value('status');
}

function carrierStatus(string $carrierId): string
{
    return (string) DB::table('carriers')->where('id', $carrierId)->value('onboarding_status');
}

/* ── El grafo, sin tocar HTTP ───────────────────────────────────────────── */

it('no permite saltar de borrador a aprobado', function () {
    // El paso por revisión es lo que deja constancia de que alguien miró los
    // documentos. Un atajo aquí convertiría el alta en un campo de estado.
    expect(Transitions::allowedFrom('approved', App\Enums\OnboardingStatus::Draft))->toBeFalse();
    expect(Transitions::allowedFrom('submitted', App\Enums\OnboardingStatus::Draft))->toBeTrue();
});

it('reactivar devuelve a revisión, no a aprobado', function () {
    // Lo que provocó la suspensión —un seguro vencido, casi siempre— hay que
    // volver a mirarlo.
    expect(Transitions::target('reinstate'))->toBe(App\Enums\OnboardingStatus::UnderReview);
});

it('exige motivo escrito en todo lo que perjudica al transportista', function () {
    expect(Transitions::requiresReason('corrections_required'))->toBeTrue();
    expect(Transitions::requiresReason('rejected'))->toBeTrue();
    expect(Transitions::requiresReason('suspended'))->toBeTrue();
    expect(Transitions::requiresReason('approved'))->toBeFalse();
    expect(Transitions::requiresReason('submitted'))->toBeFalse();
});

/* ── El ciclo, por HTTP ─────────────────────────────────────────────────── */

it('el admin recorre el ciclo completo', function () {
    signIn($this->scenario, Role::Admin);
    $id = $this->carrier->id;

    $this->post("/carriers/{$id}/onboarding/submitted")->assertRedirect();
    expect(onboardingStatus($id))->toBe('submitted');

    $this->post("/carriers/{$id}/onboarding/under_review")->assertRedirect();
    expect(onboardingStatus($id))->toBe('under_review');

    $this->post("/carriers/{$id}/onboarding/approved")->assertRedirect();
    expect(onboardingStatus($id))->toBe('approved');

    // El estado del transportista se mantiene a la par con el del alta, porque
    // los listados y los filtros leen el del transportista.
    expect(carrierStatus($id))->toBe('approved');
});

it('una transición ilegal da 422, no 403', function () {
    signIn($this->scenario, Role::Admin);

    // Distinguirlos importa: con un 403 alguien iría a revisar permisos durante
    // una hora cuando el problema es que otra persona ya movió el alta desde
    // otra pestaña.
    $this->post("/carriers/{$this->carrier->id}/onboarding/approved")
        ->assertSessionHasErrors('action');

    expect(onboardingStatus($this->carrier->id))->toBe('draft');
});

it('el despachador puede enviar a revisión pero no aprobar', function () {
    $id = $this->scenario->assignedCarrier->id;

    // El asignado está aprobado; se le da la vuelta desde el admin para dejarlo
    // en un estado desde el que el despachador pueda enviar.
    DB::table('carrier_onboardings')->where('carrier_id', $id)->update(['status' => 'draft']);
    DB::table('carriers')->where('id', $id)->update(['onboarding_status' => 'draft']);

    signIn($this->scenario, Role::Dispatcher);

    $this->post("/carriers/{$id}/onboarding/submitted")->assertRedirect();
    expect(onboardingStatus($id))->toBe('submitted');

    $this->post("/carriers/{$id}/onboarding/under_review")->assertForbidden();
    expect(onboardingStatus($id))->toBe('submitted');
});

it('el despachador no mueve el alta de un transportista que no lleva', function () {
    signIn($this->scenario, Role::Dispatcher);

    $this->post("/carriers/{$this->carrier->id}/onboarding/submitted")->assertForbidden();
    expect(onboardingStatus($this->carrier->id))->toBe('draft');
});

it('rechazar sin motivo no pasa; con motivo sí, y el motivo se guarda', function () {
    signIn($this->scenario, Role::Admin);
    $id = $this->carrier->id;

    $this->post("/carriers/{$id}/onboarding/submitted");
    $this->post("/carriers/{$id}/onboarding/under_review");

    $this->post("/carriers/{$id}/onboarding/rejected")->assertSessionHasErrors('reason');
    expect(onboardingStatus($id))->toBe('under_review');

    $this->post("/carriers/{$id}/onboarding/rejected", [
        'reason' => 'El certificado de seguro no cubre carga sobredimensionada.',
    ])->assertRedirect();

    expect(onboardingStatus($id))->toBe('rejected');
    expect(DB::table('carrier_onboardings')->where('carrier_id', $id)->value('rejection_reason'))
        ->toContain('sobredimensionada');
});

/* ── El rastro ──────────────────────────────────────────────────────────── */

it('cada transición deja un evento en el historial y en la auditoría', function () {
    signIn($this->scenario, Role::Admin);
    $id = $this->carrier->id;

    $this->post("/carriers/{$id}/onboarding/submitted");
    $this->post("/carriers/{$id}/onboarding/under_review");

    $onboardingId = DB::table('carrier_onboardings')->where('carrier_id', $id)->value('id');

    // El historial del alta es de solo-añadir por diseño: es lo que responde
    // «¿quién aprobó a este transportista y cuándo?» dos años después, con la
    // fila del alta ya con otro estado encima.
    $events = DB::table('carrier_onboarding_events')
        ->where('onboarding_id', $onboardingId)
        ->orderBy('created_at')
        ->get();

    expect($events)->toHaveCount(2)
        ->and($events[0]->from_status)->toBe('draft')
        ->and($events[0]->to_status)->toBe('submitted')
        ->and($events[1]->to_status)->toBe('under_review');

    expect(DB::table('audit_events')
        ->where('action', 'onboarding.status_changed')
        ->where('entity_id', $id)
        ->count())->toBe(2);
});

/* ── FMCSA sin credenciales ─────────────────────────────────────────────── */

it('la verificación usa el adaptador simulado y lo dice en la fila', function () {
    signIn($this->scenario, Role::Admin);
    $id = $this->carrier->id;

    $this->post("/carriers/{$id}/verification")->assertRedirect();

    $row = DB::table('fmcsa_verifications')->where('carrier_id', $id)->latest('created_at')->first();

    // Que la fila se identifique como simulacro no es cosmético: es lo que
    // impide que alguien tome estos datos por una verificación real dentro de
    // dos años, sin este código delante.
    expect($row)->not->toBeNull()
        ->and($row->provider)->toBe('mock')
        ->and(json_decode((string) $row->normalized, true)['source'])->toContain('mock adapter');
});

it('anular la verificación exige motivo y deja rastro imborrable', function () {
    signIn($this->scenario, Role::Admin);
    $id = $this->carrier->id;

    $this->post("/carriers/{$id}/verification/override")->assertSessionHasErrors('reason');

    // Mínimo diez caracteres: «ok» no es un motivo.
    $this->post("/carriers/{$id}/verification/override", ['reason' => 'corto'])
        ->assertSessionHasErrors('reason');

    $this->post("/carriers/{$id}/verification/override", [
        'reason' => 'FMCSA aún no ha propagado el cambio de razón social del 3 de julio.',
    ])->assertRedirect();

    expect(DB::table('carriers')->where('id', $id)->value('fmcsa_status'))
        ->toBe('manually_overridden');

    expect(DB::table('audit_events')
        ->where('action', 'verification.override')
        ->where('entity_id', $id)
        ->value('reason'))->toContain('razón social');
});
