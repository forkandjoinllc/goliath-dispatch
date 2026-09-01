<?php

declare(strict_types=1);

use App\Services\Fmcsa\FmcsaDirectory;
use App\Services\Fmcsa\FmcsaVerifier;
use App\Support\Fmcsa\Revalidation;
use App\Support\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Tests\Support\Scenario;

uses(DatabaseTransactions::class);

beforeEach(function () {
    app(TenantContext::class)->forget();
    $this->scenario = Scenario::create();
});

afterEach(function () {
    config()->set('services.fmcsa.web_key', null);
    app()->forgetInstance(FmcsaDirectory::class);
    app()->forgetInstance(FmcsaVerifier::class);
    app(TenantContext::class)->forget();
});

/** Ata el adaptador REAL, con la red interceptada. */
function conProveedorEnVivo(?string $legalName = null): void
{
    config()->set('services.fmcsa.web_key', 'clave-de-prueba');
    app()->forgetInstance(FmcsaDirectory::class);
    app()->forgetInstance(FmcsaVerifier::class);

    // El nombre se hace coincidir cuando la prueba necesita un `verified`: si no
    // coincide el resultado es `mismatch`, que es correcto y no sirve para mirar
    // la fecha de la siguiente comprobación.
    Http::fake(['*' => Http::response(['content' => [
        'carrier' => [
            'legalName' => $legalName ?? 'CUALQUIER TRANSPORTISTA LLC',
            'dotNumber' => 1234567,
            'allowedToOperate' => 'Y',
            'statusCode' => 'A',
        ],
    ]], 200)]);
}

it('sin proveedor en vivo NO se inventa una comprobación', function () {
    // Anotar una verificación «simulada» con fecha de hoy sería peor que no
    // revalidar: dejaría a todos los transportistas con la marca al día y a
    // nadie comprobado, y el aviso que hoy sí funciona dejaría de saltar.
    $antes = DB::table('fmcsa_verifications')->count();

    $resultado = Revalidation::sweep(
        (string) $this->scenario->tenant->id,
        app(FmcsaVerifier::class),
        app(FmcsaDirectory::class),
    );

    expect($resultado['live'])->toBeFalse()
        ->and($resultado['checked'])->toBe(0)
        ->and(DB::table('fmcsa_verifications')->count())->toBe($antes);
});

it('con proveedor en vivo revalida a los caducados', function () {
    // La frase del sitio público: «se revalida automáticamente cada 7 días
    // mientras esté activo, no solo una vez al registrarse». Hasta el lote 60 el
    // barrido solo AVISABA de que tocaba.
    conProveedorEnVivo();

    $tenantId = (string) $this->scenario->tenant->id;

    expect(Revalidation::due($tenantId))->not->toBeEmpty();

    $antes = DB::table('fmcsa_verifications')->count();

    $resultado = Revalidation::sweep($tenantId, app(FmcsaVerifier::class), app(FmcsaDirectory::class));

    expect($resultado['live'])->toBeTrue()
        ->and($resultado['checked'])->toBeGreaterThan(0)
        ->and(DB::table('fmcsa_verifications')->count())->toBeGreaterThan($antes)
        // Y ya no queda nadie por revalidar.
        ->and(Revalidation::due($tenantId))->toBeEmpty();
});

it('cuenta el intento en vez de decir siempre uno', function () {
    conProveedorEnVivo();

    $tenantId = (string) $this->scenario->tenant->id;
    $carrier = DB::table('carriers')->where('tenant_id', $tenantId)->first();

    Revalidation::runFor($carrier, app(FmcsaVerifier::class));
    Revalidation::runFor($carrier, app(FmcsaVerifier::class));

    $intentos = DB::table('fmcsa_verifications')
        ->where('carrier_id', $carrier->id)
        ->orderByDesc('attempt')
        ->value('attempt');

    expect($intentos)->toBeGreaterThan(1);
});

it('la fecha de la próxima sale del plazo de la empresa, no de un año', function () {
    // `fmcsa_next_verification_at` se escribía a «dentro de un año» y la pantalla
    // lo enseñaba, mientras el barrido daba por caducado a los siete días. Dos
    // números contradiciéndose, los dos a la vista.
    $tenantId = (string) $this->scenario->tenant->id;
    $carrierRow = DB::table('carriers')->where('tenant_id', $tenantId)->first();

    conProveedorEnVivo((string) $carrierRow->legal_name);

    app(TenantContext::class)->withoutTenant(fn () => DB::table('tenant_settings')
        ->where('tenant_id', $tenantId)
        ->update(['fmcsa_reverification_days' => 10, 'updated_at' => now()]));

    Revalidation::runFor($carrierRow, app(FmcsaVerifier::class));

    $siguiente = DB::table('carriers')->where('id', $carrierRow->id)->value('fmcsa_next_verification_at');

    expect($siguiente)->not->toBeNull()
        // Diez días, no trescientos sesenta y cinco.
        ->and(now()->diffInDays($siguiente))->toBeLessThan(30);
});

it('el barrido revalida ANTES de avisar', function () {
    // Avisar primero llenaría la bandeja de recordatorios sobre transportistas
    // que ese mismo barrido está a punto de poner al día.
    conProveedorEnVivo();

    $this->artisan('notifications:sweep')->assertSuccessful();

    expect(Revalidation::due((string) $this->scenario->tenant->id))->toBeEmpty()
        ->and(DB::table('notifications')
            ->where('event_key', 'carrier.reverification_due')
            ->count())->toBe(0);
});
