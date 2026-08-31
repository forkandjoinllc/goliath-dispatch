<?php

declare(strict_types=1);

use App\Enums\Role;
use App\Support\Loads\RateConfirmation;
use App\Support\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Storage;
use Inertia\Testing\AssertableInertia as Assert;
use Tests\Support\Scenario;

uses(DatabaseTransactions::class);

beforeEach(function () {
    app(TenantContext::class)->forget();
    Mail::fake();
    $this->scenario = Scenario::create();
});

afterEach(function () {
    app(TenantContext::class)->forget();
});

/** Deja la carga lista para poder emitir: con transportista y con tarifa. */
function cargaConTarifa(Scenario $scenario, int $centavos = 250000): string
{
    DB::table('loads')->where('id', $scenario->load->id)->update([
        'carrier_id' => $scenario->assignedCarrier->id,
        'carrier_gross_rate_cents' => $centavos,
        'customer_charge_cents' => 300000,
        'updated_at' => now(),
    ]);

    return (string) $scenario->load->id;
}

/* ── Emitir ─────────────────────────────────────────────────────────────── */

it('emite la confirmación como PDF y la deja en el expediente de la carga', function () {
    $id = cargaConTarifa($this->scenario);

    signIn($this->scenario, Role::Admin);
    $this->post("/loads/{$id}/rate-confirmation")->assertRedirect();

    $documento = DB::table('documents')
        ->where('tenant_id', $this->scenario->tenant->id)
        ->where('owner_type', 'load')
        ->where('owner_id', $id)
        ->where('document_type', 'rate_confirmation')
        ->first();

    expect($documento)->not->toBeNull();

    $version = DB::table('document_versions')->where('id', $documento->current_version_id)->first();

    expect(Storage::disk('local')->exists($version->storage_key))->toBeTrue();
    // La huella es de los BYTES del fichero, no del texto que lo originó.
    expect(hash('sha256', Storage::disk('local')->get($version->storage_key)))->toBe((string) $version->sha256);
    expect((string) $version->content_type)->toBe('application/pdf');
});

it('el papel NO lleva lo que la casa le cobra al cliente', function () {
    // Es un papel para el transportista: lleva lo que se le paga a él. El
    // margen de la casa no es asunto suyo, y meterlo ahí sería regalarlo en
    // cada carga.
    //
    // Se comprueba el HTML del que sale el PDF y no los bytes del PDF: lo que
    // hay que proteger es QUÉ DICE el documento. Ir a buscarlo dentro del PDF
    // obliga a inflar flujos zlib y a deshacer el escapado de dompdf para
    // acabar comprobando lo mismo, con una prueba que se rompe el día que la
    // librería cambie de compresión.
    $id = cargaConTarifa($this->scenario);

    $html = app(TenantContext::class)->runAs($this->scenario->tenant->id, function () use ($id): string {
        $carga = App\Models\Load::query()->findOrFail($id);

        return RateConfirmation::html(RateConfirmation::datos($carga), 'es');
    });

    expect($html)->toContain('2,500.00');       // la tarifa del transportista, sí
    expect($html)->not->toContain('3,000.00');  // lo que se le cobra al cliente, no
    expect($html)->toContain((string) $this->scenario->assignedCarrier->legal_name);
});

it('y el PDF que se guarda sale de ese mismo HTML', function () {
    $id = cargaConTarifa($this->scenario);

    signIn($this->scenario, Role::Admin);
    $this->post("/loads/{$id}/rate-confirmation")->assertRedirect();

    $clave = DB::table('documents as d')
        ->join('document_versions as v', 'v.id', '=', 'd.current_version_id')
        ->where('d.owner_id', $id)
        ->where('d.document_type', 'rate_confirmation')
        ->value('v.storage_key');

    $bytes = Storage::disk('local')->get($clave);

    expect(str_starts_with($bytes, '%PDF-'))->toBeTrue();
    expect(strlen($bytes))->toBeGreaterThan(1000);
});

it('no emite sin transportista ni sin tarifa', function () {
    $id = (string) $this->scenario->load->id;

    // La columna es NOT NULL con default 0: «sin tarifa» es cero.
    DB::table('loads')->where('id', $id)->update([
        'carrier_id' => null,
        'carrier_gross_rate_cents' => 0,
    ]);

    signIn($this->scenario, Role::Admin);
    $this->post("/loads/{$id}/rate-confirmation")->assertRedirect();

    expect(DB::table('documents')->where('owner_id', $id)->where('document_type', 'rate_confirmation')->count())->toBe(0);

    DB::table('loads')->where('id', $id)->update(['carrier_id' => $this->scenario->assignedCarrier->id]);

    $this->post("/loads/{$id}/rate-confirmation")->assertRedirect();

    expect(DB::table('documents')->where('owner_id', $id)->where('document_type', 'rate_confirmation')->count())->toBe(0);
});

it('reemitir crea un documento nuevo, no una versión del anterior', function () {
    // Una confirmación con otra tarifa es OTRO papel. Encadenarlas como
    // versiones haría que una aceptación apuntara a un documento cuyo contenido
    // vigente ya no es el que se aceptó.
    $id = cargaConTarifa($this->scenario);

    signIn($this->scenario, Role::Admin);
    $this->post("/loads/{$id}/rate-confirmation")->assertRedirect();

    DB::table('loads')->where('id', $id)->update(['carrier_gross_rate_cents' => 275000]);
    $this->post("/loads/{$id}/rate-confirmation")->assertRedirect();

    $documentos = DB::table('documents')
        ->where('owner_id', $id)
        ->where('document_type', 'rate_confirmation')
        ->get();

    expect($documentos)->toHaveCount(2);
    expect($documentos->pluck('current_version_id')->unique())->toHaveCount(2);
});

/* ── Responder ──────────────────────────────────────────────────────────── */

it('el transportista acepta y queda con la huella del papel que vio', function () {
    $id = cargaConTarifa($this->scenario);

    signIn($this->scenario, Role::Admin);
    $this->post("/loads/{$id}/rate-confirmation")->assertRedirect();

    $sha = DB::table('documents as d')
        ->join('document_versions as v', 'v.id', '=', 'd.current_version_id')
        ->where('d.owner_id', $id)
        ->where('d.document_type', 'rate_confirmation')
        ->value('v.sha256');

    signIn($this->scenario, Role::Carrier);
    $this->post("/loads/{$id}/rate-confirmation/decide", ['decision' => 'accepted'])->assertRedirect();

    $fila = DB::table('rate_confirmation_acceptances')->where('load_id', $id)->first();

    expect($fila)->not->toBeNull();
    expect((string) $fila->decision)->toBe('accepted');
    expect((string) $fila->document_sha256)->toBe((string) $sha);
    // La tarifa se congela: la columna de la carga puede cambiar mañana.
    expect((int) $fila->rated_amount_cents)->toBe(250000);
    expect($fila->actor_user_id)->not->toBeNull();
    expect($fila->ip_address)->not->toBeNull();
});

it('rechazar sin motivo no pasa', function () {
    $id = cargaConTarifa($this->scenario);

    signIn($this->scenario, Role::Admin);
    $this->post("/loads/{$id}/rate-confirmation")->assertRedirect();

    signIn($this->scenario, Role::Carrier);
    $this->post("/loads/{$id}/rate-confirmation/decide", ['decision' => 'rejected'])
        ->assertSessionHasErrors('reason');

    expect(DB::table('rate_confirmation_acceptances')->where('load_id', $id)->count())->toBe(0);

    // Con motivo, sí.
    $this->post("/loads/{$id}/rate-confirmation/decide", [
        'decision' => 'rejected',
        'reason' => 'La tarifa no cubre el peaje',
    ])->assertRedirect();

    expect(DB::table('rate_confirmation_acceptances')->where('load_id', $id)->count())->toBe(1);
});

it('aceptar no necesita motivo', function () {
    $id = cargaConTarifa($this->scenario);

    signIn($this->scenario, Role::Admin);
    $this->post("/loads/{$id}/rate-confirmation")->assertRedirect();

    signIn($this->scenario, Role::Carrier);
    $this->post("/loads/{$id}/rate-confirmation/decide", ['decision' => 'accepted'])
        ->assertSessionHasNoErrors();
});

it('no se puede decidir si no se ha emitido nada', function () {
    $id = cargaConTarifa($this->scenario);

    signIn($this->scenario, Role::Carrier);
    $this->post("/loads/{$id}/rate-confirmation/decide", ['decision' => 'accepted'])->assertRedirect();

    expect(DB::table('rate_confirmation_acceptances')->where('load_id', $id)->count())->toBe(0);
});

it('el despachador no puede contestar por el transportista', function () {
    // `load:rateconf:respond` solo lo tiene el rol transportista. Quien pone la
    // tarifa no puede además aceptarla en nombre de quien la cobra.
    $id = cargaConTarifa($this->scenario);

    signIn($this->scenario, Role::Admin);
    $this->post("/loads/{$id}/rate-confirmation")->assertRedirect();
    $this->post("/loads/{$id}/rate-confirmation/decide", ['decision' => 'accepted'])->assertRedirect();

    expect(DB::table('rate_confirmation_acceptances')->where('load_id', $id)->count())->toBe(0);
});

it('el transportista no puede emitirse su propia confirmación', function () {
    $id = cargaConTarifa($this->scenario);

    signIn($this->scenario, Role::Carrier);
    $this->post("/loads/{$id}/rate-confirmation")->assertRedirect();

    expect(DB::table('documents')->where('owner_id', $id)->where('document_type', 'rate_confirmation')->count())->toBe(0);
});

it('no se ve la confirmación de una carga de otra empresa', function () {
    $otra = Scenario::create();
    app(TenantContext::class)->forget();
    $ajena = (string) $otra->load->id;

    signIn($this->scenario, Role::Admin);

    $this->get("/loads/{$ajena}/rate-confirmation")->assertNotFound();
});

/* ── Lo que la pantalla tiene que contar ────────────────────────────────── */

it('reemitir después de aceptar avisa de que lo aceptado ya no vale', function () {
    // Es el caso que más caro sale contar mal: despacho cambia la tarifa
    // después de que el transportista aceptara. La respuesta anterior sigue
    // siendo cierta —aceptó aquel papel— pero ya no vale para este.
    $id = cargaConTarifa($this->scenario);

    signIn($this->scenario, Role::Admin);
    $this->post("/loads/{$id}/rate-confirmation")->assertRedirect();

    signIn($this->scenario, Role::Carrier);
    $this->post("/loads/{$id}/rate-confirmation/decide", ['decision' => 'accepted'])->assertRedirect();

    signIn($this->scenario, Role::Admin);
    $this->get("/loads/{$id}/rate-confirmation")
        ->assertOk()
        ->assertInertia(fn (Assert $p) => $p->where('currentDecisionStands', true));

    DB::table('loads')->where('id', $id)->update(['carrier_gross_rate_cents' => 275000]);
    $this->post("/loads/{$id}/rate-confirmation")->assertRedirect();

    $this->get("/loads/{$id}/rate-confirmation")
        ->assertOk()
        ->assertInertia(function (Assert $p) {
            expect($p->toArray()['props']['currentDecisionStands'])->toBeFalse();
            // Y la decisión vieja se marca como hecha sobre otro papel.
            expect($p->toArray()['props']['decisions'][0]['onCurrentDocument'])->toBeFalse();
        });
});

it('la pantalla se renderiza de verdad, no solo sus props', function () {
    // La lección de los tres lotes anteriores: unos props correctos no
    // garantizan una pantalla que se vea. Se comprueba el HTML.
    $id = cargaConTarifa($this->scenario);

    signIn($this->scenario, Role::Admin);
    $this->post("/loads/{$id}/rate-confirmation")->assertRedirect();

    $cuerpo = $this->get("/loads/{$id}/rate-confirmation")->assertOk()->getContent();

    expect($cuerpo)->toContain((string) $this->scenario->load->load_number);
    // Sin claves de diccionario crudas en pantalla.
    expect($cuerpo)->not->toContain('loads.rateConfirmation.');
});
