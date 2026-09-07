<?php

declare(strict_types=1);

use App\Enums\Role;
use App\Support\Loads\RateResponse;
use App\Support\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Tests\Support\Scenario;

uses(DatabaseTransactions::class);

beforeEach(function () {
    app(TenantContext::class)->forget();
    Mail::fake();
    $this->scenario = Scenario::create();
});

afterEach(fn () => app(TenantContext::class)->forget());

/**
 * Deja la carga lista para emitir y emite la confirmación.
 *
 * Con nombre propio y no `cargaConTarifa()`: Pest carga todos los ficheros de
 * prueba en un espacio global y `RateConfirmationTest.php` ya tiene una con ese
 * nombre. Dos funciones de primer nivel iguales son un fatal que se lleva la
 * suite entera — y solo aparece al correrla entera.
 */
function cargaConPapel(Scenario $scenario, int $centavos = 250000): string
{
    DB::table('loads')->where('id', $scenario->load->id)->update([
        'carrier_id' => $scenario->assignedCarrier->id,
        'carrier_gross_rate_cents' => $centavos,
        'customer_charge_cents' => 300000,
        'updated_at' => now(),
    ]);

    $id = (string) $scenario->load->id;

    signIn($scenario, Role::Admin);
    test()->post("/loads/{$id}/rate-confirmation")->assertRedirect();

    return $id;
}

/** Envejece el papel de una carga. */
function envejecePapel(string $loadId, int $dias): void
{
    DB::table('documents')
        ->where('owner_type', 'load')
        ->where('owner_id', $loadId)
        ->where('document_type', 'rate_confirmation')
        ->update(['created_at' => now()->subDays($dias)]);
}

/**
 * Cuántos avisos hay de un suceso.
 *
 * `avisosDeTarifa` y no `avisosDe`: esa ya existe en
 * `tests/Feature/Notifications/SweepTest.php`, y dos funciones de primer nivel
 * con el mismo nombre son un fatal que se lleva la suite ENTERA. Segunda vez
 * en tres lotes; el espacio global de Pest no perdona.
 */
function avisosDeTarifa(string $suceso): int
{
    return DB::table('notifications')->where('event_key', $suceso)->count();
}

/* ── Contestar llega a despacho ──────────────────────────────────────────── */

it('rechazar la tarifa se lo cuenta a despacho, con el motivo', function () {
    // La pantalla le pide el motivo al transportista diciéndole que sin él
    // «despacho tiene que llamar para averiguar qué pasó». Hasta este lote,
    // escribirlo no ahorraba ninguna llamada.
    $id = cargaConPapel($this->scenario);

    signIn($this->scenario, Role::Carrier);
    $this->post("/loads/{$id}/rate-confirmation/decide", [
        'decision' => 'rejected',
        'reason' => 'Esa tarifa no cubre el peaje de la I-10.',
    ])->assertRedirect();

    $aviso = DB::table('notifications')->where('event_key', 'load.rateconf.rejected')->first();

    expect($aviso)->not->toBeNull()
        ->and((string) $aviso->action_url)->toBe("/loads/{$id}/rate-confirmation")
        // El motivo viaja DENTRO del aviso: sin él hay que abrir la carga para
        // saber si es la tarifa o las fechas.
        ->and((string) $aviso->body)->toContain('no cubre el peaje');
});

it('pedir cambios también llega, y con su propio suceso', function () {
    $id = cargaConPapel($this->scenario);

    signIn($this->scenario, Role::Carrier);
    $this->post("/loads/{$id}/rate-confirmation/decide", [
        'decision' => 'changes_requested',
        'reason' => 'Podemos hacerla si sale el jueves en vez del miércoles.',
    ])->assertRedirect();

    expect(avisosDeTarifa('load.rateconf.changes_requested'))->toBeGreaterThan(0)
        ->and(avisosDeTarifa('load.rateconf.rejected'))->toBe(0);
});

it('aceptar también se cuenta: es la señal de que la carga puede moverse', function () {
    $id = cargaConPapel($this->scenario);

    signIn($this->scenario, Role::Carrier);
    $this->post("/loads/{$id}/rate-confirmation/decide", ['decision' => 'accepted'])->assertRedirect();

    expect(avisosDeTarifa('load.rateconf.accepted'))->toBeGreaterThan(0);
});

it('el motivo larguísimo no se pega entero en el aviso', function () {
    $id = cargaConPapel($this->scenario);

    signIn($this->scenario, Role::Carrier);
    $this->post("/loads/{$id}/rate-confirmation/decide", [
        'decision' => 'rejected',
        // Por debajo del `max:2000` de la validación y muy por encima de los
        // 160 del recorte. Con 2200 la petición ni siquiera pasaba, y la
        // prueba habría medido «no hay aviso» creyendo medir el recorte.
        'reason' => str_repeat('no nos sale la cuenta ', 80),
    ])->assertRedirect();

    $aviso = DB::table('notifications')->where('event_key', 'load.rateconf.rejected')->first();

    expect(mb_strlen((string) $aviso->body))->toBeLessThan(400);
});

it('la decisión queda anotada aunque no haya nadie a quien avisar', function () {
    // El aviso va después de anotar, justamente para esto: la decisión la tomó
    // una persona y compromete dinero.
    $id = cargaConPapel($this->scenario);

    signIn($this->scenario, Role::Carrier);

    DB::table('user_tenant_memberships')
        ->where('tenant_id', $this->scenario->tenant->id)
        ->whereIn('role', ['admin', 'accounting'])
        ->update(['status' => 'suspended']);

    $this->post("/loads/{$id}/rate-confirmation/decide", [
        'decision' => 'rejected',
        'reason' => 'No nos encaja.',
    ])->assertRedirect();

    expect(DB::table('rate_confirmation_acceptances')->where('load_id', $id)->count())->toBe(1);
});

it('rechazar hoy y aceptar la reemisión de mañana suenan las dos veces', function () {
    // Con la carga sola en la clave de deduplicación, la segunda decisión no
    // sonaría — y la segunda es la que dice que la carga puede moverse.
    $id = cargaConPapel($this->scenario, 250000);

    signIn($this->scenario, Role::Carrier);
    $this->post("/loads/{$id}/rate-confirmation/decide", [
        'decision' => 'rejected', 'reason' => 'Muy baja.',
    ])->assertRedirect();

    // Despacho sube la tarifa y reemite.
    signIn($this->scenario, Role::Admin);
    DB::table('loads')->where('id', $id)->update(['carrier_gross_rate_cents' => 320000]);
    $this->post("/loads/{$id}/rate-confirmation")->assertRedirect();

    signIn($this->scenario, Role::Carrier);
    $this->post("/loads/{$id}/rate-confirmation/decide", ['decision' => 'accepted'])->assertRedirect();

    expect(avisosDeTarifa('load.rateconf.rejected'))->toBeGreaterThan(0)
        ->and(avisosDeTarifa('load.rateconf.accepted'))->toBeGreaterThan(0);
});

/* ── Lo que nadie contesta ───────────────────────────────────────────────── */

it('el barrido avisa de una confirmación que lleva días sin respuesta', function () {
    $id = cargaConPapel($this->scenario);
    envejecePapel($id, 5);

    $this->artisan('notifications:sweep', ['--tenant' => (string) $this->scenario->tenant->id])
        ->assertSuccessful();

    expect(avisosDeTarifa(RateResponse::SIN_CONTESTAR))->toBeGreaterThan(0);
});

it('lo que se mandó anteayer todavía no se persigue', function () {
    // Menos plazo convierte el aviso en una prisa sobre alguien que quizá está
    // mirando el papel ahora mismo.
    $id = cargaConPapel($this->scenario);
    envejecePapel($id, 2);

    $this->artisan('notifications:sweep', ['--tenant' => (string) $this->scenario->tenant->id])
        ->assertSuccessful();

    expect(avisosDeTarifa(RateResponse::SIN_CONTESTAR))->toBe(0);
});

it('lo que ya contestaron no se persigue', function () {
    $id = cargaConPapel($this->scenario);

    signIn($this->scenario, Role::Carrier);
    $this->post("/loads/{$id}/rate-confirmation/decide", ['decision' => 'accepted'])->assertRedirect();

    envejecePapel($id, 5);

    $this->artisan('notifications:sweep', ['--tenant' => (string) $this->scenario->tenant->id])
        ->assertSuccessful();

    expect(avisosDeTarifa(RateResponse::SIN_CONTESTAR))->toBe(0);
});

it('una respuesta al papel VIEJO no da por contestada la reemisión', function () {
    // Si despacho reemite con otra tarifa, lo que hace falta es la respuesta al
    // papel nuevo. Cruzar por carga daría por contestada una reemisión que
    // nadie ha mirado — y eso es exactamente la carga que se queda parada.
    $id = cargaConPapel($this->scenario, 250000);

    signIn($this->scenario, Role::Carrier);
    $this->post("/loads/{$id}/rate-confirmation/decide", ['decision' => 'accepted'])->assertRedirect();

    signIn($this->scenario, Role::Admin);
    DB::table('loads')->where('id', $id)->update(['carrier_gross_rate_cents' => 320000]);
    $this->post("/loads/{$id}/rate-confirmation")->assertRedirect();

    envejecePapel($id, 5);

    $this->artisan('notifications:sweep', ['--tenant' => (string) $this->scenario->tenant->id])
        ->assertSuccessful();

    expect(avisosDeTarifa(RateResponse::SIN_CONTESTAR))->toBeGreaterThan(0);
});

it('no se persigue la tarifa de una carga ya entregada', function () {
    $id = cargaConPapel($this->scenario);
    envejecePapel($id, 5);

    DB::table('loads')->where('id', $id)->update(['status' => 'delivered']);

    $this->artisan('notifications:sweep', ['--tenant' => (string) $this->scenario->tenant->id])
        ->assertSuccessful();

    expect(avisosDeTarifa(RateResponse::SIN_CONTESTAR))->toBe(0);
});

it('no se persigue la tarifa de una carga cancelada', function () {
    $id = cargaConPapel($this->scenario);
    envejecePapel($id, 5);

    DB::table('loads')->where('id', $id)->update(['status' => 'cancelled']);

    $this->artisan('notifications:sweep', ['--tenant' => (string) $this->scenario->tenant->id])
        ->assertSuccessful();

    expect(avisosDeTarifa(RateResponse::SIN_CONTESTAR))->toBe(0);
});

it('lo que lleva sin contestar desde hace un año no se desentierra', function () {
    $id = cargaConPapel($this->scenario);
    envejecePapel($id, 400);

    $this->artisan('notifications:sweep', ['--tenant' => (string) $this->scenario->tenant->id])
        ->assertSuccessful();

    expect(avisosDeTarifa(RateResponse::SIN_CONTESTAR))->toBe(0);
});

it('el barrido no avisa dos veces del mismo papel', function () {
    $id = cargaConPapel($this->scenario);
    envejecePapel($id, 5);

    $tenantId = (string) $this->scenario->tenant->id;

    $this->artisan('notifications:sweep', ['--tenant' => $tenantId])->assertSuccessful();
    $primera = avisosDeTarifa(RateResponse::SIN_CONTESTAR);

    $this->artisan('notifications:sweep', ['--tenant' => $tenantId])->assertSuccessful();

    expect(avisosDeTarifa(RateResponse::SIN_CONTESTAR))->toBe($primera);
});
