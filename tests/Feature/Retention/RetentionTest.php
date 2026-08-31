<?php

declare(strict_types=1);

use App\Authorization\ActorFactory;
use App\Enums\Role;
use App\Support\Retention\Holds;
use App\Support\Retention\Policy;
use App\Support\Retention\Sweeper;
use App\Support\Storage\DocumentStore;
use App\Support\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Support\Scenario;

uses(DatabaseTransactions::class);

beforeEach(function () {
    app(TenantContext::class)->forget();
    $this->scenario = Scenario::create();
    config(['retention.purge_enabled' => false]);
});

afterEach(fn () => app(TenantContext::class)->forget());

/**
 * El Actor de un rol, como lo construye la aplicación.
 *
 * Con ActorFactory y no cogiéndolo de CurrentActor tras un signIn(): el Actor
 * vive dentro de una petición, y fuera de ella llega con `role` y `tenantId` en
 * nulo. Ver docs/testing.md.
 */
function actorRetencion(Scenario $scenario, Role $rol): App\Authorization\Actor
{
    app(TenantContext::class)->set((string) $scenario->tenant->id);

    return app(ActorFactory::class)->for($scenario->user($rol)->fresh(), (string) $scenario->tenant->id);
}

/** Una notificación vieja, que es la fila más barata de fabricar para barrer. */
function notificacionDe(Scenario $scenario, CarbonImmutable $cuando): string
{
    $id = (string) Str::uuid();

    DB::table('notifications')->insert([
        'id' => $id,
        'tenant_id' => $scenario->tenant->id,
        'user_id' => $scenario->users[Role::Dispatcher->value]->id,
        'event_key' => 'document.expiring',
        'channel' => 'in_app',
        'locale' => 'es',
        'title' => 'Vieja',
        'body' => 'Cuerpo',
        'status' => 'sent',
        'created_at' => $cuando,
        'updated_at' => $cuando,
    ]);

    return $id;
}

/* ── La política ─────────────────────────────────────────────────────────── */

it('la política sale de los ajustes que la pantalla ya prometía', function () {
    // Las tres cifras se guardaban en `tenant_settings`, se pintaban en la
    // pantalla de configuración y NADIE las leía. Este lote existe porque esa
    // pantalla llevaba desde el primer día prometiendo algo que no ocurría.
    app(TenantContext::class)->runAs($this->scenario->tenant->id, fn () => DB::table('tenant_settings')
        ->where('tenant_id', $this->scenario->tenant->id)
        ->update([
            'operational_active_months' => 12,
            'operational_purge_years_after_archive' => 3,
            'financial_retention_years' => 7,
            'updated_at' => now(),
        ]));

    $p = Policy::forTenant((string) $this->scenario->tenant->id);

    expect($p->operationalActiveMonths)->toBe(12);
    expect($p->operationalPurgeYearsAfterArchive)->toBe(3);
    expect($p->financialRetentionYears)->toBe(7);
});

it('sin ajustes usa los valores de fábrica, no ceros', function () {
    // Un cero aquí significaría «archívalo todo ahora mismo», que es lo
    // contrario de lo que debe pasar cuando falta la configuración.
    $p = Policy::forTenant((string) Str::uuid());

    expect($p->operationalActiveMonths)->toBe(24);
    expect($p->financialRetentionYears)->toBe(7);
});

it('lo financiero espera más que lo operativo', function () {
    $p = new Policy(operationalActiveMonths: 24, operationalPurgeYearsAfterArchive: 5, financialRetentionYears: 7);
    $ahora = CarbonImmutable::parse('2026-08-31');

    expect($p->archiveCutoff('loads', $ahora)->toDateString())->toBe('2024-08-31');
    expect($p->archiveCutoff('invoices', $ahora)->toDateString())->toBe('2019-08-31');
});

it('la fecha de purga se guarda al archivar, no se recalcula después', function () {
    // Si se calculara al purgar, cambiar la política movería hacia atrás la
    // fecha de filas archivadas hace años, y un ajuste de configuración podría
    // borrar mañana lo que hoy estaba a salvo.
    $p = new Policy(24, 5, 7);
    $archivado = CarbonImmutable::parse('2026-01-15');

    expect($p->purgeEligibleAt('loads', $archivado)->toDateString())->toBe('2031-01-15');
});

/* ── Archivar ────────────────────────────────────────────────────────────── */

it('archiva lo que ha dejado de estar activo y deja lo reciente', function () {
    $tenantId = (string) $this->scenario->tenant->id;

    [$vieja, $nueva] = app(TenantContext::class)->runAs($tenantId, fn () => [
        notificacionDe($this->scenario, CarbonImmutable::now()->subYears(3)),
        notificacionDe($this->scenario, CarbonImmutable::now()->subMonth()),
    ]);

    Sweeper::archive($tenantId);

    $leer = fn (string $id) => app(TenantContext::class)->withoutTenant(
        fn () => DB::table('notifications')->where('id', $id)->first()
    );

    expect($leer($vieja)->archived_at)->not->toBeNull();
    expect($leer($vieja)->purge_eligible_at)->not->toBeNull();
    expect($leer($nueva)->archived_at)->toBeNull();
});

it('archivar es idempotente', function () {
    // El barrido corre cada domingo. Si la segunda pasada volviera a tocar lo ya
    // archivado, movería `purge_eligible_at` hacia el futuro cada semana y nada
    // se purgaría jamás.
    $tenantId = (string) $this->scenario->tenant->id;

    $id = app(TenantContext::class)->runAs($tenantId, fn () => notificacionDe($this->scenario, CarbonImmutable::now()->subYears(3)));

    Sweeper::archive($tenantId, CarbonImmutable::now());
    $primera = app(TenantContext::class)->withoutTenant(fn () => DB::table('notifications')->where('id', $id)->value('purge_eligible_at'));

    Sweeper::archive($tenantId, CarbonImmutable::now()->addDays(7));
    $segunda = app(TenantContext::class)->withoutTenant(fn () => DB::table('notifications')->where('id', $id)->value('purge_eligible_at'));

    expect((string) $segunda)->toBe((string) $primera);
});

it('no archiva lo que está bajo bloqueo legal', function () {
    $tenantId = (string) $this->scenario->tenant->id;
    $actor = actorRetencion($this->scenario, Role::Admin);

    $id = notificacionDe($this->scenario, CarbonImmutable::now()->subYears(3));

    Holds::apply($actor, 'Reclamación', 'Hay una reclamación abierta sobre esto.', 'entity_type', 'notifications');

    Sweeper::archive($tenantId);

    expect(app(TenantContext::class)->withoutTenant(
        fn () => DB::table('notifications')->where('id', $id)->value('archived_at')
    ))->toBeNull();
});

/* ── Bloqueo legal ───────────────────────────────────────────────────────── */

it('aplicar un bloqueo marca las filas, que es lo que nadie escribía', function () {
    // La columna `legal_hold` existe en treinta tablas y no la escribía nadie.
    // Una columna que nadie escribe es una columna que miente: quien mirara
    // `documents.legal_hold` y viera ceros concluiría que no hay bloqueos.
    $actor = actorRetencion($this->scenario, Role::Admin);
    $id = notificacionDe($this->scenario, CarbonImmutable::now()->subYears(3));

    Holds::apply($actor, 'Citación', 'Citación amplia, todavía no se sabe qué piden.', 'tenant');

    expect((int) DB::table('notifications')->where('id', $id)->value('legal_hold'))->toBe(1);
    expect((int) DB::table('loads')->where('id', $this->scenario->load->id)->value('legal_hold'))->toBe(1);
});

it('levantar un bloqueo no desprotege lo que otro sigue cubriendo', function () {
    // Dos reclamaciones sobre la misma carga es lo normal, no lo raro: el
    // cliente por un lado, el seguro por otro. Cerrar la primera dejaría la
    // carga desprotegida frente a la segunda si al levantar se pusiera
    // `legal_hold = 0` sin más.
    $actor = actorRetencion($this->scenario, Role::Admin);
    $id = notificacionDe($this->scenario, CarbonImmutable::now()->subYears(3));

    $primero = Holds::apply($actor, 'Cliente', 'Reclamación del cliente sobre la detención.', 'tenant');
    Holds::apply($actor, 'Seguro', 'El seguro pide el expediente completo.', 'entity_type', 'notifications');

    Holds::release($actor, $primero, 'El cliente retiró la reclamación por escrito.');

    expect((int) DB::table('notifications')->where('id', $id)->value('legal_hold'))->toBe(1);
});

it('levantar el último bloqueo sí libera las filas', function () {
    $actor = actorRetencion($this->scenario, Role::Admin);
    $id = notificacionDe($this->scenario, CarbonImmutable::now()->subYears(3));

    $unico = Holds::apply($actor, 'Cliente', 'Reclamación del cliente sobre la detención.', 'tenant');
    Holds::release($actor, $unico, 'El cliente retiró la reclamación por escrito.');

    expect((int) DB::table('notifications')->where('id', $id)->value('legal_hold'))->toBe(0);
});

it('aplicar y levantar quedan en la bitácora', function () {
    $actor = actorRetencion($this->scenario, Role::Admin);

    $id = Holds::apply($actor, 'Citación', 'Citación amplia del juzgado del condado.', 'tenant');
    Holds::release($actor, $id, 'El expediente se entregó y el juzgado lo cerró.');

    $acciones = app(TenantContext::class)->withoutTenant(fn () => DB::table('audit_events')
        ->where('entity_type', 'legal_hold')
        ->where('entity_id', $id)
        ->pluck('action')
        ->all());

    expect($acciones)->toContain('legal_hold.applied')->toContain('legal_hold.released');
});

it('un bloqueo por registro necesita saber cuál', function () {
    $actor = actorRetencion($this->scenario, Role::Admin);

    Holds::apply($actor, 'X', 'Un motivo suficientemente largo.', 'record', 'loads');
})->throws(InvalidArgumentException::class);

/* ── Purgar ──────────────────────────────────────────────────────────────── */

it('con la purga apagada no se borra nada, por vencido que esté', function () {
    // Apagada de fábrica. El coste de las dos equivocaciones no se parece:
    // purgar de menos deja unos gigabytes de más, purgar de más borra la prueba
    // de un pleito.
    $tenantId = (string) $this->scenario->tenant->id;

    $id = app(TenantContext::class)->runAs($tenantId, fn () => notificacionDe($this->scenario, CarbonImmutable::now()->subYears(20)));

    Sweeper::archive($tenantId, CarbonImmutable::now()->subYears(10));
    $resultado = Sweeper::purge(app(DocumentStore::class), $tenantId);

    expect($resultado)->toBe([]);
    expect(app(TenantContext::class)->withoutTenant(
        fn () => DB::table('notifications')->where('id', $id)->exists()
    ))->toBeTrue();
});

it('con la purga encendida borra lo vencido', function () {
    config(['retention.purge_enabled' => true]);
    $tenantId = (string) $this->scenario->tenant->id;

    $id = app(TenantContext::class)->runAs($tenantId, fn () => notificacionDe($this->scenario, CarbonImmutable::now()->subYears(20)));

    // Archivado hace diez años: su fecha de purga ya pasó.
    Sweeper::archive($tenantId, CarbonImmutable::now()->subYears(10));
    Sweeper::purge(app(DocumentStore::class), $tenantId);

    expect(app(TenantContext::class)->withoutTenant(
        fn () => DB::table('notifications')->where('id', $id)->exists()
    ))->toBeFalse();
});

it('la purga respeta el bloqueo legal aunque esté encendida', function () {
    config(['retention.purge_enabled' => true]);
    $tenantId = (string) $this->scenario->tenant->id;
    $actor = actorRetencion($this->scenario, Role::Admin);

    $id = notificacionDe($this->scenario, CarbonImmutable::now()->subYears(20));
    Sweeper::archive($tenantId, CarbonImmutable::now()->subYears(10));

    Holds::apply($actor, 'Pleito', 'Hay un pleito abierto y esto es prueba.', 'entity_type', 'notifications');

    $resultado = Sweeper::purge(app(DocumentStore::class), $tenantId);

    expect(app(TenantContext::class)->withoutTenant(
        fn () => DB::table('notifications')->where('id', $id)->exists()
    ))->toBeTrue();

    // Y se cuenta como saltado, que es para lo que existe la columna
    // `retention_jobs.skipped_legal_hold_count`.
    expect($resultado['notifications']['skipped'])->toBeGreaterThan(0);
});

it('nunca purga lo que un disparador prohíbe borrar', function () {
    // El esquema se contradice: estas tablas llevan `purge_eligible_at` Y un
    // disparador `before delete` que lanza SIGNAL. Gana el disparador. Un
    // barrido que lo intentara reventaría a mitad de la transacción y
    // arrastraría lo que llevara hecho.
    $p = new Policy(24, 5, 7);

    foreach (Policy::NEVER_PURGE as $tabla) {
        expect($p->canPurge($tabla))->toBeFalse("Se purgaría {$tabla}, que tiene disparador que lo prohíbe.");
    }

    // Y sin embargo esas tablas SÍ se archivan cuando están en la política.
    expect($p->archiveCutoff('financial_snapshots'))->not->toBeNull();
});

/* ── El rastro ───────────────────────────────────────────────────────────── */

it('cada pasada deja constancia en retention_jobs', function () {
    // La tabla existía desde el principio, con `skipped_legal_hold_count` y
    // todo, y nadie escribía en ella jamás.
    $tenantId = (string) $this->scenario->tenant->id;

    app(TenantContext::class)->runAs($tenantId, fn () => notificacionDe($this->scenario, CarbonImmutable::now()->subYears(3)));

    Sweeper::run(app(DocumentStore::class), $tenantId);

    $fila = app(TenantContext::class)->withoutTenant(fn () => DB::table('retention_jobs')
        ->where('tenant_id', $tenantId)
        ->where('entity_type', 'notifications')
        ->where('action', 'archive')
        ->first());

    expect($fila)->not->toBeNull();
    expect((string) $fila->status)->toBe('succeeded');
    expect((int) $fila->processed_count)->toBeGreaterThan(0);
});
