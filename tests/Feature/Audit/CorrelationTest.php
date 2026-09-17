<?php

declare(strict_types=1);

use App\Enums\AuditAction;
use App\Enums\Role;
use App\Support\Audit;
use App\Support\Auditing\Correlation;
use App\Support\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Support\Scenario;

/**
 * Los eventos de un mismo acto quedan juntos.
 *
 * `Audit::record()` escribía el agrupador leyendo la cabecera `X-Request-Id`, y
 * nadie la pone: la columna salía nula siempre. El bloque de «hermanos» de la
 * ficha de auditoría —que es el motivo por el que esa pantalla existe— estaba
 * siempre vacío.
 */
uses(DatabaseTransactions::class);

beforeEach(function (): void {
    app(TenantContext::class)->forget();
    Correlation::forget();
    $this->scenario = Scenario::create();
});

afterEach(function (): void {
    app(TenantContext::class)->forget();
    Correlation::forget();
});

/** Los eventos de auditoría que hay ahora, con su agrupador. */
function eventosDeAuditoria(): Illuminate\Support\Collection
{
    return app(TenantContext::class)->withoutTenant(fn () => DB::table('audit_events')
        ->orderBy('occurred_at')
        ->get(['id', 'action', 'request_id']));
}

/* ── Que exista ──────────────────────────────────────────────────────────── */

it('todo evento sale con su agrupador, que es lo que no pasaba', function (): void {
    // ESTE ES EL FALLO. Antes: `request_id` nulo en los 21 eventos de la
    // demostración, y en todos los que escribiera cualquiera.
    signIn($this->scenario, Role::Admin);

    $this->post("/loads/{$this->scenario->load->id}/messages")->assertRedirect();

    $sinAgrupador = eventosDeAuditoria()->filter(
        static fn (object $e): bool => $e->request_id === null || $e->request_id === '',
    );

    expect($sinAgrupador)->toBeEmpty();
});

it('los eventos de UNA petición comparten agrupador', function (): void {
    // Abrir el hilo de una carga mete a dos personas y escribe dos eventos. Son
    // un solo acto y leerlos sueltos no cuenta lo que pasó.
    signIn($this->scenario, Role::Admin);

    $this->post("/loads/{$this->scenario->load->id}/messages")->assertRedirect();

    $participantes = eventosDeAuditoria()
        ->where('action', 'message.participant_added');

    expect($participantes->count())->toBeGreaterThan(1);
    expect($participantes->pluck('request_id')->unique())->toHaveCount(1);
});

it('dos peticiones distintas no se mezclan', function (): void {
    signIn($this->scenario, Role::Admin);

    $this->post("/loads/{$this->scenario->load->id}/messages")->assertRedirect();
    $primera = eventosDeAuditoria()->last()->request_id;

    $this->post('/retention/holds', [
        'name' => 'Citación',
        'reason' => 'Citación amplia, todavía no se sabe qué piden.',
        'scope_type' => 'tenant',
    ])->assertRedirect();

    $segunda = eventosDeAuditoria()->last()->request_id;

    expect($segunda)->not->toBe($primera);
});

/* ── Que no lo elija quien llama ─────────────────────────────────────────── */

it('la cabecera que manda el cliente NO decide el agrupamiento', function (): void {
    // Era de donde salía el valor. En una tabla de solo-añadir, que quien hace
    // la petición elija cómo se agrupan sus eventos es peor que no agruparlos:
    // un agrupamiento falso no se puede corregir después.
    signIn($this->scenario, Role::Admin);

    $this->withHeaders(['X-Request-Id' => 'lo-que-yo-quiera'])
        ->post("/loads/{$this->scenario->load->id}/messages")
        ->assertRedirect();

    expect(eventosDeAuditoria()->pluck('request_id')->unique())
        ->not->toContain('lo-que-yo-quiera');
});

it('dos peticiones con la MISMA cabecera del cliente siguen separadas', function (): void {
    // La otra mitad: no basta con ignorar el valor, hay que no dejar que junte.
    signIn($this->scenario, Role::Admin);

    $this->withHeaders(['X-Request-Id' => 'misma'])
        ->post("/loads/{$this->scenario->load->id}/messages")->assertRedirect();
    $primera = eventosDeAuditoria()->last()->request_id;

    $this->withHeaders(['X-Request-Id' => 'misma'])
        ->post('/retention/holds', [
            'name' => 'Citación',
            'reason' => 'Citación amplia, todavía no se sabe qué piden.',
            'scope_type' => 'tenant',
        ])->assertRedirect();

    expect(eventosDeAuditoria()->last()->request_id)->not->toBe($primera);
});

it('el identificador vuelve en la respuesta', function (): void {
    // Para que sirva fuera de la pantalla: quien informa de un problema da ese
    // número y lleva directo a sus eventos.
    signIn($this->scenario, Role::Admin);

    $r = $this->post("/loads/{$this->scenario->load->id}/messages");

    $delEncabezado = $r->headers->get('X-Request-Id');

    expect($delEncabezado)->not->toBeNull();
    expect(eventosDeAuditoria()->last()->request_id)->toBe($delEncabezado);
});

/* ── La pantalla que existe por esto ─────────────────────────────────────── */

it('la ficha de auditoría enseña por fin los hermanos', function (): void {
    // El bloque que la cabecera de `AuditController::show()` llama «el motivo
    // por el que esta pantalla existe». Estaba siempre vacío.
    signIn($this->scenario, Role::Admin);

    $this->post("/loads/{$this->scenario->load->id}/messages")->assertRedirect();

    $evento = eventosDeAuditoria()->firstWhere('action', 'message.participant_added');

    $this->get("/audit/{$evento->id}")->assertInertia(fn ($page) => $page
        ->where('siblings', fn ($h) => collect($h)->isNotEmpty())
        ->where('event.requestId', $evento->request_id));
});

it('el buscador por identificador de petición encuentra algo', function (): void {
    signIn($this->scenario, Role::Admin);

    $this->post("/loads/{$this->scenario->load->id}/messages")->assertRedirect();

    $id = (string) eventosDeAuditoria()->last()->request_id;

    $this->get('/audit?q='.$id)->assertInertia(fn ($page) => $page
        ->where('events.data', fn ($filas) => collect($filas)->isNotEmpty()));
});

/* ── La consola también es un acto ───────────────────────────────────────── */

it('lo que escribe una orden de consola queda junto', function (): void {
    // El barrido nocturno escribe varios eventos y no es una petición. Sin
    // identificador quedaban tan sueltos como los de la pantalla.
    $actor = app(App\Authorization\ActorFactory::class)->for(
        $this->scenario->user(Role::Admin)->fresh(),
        (string) $this->scenario->tenant->id,
    );

    app(TenantContext::class)->set((string) $this->scenario->tenant->id);

    Audit::record($actor, AuditAction::RetentionArchived, entityType: 'tenant', entityId: (string) $this->scenario->tenant->id);
    Audit::record($actor, AuditAction::RetentionPurged, entityType: 'tenant', entityId: (string) $this->scenario->tenant->id);

    $delBarrido = eventosDeAuditoria()
        ->whereIn('action', ['retention.archived', 'retention.purged'])
        ->pluck('request_id')
        ->unique();

    expect($delBarrido)->toHaveCount(1);
    expect($delBarrido->first())->not->toBeNull();
});

it('otra ejecución de consola no se mezcla con la anterior', function (): void {
    // `Correlation::forget()` es lo que en producción hace el final del
    // proceso: cada `artisan` es una ejecución y un identificador.
    $actor = app(App\Authorization\ActorFactory::class)->for(
        $this->scenario->user(Role::Admin)->fresh(),
        (string) $this->scenario->tenant->id,
    );

    app(TenantContext::class)->set((string) $this->scenario->tenant->id);

    Audit::record($actor, AuditAction::RetentionArchived, entityType: 'tenant', entityId: 'a');
    $primera = eventosDeAuditoria()->last()->request_id;

    Correlation::forget();

    Audit::record($actor, AuditAction::RetentionArchived, entityType: 'tenant', entityId: 'b');

    expect(eventosDeAuditoria()->last()->request_id)->not->toBe($primera);
});
