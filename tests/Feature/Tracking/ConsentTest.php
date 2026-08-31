<?php

declare(strict_types=1);

use App\Enums\Role;
use App\Support\TenantContext;
use App\Support\Tracking\Consent;
use App\Support\Tracking\Sessions;
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
 * Engancha al usuario conductor del escenario con una ficha de conductor.
 *
 * Por la AFILIACIÓN, que es el vínculo que la aplicación mantiene — el mismo
 * que lee ActorFactory para dar `Actor::driverId`.
 */
function conductorPropio(Scenario $scenario): string
{
    $driverId = (string) Str::uuid();

    DB::table('drivers')->insert([
        'id' => $driverId,
        'tenant_id' => $scenario->tenant->id,
        'first_name' => 'Propio',
        'last_name' => 'Conductor',
        'license_state' => 'TX',
        'license_number_hash' => hash('sha256', Str::random(16)),
        'license_number_last4' => '0009',
        'cdl_class' => 'A',
        'license_expires_at' => now()->addYear(),
        'medical_card_expires_at' => now()->addYear(),
        'status' => 'available',
        'created_at' => now(),
        'updated_at' => now(),
    ]);

    DB::table('user_tenant_memberships')
        ->where('tenant_id', $scenario->tenant->id)
        ->where('user_id', $scenario->user(Role::Driver)->id)
        ->update(['driver_id' => $driverId]);

    return $driverId;
}

// ──────────────────────────────────────────────────────────── el consentimiento

it('sin consentimiento no se puede rastrear', function () {
    $driverId = conductorPropio($this->scenario);

    expect(Consent::permiteRastrear((string) $this->scenario->tenant->id, $driverId))->toBeFalse();
});

it('el conductor otorga el suyo y queda constancia de sobre qué texto', function () {
    $driverId = conductorPropio($this->scenario);

    signIn($this->scenario, Role::Driver);

    $this->post("/drivers/{$driverId}/tracking-consent", ['action' => 'grant'])
        ->assertSessionHasNoErrors();

    $fila = DB::table('consent_records')->where('consent_type', 'tracking_location')->first();

    expect($fila)->not->toBeNull()
        ->and($fila->granted)->toBe(1)
        // Sobre QUÉ texto. Un consentimiento sin versión no dice qué se aceptó.
        ->and($fila->policy_version)->toBe(Consent::VERSION)
        ->and($fila->locale)->not->toBeNull()
        ->and($fila->revoked_at)->toBeNull();

    expect(Consent::permiteRastrear((string) $this->scenario->tenant->id, $driverId))->toBeTrue();
});

it('un consentimiento sobre un texto viejo no vale', function () {
    // La versión es lo que hace que cambiar la redacción obligue a volver a
    // preguntar. Sin esto, una frase nueva se daría por consentida con el «sí»
    // que alguien dio a otra cosa.
    $driverId = conductorPropio($this->scenario);
    $userId = (string) $this->scenario->user(Role::Driver)->id;

    DB::table('consent_records')->insert([
        'id' => (string) Str::uuid(),
        'tenant_id' => $this->scenario->tenant->id,
        'user_id' => $userId,
        'consent_type' => 'tracking_location',
        'policy_version' => 'una-version-vieja',
        'granted' => 1,
        'locale' => 'es',
        'created_at' => now(),
        'updated_at' => now(),
    ]);

    expect(Consent::permiteRastrear((string) $this->scenario->tenant->id, $driverId))->toBeFalse();
});

it('nadie puede otorgarlo por otro, ni un administrador', function () {
    // No es una limitación que haya que arreglar: alguien marcando la casilla
    // por otro no es esa persona consintiendo.
    $driverId = conductorPropio($this->scenario);

    signIn($this->scenario, Role::Admin);

    $this->post("/drivers/{$driverId}/tracking-consent", ['action' => 'grant'])
        ->assertRedirect();

    expect(DB::table('consent_records')->count())->toBe(0);
});

// ──────────────────────────────────────────────────────────────────── la puerta

it('no arranca el rastreo sin consentimiento', function () {
    $driverId = conductorPropio($this->scenario);
    $this->scenario->crew($this->scenario->load);

    DB::table('load_assignments')
        ->where('load_id', $this->scenario->load->id)
        ->whereNotNull('driver_id')
        ->update(['driver_id' => $driverId]);

    signIn($this->scenario, Role::Admin);

    $this->post("/loads/{$this->scenario->load->id}/tracking/start")
        ->assertSessionHas('error', __('tracking.errors.trackingConsentMissing'));

    expect(DB::table('tracking_sessions')->count())->toBe(0);
});

it('con consentimiento arranca, y la sesión guarda bajo cuál', function () {
    $driverId = conductorPropio($this->scenario);
    $this->scenario->crew($this->scenario->load);

    DB::table('load_assignments')
        ->where('load_id', $this->scenario->load->id)
        ->whereNotNull('driver_id')
        ->update(['driver_id' => $driverId]);

    signIn($this->scenario, Role::Driver);
    $this->post("/drivers/{$driverId}/tracking-consent", ['action' => 'grant']);

    signIn($this->scenario, Role::Admin);
    $this->post("/loads/{$this->scenario->load->id}/tracking/start")
        ->assertSessionHasNoErrors();

    $sesion = DB::table('tracking_sessions')->first();

    expect($sesion)->not->toBeNull()
        ->and($sesion->ended_at)->toBeNull()
        // Bajo QUÉ consentimiento se abrió, no solo que lo hubiera.
        ->and($sesion->consent_user_id)->toBe((string) $this->scenario->user(Role::Driver)->id)
        ->and($sesion->consent_granted_at)->not->toBeNull();
});

// ──────────────────────────────────────────────────────────────── la retirada

it('retirarlo para el rastreo y corta los enlaces públicos vivos', function () {
    // «Se detiene de inmediato» es la mitad de la frase que importa. Y el enlace
    // público es cómo un cliente ve dónde está el camión: pararlo por dentro y
    // seguir enseñándolo por fuera sería no haberlo parado.
    $driverId = conductorPropio($this->scenario);
    $this->scenario->crew($this->scenario->load);

    DB::table('load_assignments')
        ->where('load_id', $this->scenario->load->id)
        ->whereNotNull('driver_id')
        ->update(['driver_id' => $driverId]);

    signIn($this->scenario, Role::Driver);
    $this->post("/drivers/{$driverId}/tracking-consent", ['action' => 'grant']);

    signIn($this->scenario, Role::Admin);
    $this->post("/loads/{$this->scenario->load->id}/tracking/start")->assertSessionHasNoErrors();
    $this->post("/loads/{$this->scenario->load->id}/tracking-links", ['label' => 'Cliente'])
        ->assertSessionHasNoErrors();

    expect(DB::table('public_tracking_links')->whereNull('revoked_at')->count())->toBe(1);

    signIn($this->scenario, Role::Driver);
    $this->post("/drivers/{$driverId}/tracking-consent", ['action' => 'revoke'])
        ->assertSessionHasNoErrors();

    expect(DB::table('tracking_sessions')->whereNull('ended_at')->count())->toBe(0)
        ->and(DB::table('tracking_sessions')->whereNotNull('consent_revoked_at')->count())->toBe(1)
        ->and(DB::table('public_tracking_links')->whereNull('revoked_at')->count())->toBe(0)
        ->and(Consent::permiteRastrear((string) $this->scenario->tenant->id, $driverId))->toBeFalse();
});

it('un conductor sin cuenta de acceso no puede consentir, y no se le rastrea', function () {
    // Y la pantalla lo dice, en vez de dejar un botón que no hace nada.
    $driverId = (string) Str::uuid();

    DB::table('drivers')->insert([
        'id' => $driverId,
        'tenant_id' => $this->scenario->tenant->id,
        'first_name' => 'Sin',
        'last_name' => 'Cuenta',
        'license_state' => 'TX',
        'license_number_hash' => hash('sha256', Str::random(16)),
        'license_number_last4' => '0010',
        'cdl_class' => 'A',
        'license_expires_at' => now()->addYear(),
        'medical_card_expires_at' => now()->addYear(),
        'status' => 'available',
        'created_at' => now(),
        'updated_at' => now(),
    ]);

    expect(Consent::cuentaDe((string) $this->scenario->tenant->id, $driverId))->toBeNull()
        ->and(Consent::permiteRastrear((string) $this->scenario->tenant->id, $driverId))->toBeFalse();
});
