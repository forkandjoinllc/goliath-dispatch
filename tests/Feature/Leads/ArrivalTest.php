<?php

declare(strict_types=1);

use App\Console\Commands\SweepNotifications;
use App\Enums\Role;
use App\Models\Lead;
use App\Support\Leads\Arrival;
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
});

afterEach(fn () => app(TenantContext::class)->forget());

/**
 * Un prospecto de esa empresa, con la antigüedad que se pida.
 *
 * Con nombre propio y no `prospecto()`: Pest carga todos los ficheros de prueba
 * en un único espacio global, y `tests/Feature/Leads/LeadTest.php` ya tiene una
 * `prospecto()`. Dos funciones de primer nivel con el mismo nombre son un fatal
 * que se lleva por delante la suite ENTERA — y solo aparece al correrla entera,
 * nunca al correr este fichero solo.
 */
function prospectoDeAviso(Scenario $scenario, ?string $tenantId, string $creado, string $estado = 'new', ?string $asignado = null): string
{
    $id = (string) Str::uuid();

    DB::table('leads')->insert([
        'id' => $id,
        'tenant_id' => $tenantId,
        'first_name' => 'Rosa',
        'last_name' => 'Mendieta',
        'email' => 'rosa@transportista.test',
        'company_name' => 'Mendieta Trucking LLC',
        'locale' => 'es',
        'source' => 'carrier_signup',
        'status' => $estado,
        'assigned_to_user_id' => $asignado,
        'created_at' => $creado,
        'updated_at' => $creado,
    ]);

    return $id;
}

/* ── Un día hábil no son veinticuatro horas ─────────────────────────────── */

it('el lunes cuenta desde el viernes, no desde el domingo', function () {
    // Un alta que entra el viernes por la tarde no lleva un día hábil sin
    // atender el sábado. Contando horas a secas, el barrido del sábado avisaría
    // de un incumplimiento que no ha ocurrido.
    $lunes = CarbonImmutable::parse('2026-09-07 06:00');  // lunes

    expect(SweepNotifications::unDiaHabilAntes($lunes)->toDateString())->toBe('2026-09-04'); // viernes

    $martes = CarbonImmutable::parse('2026-09-08 06:00');
    expect(SweepNotifications::unDiaHabilAntes($martes)->toDateString())->toBe('2026-09-07');

    $domingo = CarbonImmutable::parse('2026-09-06 06:00');
    expect(SweepNotifications::unDiaHabilAntes($domingo)->toDateString())->toBe('2026-09-04');
});

/* ── Llega un prospecto: alguien se entera ──────────────────────────────── */

it('el alta pública de transportista avisa a quien puede ver prospectos', function () {
    // La página le dice a un desconocido que le responderán en un día hábil.
    // Hasta este lote no se lo contaba nadie.
    $tenantId = (string) $this->scenario->tenant->id;

    app(TenantContext::class)->runAs($tenantId, function () use ($tenantId) {
        $id = prospectoDeAviso($this->scenario, $tenantId, now()->toDateTimeString());
        $lead = Lead::query()->findOrFail($id);

        Arrival::announce($lead, $tenantId);
    });

    $aviso = DB::table('notifications')->where('event_key', 'lead.received')->first();

    expect($aviso)->not->toBeNull()
        ->and((string) $aviso->tenant_id)->toBe($tenantId);
});

it('un prospecto sin empresa no inventa una para poder avisar', function () {
    // `notifications.tenant_id` es NOT NULL. Meter ahí una empresa cualquiera
    // para que quepa el aviso sería exactamente la mentira que
    // CarrierSignupController se niega a contar.
    $tenantId = (string) $this->scenario->tenant->id;

    app(TenantContext::class)->runAs($tenantId, function () {
        $id = prospectoDeAviso($this->scenario, null, now()->toDateTimeString());
        $lead = Lead::withoutGlobalScopes()->findOrFail($id);

        expect(Arrival::announce($lead, null))->toBe(0);
    });

    expect(DB::table('notifications')->where('event_key', 'lead.received')->count())->toBe(0);
});

/* ── Y si nadie lo coge, se vuelve a avisar ─────────────────────────────── */

it('el barrido persigue lo que lleva más de un día hábil sin coger', function () {
    $tenantId = (string) $this->scenario->tenant->id;

    app(TenantContext::class)->runAs($tenantId, fn () => prospectoDeAviso(
        $this->scenario, $tenantId, now()->subDays(5)->toDateTimeString()
    ));

    $this->artisan('notifications:sweep', ['--tenant' => $tenantId])->assertSuccessful();

    expect(DB::table('notifications')->where('event_key', 'lead.unattended')->count())->toBeGreaterThan(0);
});

it('lo que acaba de entrar no se persigue', function () {
    $tenantId = (string) $this->scenario->tenant->id;

    app(TenantContext::class)->runAs($tenantId, fn () => prospectoDeAviso(
        $this->scenario, $tenantId, now()->toDateTimeString()
    ));

    $this->artisan('notifications:sweep', ['--tenant' => $tenantId])->assertSuccessful();

    expect(DB::table('notifications')->where('event_key', 'lead.unattended')->count())->toBe(0);
});

it('lo que ya tiene dueño no se persigue', function () {
    // Un prospecto asignado ya lo cogió alguien aunque siga en `new`.
    // Perseguir a quien ya lo tiene es la clase de aviso que enseña a ignorar
    // la campana.
    $tenantId = (string) $this->scenario->tenant->id;
    $usuario = (string) $this->scenario->user(Role::Admin)->id;

    app(TenantContext::class)->runAs($tenantId, fn () => prospectoDeAviso(
        $this->scenario, $tenantId, now()->subDays(5)->toDateTimeString(), 'new', $usuario
    ));

    $this->artisan('notifications:sweep', ['--tenant' => $tenantId])->assertSuccessful();

    expect(DB::table('notifications')->where('event_key', 'lead.unattended')->count())->toBe(0);
});

it('avisa una sola vez por prospecto, no cada mañana', function () {
    $tenantId = (string) $this->scenario->tenant->id;

    app(TenantContext::class)->runAs($tenantId, fn () => prospectoDeAviso(
        $this->scenario, $tenantId, now()->subDays(5)->toDateTimeString()
    ));

    $this->artisan('notifications:sweep', ['--tenant' => $tenantId])->assertSuccessful();
    $primera = DB::table('notifications')->where('event_key', 'lead.unattended')->count();

    $this->artisan('notifications:sweep', ['--tenant' => $tenantId])->assertSuccessful();

    // Una campana que repite deja de mirarse.
    expect(DB::table('notifications')->where('event_key', 'lead.unattended')->count())->toBe($primera);
});

/* ── El caso que la campana no alcanza ──────────────────────────────────── */

it('la pantalla de la plataforma cuenta los prospectos sin empresa', function () {
    app(TenantContext::class)->forget();
    prospectoDeAviso($this->scenario, null, now()->subDays(3)->toDateTimeString());

    signIn($this->scenario, Role::PlatformSuperAdmin);

    $this->get('/platform/health')->assertOk()->assertInertia(function ($p) {
        $huerfanos = $p->toArray()['props']['orphanLeads'];

        expect($huerfanos['count'])->toBeGreaterThan(0)
            // Un contador sin fecha no distingue tres de esta mañana de tres de
            // hace tres semanas.
            ->and($huerfanos['oldestAt'])->not->toBeNull();
    });
});
