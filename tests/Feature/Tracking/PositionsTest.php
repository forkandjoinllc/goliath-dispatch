<?php

declare(strict_types=1);

use App\Enums\Role;
use App\Support\TenantContext;
use App\Support\Tracking\Consent;
use App\Support\Tracking\Ingestion;
use App\Support\Tracking\Timeline;
use App\Support\Tracking\TrackingLinks;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
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
 * Una carga con camión, conductor, cuenta de conductor y consentimiento vivo.
 *
 * Es lo mínimo para que `Sessions::iniciar` no se niegue, y montarlo entero
 * importa: media de estas piezas y la sesión no abre por un motivo que no tiene
 * nada que ver con lo que se está probando.
 */
function cargaRastreable(Scenario $scenario): string
{
    return app(TenantContext::class)->runAs($scenario->tenant->id, function () use ($scenario): string {
        $scenario->crew($scenario->load);

        $driverId = (string) DB::table('load_assignments')
            ->where('load_id', $scenario->load->id)
            ->whereNotNull('driver_id')
            ->value('driver_id');

        // El vínculo que la aplicación mantiene de verdad es la afiliación, no
        // `drivers.user_id`. Ver Consent::cuentaDe.
        DB::table('user_tenant_memberships')
            ->where('tenant_id', $scenario->tenant->id)
            ->where('user_id', $scenario->user(Role::Driver)->id)
            ->update(['driver_id' => $driverId]);

        DB::table('consent_records')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $scenario->tenant->id,
            'user_id' => $scenario->user(Role::Driver)->id,
            'consent_type' => Consent::TIPO,
            'policy_version' => Consent::VERSION,
            'granted' => 1,
            'locale' => 'es',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('loads')->where('id', $scenario->load->id)->update([
            'status' => 'in_transit',
            'updated_at' => now(),
        ]);

        return (string) $scenario->load->id;
    });
}

function tokenPublico(Scenario $scenario, string $loadId): string
{
    return app(TenantContext::class)->runAs($scenario->tenant->id, fn (): string => TrackingLinks::issue(
        tenantId: (string) $scenario->tenant->id,
        loadId: $loadId,
        label: 'Cliente',
        recipientEmail: null,
        ttlHours: null,
        createdByUserId: null,
    )['token']);
}

// ─────────────────────────────────────────────────────────────── la simulación

it('simular movimiento escribe sucesos y no los duplica al repetir', function () {
    $id = cargaRastreable($this->scenario);

    signIn($this->scenario, Role::Admin);

    $this->post("/loads/{$id}/tracking/start")->assertSessionHasNoErrors();
    $this->post("/loads/{$id}/tracking/simulate", ['minutes' => 300])->assertSessionHas('success');

    $primera = app(TenantContext::class)->runAs(
        $this->scenario->tenant->id,
        fn (): int => DB::table('tracking_events')->where('load_id', $id)->count(),
    );

    expect($primera)->toBeGreaterThan(0);

    // La misma simulación otra vez. La idempotencia la impone el índice único
    // (provider, raw_provider_reference), y la referencia lleva el índice del
    // suceso y no la hora de ahora: si llevara la hora, cada pulsación
    // duplicaría la línea de tiempo del cliente.
    $this->post("/loads/{$id}/tracking/simulate", ['minutes' => 300])->assertSessionHas('success');

    $segunda = app(TenantContext::class)->runAs(
        $this->scenario->tenant->id,
        fn (): int => DB::table('tracking_events')->where('load_id', $id)->count(),
    );

    expect($segunda)->toBe($primera);
});

it('sin sesión abierta no se simula nada', function () {
    $id = cargaRastreable($this->scenario);

    signIn($this->scenario, Role::Admin);

    $this->post("/loads/{$id}/tracking/simulate", ['minutes' => 60])
        ->assertSessionHas('error', __('tracking.errors.noOpenSession'));
});

it('el proveedor simulado no escribe ni una coordenada', function () {
    $id = cargaRastreable($this->scenario);

    signIn($this->scenario, Role::Admin);
    $this->post("/loads/{$id}/tracking/start");
    $this->post("/loads/{$id}/tracking/simulate", ['minutes' => 600]);

    app(TenantContext::class)->runAs($this->scenario->tenant->id, function () use ($id): void {
        expect(DB::table('tracking_events')->where('load_id', $id)->whereNotNull('latitude')->count())->toBe(0)
            ->and(DB::table('tracking_events')->where('load_id', $id)->whereNotNull('longitude')->count())->toBe(0);
    });
});

// ─────────────────────────────────────────────────────── la puerta del permiso

it('retirado el consentimiento no entra un parte más', function () {
    $id = cargaRastreable($this->scenario);

    signIn($this->scenario, Role::Admin);
    $this->post("/loads/{$id}/tracking/start");

    $sesionId = app(TenantContext::class)->runAs(
        $this->scenario->tenant->id,
        fn (): string => (string) DB::table('tracking_sessions')->where('load_id', $id)->value('id'),
    );

    // Se retira por la puerta de la aplicación: es lo que hace el conductor.
    signIn($this->scenario, Role::Driver);
    $driverId = app(TenantContext::class)->runAs(
        $this->scenario->tenant->id,
        fn (): string => (string) DB::table('user_tenant_memberships')
            ->where('user_id', $this->scenario->user(Role::Driver)->id)
            ->value('driver_id'),
    );
    $this->post("/drivers/{$driverId}/tracking-consent", ['action' => 'revoke'])->assertSessionHasNoErrors();

    // Y ahora llega un parte tardío, como llegaría por un webhook un segundo
    // después. Cerrar la sesión no basta: esto es el segundo cerrojo.
    $escritos = app(TenantContext::class)->runAs(
        $this->scenario->tenant->id,
        fn (): int => Ingestion::ingest(
            (string) $this->scenario->tenant->id,
            $sesionId,
            'mock',
            [new App\Services\Tracking\PositionReport(
                eventType: 'location_update',
                occurredAt: CarbonImmutable::now(),
                reference: 'tardio-1',
                locationLabel: 'Sitio prohibido',
            )],
        ),
    );

    expect($escritos)->toBe(0);

    app(TenantContext::class)->runAs($this->scenario->tenant->id, function () use ($id): void {
        expect(DB::table('tracking_events')->where('load_id', $id)->where('location_label', 'Sitio prohibido')->count())
            ->toBe(0);
    });
});

// ────────────────────────────────────────────────────────── lo que ve el cliente

it('la página del cliente enseña la última posición y lo que ha pasado', function () {
    $id = cargaRastreable($this->scenario);

    signIn($this->scenario, Role::Admin);

    $parada = app(TenantContext::class)->runAs($this->scenario->tenant->id, fn () => DB::table('load_stops')
        ->where('load_id', $id)->orderBy('sequence')->first(['id']));

    $this->post("/loads/{$id}/stops/{$parada->id}/progress", [
        'event' => 'arrived',
        'occurred_at' => CarbonImmutable::now()->subHour()->format('Y-m-d\TH:i'),
    ])->assertSessionHas('success');

    $token = tokenPublico($this->scenario, $id);
    app(TenantContext::class)->forget();

    $this->get("/t/{$token}")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            // Antes de este lote esto era null para siempre y la página decía
            // «aún no hay actualizaciones» con la carga ya en la parada.
            ->where('lastUpdate.location', 'Laredo, TX')
            ->where('lastUpdate.reportedByPerson', true)
            ->where('progress.done', 1)
            ->where('progress.total', 2)
            ->has('timeline', 1));
});

it('la página del cliente no enseña los sucesos del consentimiento', function () {
    $id = cargaRastreable($this->scenario);

    // Un suceso de consentimiento colgado de la carga, como los escribe Consent.
    app(TenantContext::class)->runAs($this->scenario->tenant->id, function () use ($id): void {
        $sesionId = (string) Str::uuid();

        DB::table('tracking_sessions')->insert([
            'id' => $sesionId,
            'tenant_id' => $this->scenario->tenant->id,
            'load_id' => $id,
            'provider' => 'mock',
            'started_at' => now(),
            'health_status' => 'unknown',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('tracking_events')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $this->scenario->tenant->id,
            'session_id' => $sesionId,
            'load_id' => $id,
            'provider' => 'manual',
            'event_type' => 'consent_revoked',
            'location_label' => null,
            'raw_provider_reference' => 'consent-1',
            'occurred_at' => now(),
            'ingested_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        // El panel de despacho SÍ lo ve: es de su empresa y de su conductor.
        expect(Timeline::paraDespacho((string) $this->scenario->tenant->id, $id))->toHaveCount(1);

        // El cliente no. Es asunto entre el conductor y su empresa.
        expect(Timeline::paraCliente((string) $this->scenario->tenant->id, $id))->toHaveCount(0);
    });
});

it('el panel enseña el resumen de la sesión y dice que no hay proveedor', function () {
    $id = cargaRastreable($this->scenario);

    signIn($this->scenario, Role::Admin);
    $this->post("/loads/{$id}/tracking/start");
    $this->post("/loads/{$id}/tracking/simulate", ['minutes' => 120]);

    $this->get("/loads/{$id}/tracking")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->where('session.running', true)
            ->where('session.providerIsLive', false)
            // La llegada estimada NO se calcula: sin millas de ruta, cualquier
            // estimación sería una hora inventada que alguien le promete a un
            // cliente. La pantalla lo dice con `session.noEta`.
            ->where('session.etaAt', null)
            ->whereNot('session.lastLocation', null));
});

it('con un proveedor de verdad atado no se simula nada', function () {
    $id = cargaRastreable($this->scenario);

    signIn($this->scenario, Role::Admin);
    $this->post("/loads/{$id}/tracking/start");

    // Un proveedor que dice ser de verdad. Meter sucesos inventados en la misma
    // tabla donde entran los suyos contaminaría el único sitio donde se puede
    // comprobar qué pasó de verdad.
    app()->instance(App\Services\Tracking\TrackingProvider::class, new class implements App\Services\Tracking\TrackingProvider
    {
        public function name(): string
        {
            return 'macropoint';
        }

        public function isLive(): bool
        {
            return true;
        }

        public function poll(array $sesion): array
        {
            return [];
        }
    });

    $this->post("/loads/{$id}/tracking/simulate", ['minutes' => 120])
        ->assertSessionHas('error', __('tracking.errors.simulationNotAvailable'));

    app(TenantContext::class)->runAs($this->scenario->tenant->id, function () use ($id): void {
        // Ni un suceso del simulador. El `session_started` que escribe abrir la
        // sesión sí está, y es de `manual`: lo anotó una persona.
        expect(DB::table('tracking_events')->where('load_id', $id)->where('provider', 'mock')->count())->toBe(0)
            ->and(DB::table('tracking_events')->where('load_id', $id)->where('provider', 'manual')->count())->toBe(1);
    });

    // Y el panel tampoco enseña el botón, que es la otra mitad: un control que
    // el servidor va a rechazar no debe estar en la pantalla.
    $this->get("/loads/{$id}/tracking")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page->where('session.canSimulate', false));
});
