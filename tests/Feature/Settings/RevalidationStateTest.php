<?php

declare(strict_types=1);

use App\Enums\Role;
use App\Support\Fmcsa\RevalidationState;
use App\Support\Tenancy\TenantPolicy;
use App\Support\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Support\Scenario;

uses(DatabaseTransactions::class);

beforeEach(function () {
    app(TenantContext::class)->forget();
    $this->scenario = Scenario::create();
});

afterEach(fn () => app(TenantContext::class)->forget());

/* ── El estado dice la verdad ────────────────────────────────────────────── */

it('sin credenciales de FMCSA, el estado dice que no hay proveedor', function () {
    // El adaptador de demostración es el que está atado por omisión, y su
    // isLive() devuelve falso a propósito. Ese es el estado real de esta
    // instalación, y es lo que la pantalla tiene que enseñar.
    $estado = RevalidationState::for((string) $this->scenario->tenant->id);

    expect($estado['providerLive'])->toBeFalse();
});

it('cuenta los transportistas que llevan más del plazo sin comprobarse', function () {
    $tenantId = (string) $this->scenario->tenant->id;

    app(TenantContext::class)->runAs($tenantId, function () use ($tenantId): void {
        // Uno comprobado hoy y otro hace mucho.
        $ids = DB::table('carriers')->where('tenant_id', $tenantId)->pluck('id')->all();

        DB::table('carriers')->where('id', $ids[0])->update(['fmcsa_last_verified_at' => now()]);
        DB::table('carriers')->where('id', $ids[1])->update(['fmcsa_last_verified_at' => now()->subDays(90)]);
    });

    $estado = RevalidationState::for($tenantId);

    expect($estado['dueCount'])->toBe(1)
        ->and($estado['lastVerifiedAt'])->not->toBeNull();
});

it('un transportista que no se ha comprobado NUNCA también cuenta', function () {
    // NULL no es «al día». Sin esto, una empresa recién montada vería un cero
    // tranquilizador teniendo a todos sin comprobar.
    $tenantId = (string) $this->scenario->tenant->id;

    app(TenantContext::class)->runAs($tenantId, fn () => DB::table('carriers')
        ->where('tenant_id', $tenantId)->update(['fmcsa_last_verified_at' => null]));

    expect(RevalidationState::for($tenantId)['dueCount'])->toBe(2);
});

it('el plazo sale del ajuste de la empresa, no de una cifra fija', function () {
    $tenantId = (string) $this->scenario->tenant->id;

    app(TenantContext::class)->runAs($tenantId, fn () => DB::table('tenant_settings')
        ->where('tenant_id', $tenantId)->update(['fmcsa_reverification_days' => 90]));

    TenantPolicy::forget($tenantId);

    expect(RevalidationState::for($tenantId)['days'])->toBe(90);
});

it('un transportista comprobado hace 30 días está al día con plazo de 90', function () {
    // La misma fila cuenta o no según el ajuste. Es lo que hace falso decir
    // «cada 7 días» en una web que sirve a empresas con plazos distintos.
    $tenantId = (string) $this->scenario->tenant->id;

    app(TenantContext::class)->runAs($tenantId, function () use ($tenantId): void {
        DB::table('tenant_settings')->where('tenant_id', $tenantId)->update(['fmcsa_reverification_days' => 90]);
        DB::table('carriers')->where('tenant_id', $tenantId)->update(['fmcsa_last_verified_at' => now()->subDays(30)]);
    });

    TenantPolicy::forget($tenantId);

    expect(RevalidationState::for($tenantId)['dueCount'])->toBe(0);

    // TenantPolicy cachea por petición y `TenantSettingController` la invalida
    // al guardar. Escribiendo en la tabla a pelo hay que invalidarla a mano, o
    // esta prueba mediría la caché en vez del ajuste — y pasaría en verde
    // creyendo medir otra cosa.
    app(TenantContext::class)->runAs($tenantId, fn () => DB::table('tenant_settings')
        ->where('tenant_id', $tenantId)->update(['fmcsa_reverification_days' => 7]));

    TenantPolicy::forget($tenantId);

    expect(RevalidationState::for($tenantId)['dueCount'])->toBe(2);
});

/* ── Y llega a la pantalla ───────────────────────────────────────────────── */

it('la pantalla de ajustes lo recibe', function () {
    signIn($this->scenario, Role::Admin);

    $this->get('/settings')->assertOk()->assertInertia(function ($p) {
        $estado = $p->toArray()['props']['revalidation'];

        expect($estado['providerLive'])->toBeFalse()
            ->and($estado['days'])->toBeInt();
    });
});
