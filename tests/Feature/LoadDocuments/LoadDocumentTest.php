<?php

declare(strict_types=1);

use App\Enums\Role;
use App\Support\Documents\LoadFile;
use App\Support\Loads\Guards;
use App\Support\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Inertia\Testing\AssertableInertia as Assert;
use Tests\Support\Scenario;

uses(DatabaseTransactions::class);

beforeEach(function () {
    Storage::fake('local');
    app(TenantContext::class)->forget();
    $this->scenario = Scenario::create();
});

afterEach(fn () => app(TenantContext::class)->forget());

/** Un PDF de mentira que pasa la comprobación de MIME por contenido. */
function ficheroDePrueba(string $nombre = 'comprobante.pdf'): UploadedFile
{
    // `mimetypes:` mira el contenido con finfo, no la extensión. Un fichero de
    // texto llamado .pdf sería rechazado — y la prueba fallaría por el motivo
    // equivocado, que es peor que no tenerla.
    $ruta = tempnam(sys_get_temp_dir(), 'gd').'.pdf';
    file_put_contents($ruta, "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n");

    return new UploadedFile($ruta, $nombre, 'application/pdf', null, true);
}

/** La primera parada de entrega de la carga del escenario. */
function paradaDeEntrega(Scenario $scenario): ?string
{
    return app(TenantContext::class)->withoutTenant(fn () => DB::table('load_stops')
        ->where('load_id', $scenario->load->id)
        ->where('stop_type', 'delivery')
        ->whereNull('deleted_at')
        ->orderBy('sequence')
        ->value('id'));
}

/* ── La pantalla ────────────────────────────────────────────────────────── */

it('la pantalla se dibuja y dice por qué la puerta del comprobante está cerrada', function () {
    signIn($this->scenario, Role::Dispatcher);

    $this->get("/loads/{$this->scenario->load->id}/documents")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('App/Loads/Documents')
            ->where('load.number', $this->scenario->load->load_number)
            ->where('podBlocking', ['noPodDocument'])
            ->where('documents', [])
            ->has('types')
        );
});

it('la carga de otra empresa no existe para quien pregunta', function () {
    // 404 y no 403: un 403 confirmaría que la carga existe.
    signIn($this->scenario, Role::Dispatcher);

    $this->get('/loads/'.Str::uuid().'/documents')->assertNotFound();
});

/* ── Subir ──────────────────────────────────────────────────────────────── */

it('subir un comprobante escribe el documento, su versión y el enlace', function () {
    signIn($this->scenario, Role::Dispatcher);

    $this->post("/loads/{$this->scenario->load->id}/documents", [
        'document_type' => 'pod',
        'file' => ficheroDePrueba(),
    ])->assertRedirect();

    $enlace = app(TenantContext::class)->withoutTenant(fn () => DB::table('load_documents')
        ->where('load_id', $this->scenario->load->id)
        ->whereNull('deleted_at')
        ->first());

    expect($enlace)->not->toBeNull();
    expect((string) $enlace->document_type)->toBe('pod');
    expect($enlace->stop_id)->toBeNull();

    $documento = app(TenantContext::class)->withoutTenant(
        fn () => DB::table('documents')->where('id', $enlace->document_id)->first()
    );

    expect((string) $documento->owner_type)->toBe('load');
    expect((string) $documento->owner_id)->toBe((string) $this->scenario->load->id);
    // Toda subida entra en cola de revisión: que exista un PDF no significa
    // que nadie lo haya mirado.
    expect((string) $documento->review_status)->toBe('pending');
    expect($documento->current_version_id)->not->toBeNull();

    $version = app(TenantContext::class)->withoutTenant(
        fn () => DB::table('document_versions')->where('id', $documento->current_version_id)->first()
    );

    expect((int) $version->version_number)->toBe(1);
    expect((string) $version->sha256)->toHaveLength(64);
    // Sin antivirus configurado no se dice que está limpio.
    // `unavailable`, no `pending`: el análisis ocurre en la misma petición y
    // sin antivirus configurado el veredicto es «no había con qué». Lote 69.
    expect((string) $version->malware_scan_status)->toBe('unavailable');
});

it('el comprobante subido abre la puerta que estaba cerrada para siempre', function () {
    // La prueba de arco completo. Antes de este lote no había pantalla para
    // subirlo Y la puerta buscaba un tipo que el esquema no admite: las dos
    // mitades rotas, y `pod_received` inalcanzable en producción.
    signIn($this->scenario, Role::Dispatcher);

    expect(Guards::blocking($this->scenario->load, 'pod_received'))->toBe(['noPodDocument']);

    $this->post("/loads/{$this->scenario->load->id}/documents", [
        'document_type' => 'pod',
        'file' => ficheroDePrueba(),
    ])->assertRedirect();

    expect(Guards::blocking($this->scenario->load->fresh(), 'pod_received'))->toBe([]);
});

it('se puede decir de qué parada es el comprobante', function () {
    signIn($this->scenario, Role::Dispatcher);

    $parada = paradaDeEntrega($this->scenario);
    expect($parada)->not->toBeNull();

    $this->post("/loads/{$this->scenario->load->id}/documents", [
        'document_type' => 'pod',
        'stop_id' => $parada,
        'file' => ficheroDePrueba(),
    ])->assertRedirect();

    $enlace = app(TenantContext::class)->withoutTenant(fn () => DB::table('load_documents')
        ->where('load_id', $this->scenario->load->id)
        ->whereNull('deleted_at')
        ->first());

    expect((string) $enlace->stop_id)->toBe($parada);
});

it('una parada de otra carga no se acepta', function () {
    // Sin esto, un id de parada ajeno entraría en `load_documents` y el
    // comprobante saldría colgado de un sitio al que no pertenece.
    signIn($this->scenario, Role::Dispatcher);

    $ajena = app(TenantContext::class)->withoutTenant(fn () => DB::table('load_stops')
        ->where('load_id', $this->scenario->otherLoad->id)
        ->whereNull('deleted_at')
        ->value('id'));

    expect($ajena)->not->toBeNull();

    $this->post("/loads/{$this->scenario->load->id}/documents", [
        'document_type' => 'pod',
        'stop_id' => $ajena,
        'file' => ficheroDePrueba(),
    ])->assertSessionHasErrors('stop_id');

    expect(app(TenantContext::class)->withoutTenant(fn () => DB::table('load_documents')
        ->where('load_id', $this->scenario->load->id)->whereNull('deleted_at')->count()))->toBe(0);
});

it('un tipo que no es de carga no se cuelga aquí', function () {
    // Colgar aquí un certificado de seguro lo dejaría fuera de la lista de
    // documentos del transportista, que es donde vence y donde alguien lo mira.
    signIn($this->scenario, Role::Dispatcher);

    $this->post("/loads/{$this->scenario->load->id}/documents", [
        'document_type' => 'certificate_of_insurance',
        'file' => ficheroDePrueba(),
    ])->assertSessionHasErrors('document_type');
});

/* ── Descolgar ──────────────────────────────────────────────────────────── */

it('descolgar borra el enlace y deja el documento en pie', function () {
    signIn($this->scenario, Role::Dispatcher);

    $this->post("/loads/{$this->scenario->load->id}/documents", [
        'document_type' => 'pod',
        'file' => ficheroDePrueba(),
    ])->assertRedirect();

    $enlace = app(TenantContext::class)->withoutTenant(fn () => DB::table('load_documents')
        ->where('load_id', $this->scenario->load->id)->whereNull('deleted_at')->first());

    $this->delete("/loads/{$this->scenario->load->id}/documents/{$enlace->id}", [
        'reason' => 'colgado de la carga equivocada',
    ])->assertRedirect();

    $despues = app(TenantContext::class)->withoutTenant(
        fn () => DB::table('load_documents')->where('id', $enlace->id)->first()
    );

    expect($despues->deleted_at)->not->toBeNull();
    expect((string) $despues->deletion_reason)->toBe('colgado de la carga equivocada');

    // El documento sigue. Lo que se deshizo es que pertenezca a esta carga, no
    // que el papel existiera: eso queda en la bitácora y en sus versiones.
    $documento = app(TenantContext::class)->withoutTenant(
        fn () => DB::table('documents')->where('id', $despues->document_id)->first()
    );

    expect($documento)->not->toBeNull();
    expect($documento->deleted_at)->toBeNull();

    // Y la puerta vuelve a estar cerrada, que es lo que tiene que pasar.
    expect(Guards::blocking($this->scenario->load->fresh(), 'pod_received'))->toBe(['noPodDocument']);
});

it('descolgar un enlace de otra carga no encuentra nada', function () {
    signIn($this->scenario, Role::Dispatcher);

    $this->delete("/loads/{$this->scenario->load->id}/documents/".Str::uuid())
        ->assertNotFound();
});

/* ── Quién puede ────────────────────────────────────────────────────────── */

it('el transportista solo ve y toca los papeles de SUS cargas', function () {
    signIn($this->scenario, Role::Carrier);

    $this->get("/loads/{$this->scenario->otherLoad->id}/documents")->assertNotFound();
});

/* ── La lista ───────────────────────────────────────────────────────────── */

it('el sitio de una parada sale de la ubicación del cliente', function () {
    // La parada normal NO lleva dirección propia: apunta a una
    // `customer_locations` y sus columnas `facility_name`/`city`/`state` quedan
    // a NULL. Leyendo solo la fila de `load_stops` el desplegable decía
    // «Parada 1: recogida» —una etiqueta que no dice dónde—, y la ficha del
    // papel dejaba el sitio en blanco.
    //
    // Ninguna prueba anterior lo veía porque todas escribían la dirección a
    // mano en la parada, que es justo el caso que sí funcionaba. Esta la
    // escribe como la escribe la aplicación de verdad.
    $parada = paradaDeEntrega($this->scenario);
    $nombre = 'Muelle 4 de Savannah';
    $ubicacion = (string) Str::uuid();

    app(TenantContext::class)->runAs($this->scenario->tenant->id, function () use ($ubicacion, $nombre, $parada) {
        DB::table('customer_locations')->insert([
            'id' => $ubicacion,
            'tenant_id' => $this->scenario->tenant->id,
            'customer_id' => $this->scenario->customer->id,
            'name' => $nombre,
            'city' => 'Savannah',
            'state' => 'GA',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        // Así es como las escribe la aplicación: la dirección se referencia, no
        // se copia. Las columnas propias de la parada quedan a NULL.
        DB::table('load_stops')->where('id', $parada)->update([
            'customer_location_id' => $ubicacion,
            'facility_name' => null,
            'city' => null,
            'state' => null,
            'updated_at' => now(),
        ]);
    });

    signIn($this->scenario, Role::Dispatcher);

    $this->get("/loads/{$this->scenario->load->id}/documents")
        ->assertInertia(fn (Assert $page) => $page->where('stops.1.name', $nombre));

    $this->post("/loads/{$this->scenario->load->id}/documents", [
        'document_type' => 'pod',
        'stop_id' => $parada,
        'file' => ficheroDePrueba(),
    ])->assertRedirect();

    $lista = app(TenantContext::class)->withoutTenant(
        fn () => LoadFile::forLoad((string) $this->scenario->load->id)
    );

    expect($lista[0]['stop']['name'])->toBe((string) $nombre);
});

it('la lista trae la parada de cada papel', function () {
    $parada = paradaDeEntrega($this->scenario);

    app(TenantContext::class)->runAs($this->scenario->tenant->id, function () use ($parada) {
        signIn($this->scenario, Role::Dispatcher);

        $this->post("/loads/{$this->scenario->load->id}/documents", [
            'document_type' => 'pod',
            'stop_id' => $parada,
            'file' => ficheroDePrueba(),
        ])->assertRedirect();
    });

    $lista = app(TenantContext::class)->withoutTenant(
        fn () => LoadFile::forLoad((string) $this->scenario->load->id)
    );

    expect($lista)->toHaveCount(1);
    expect($lista[0]['type'])->toBe('pod');
    expect($lista[0]['stop'])->not->toBeNull();
    expect($lista[0]['stop']['id'])->toBe($parada);
    expect($lista[0]['filename'])->toBe('comprobante.pdf');
});
