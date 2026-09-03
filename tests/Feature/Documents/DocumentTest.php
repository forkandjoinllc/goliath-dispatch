<?php

declare(strict_types=1);

use App\Enums\LoadStatus;
use App\Enums\Role;
use App\Support\Loads\Guards;
use App\Support\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Inertia\Testing\AssertableInertia as Assert;
use Tests\Support\Scenario;

uses(DatabaseTransactions::class);

/*
| ADVERTENCIA: escritas sin poder ejecutarse (ver docs/testing.md). Todo lo que
| afirman se ejercitó a mano contra la aplicación en marcha, incluida la subida
| real de un PDF y la descarga por URL firmada.
*/

beforeEach(function () {
    app(TenantContext::class)->forget();
    $this->scenario = Scenario::create();
});

afterEach(fn () => app(TenantContext::class)->forget());

/* ── La puerta que aparentaba más de lo que hacía ───────────────────────── */

it('un transportista SIN documentos no puede despachar', function () {
    // Este es el fallo que este trabajo vino a arreglar. La versión anterior
    // solo miraba si había alguno vencido, así que con cero documentos no
    // bloqueaba nada y el camión salía.
    $load = $this->scenario->load;
    $load->status = LoadStatus::Assigned;

    $blocking = Guards::blocking($load, 'dispatched');

    expect($blocking)
        ->toContain('missingDocument:certificate_of_insurance')
        ->toContain('missingDocument:certificate_of_authority')
        ->toContain('missingDocument:carrier_agreement');
});

it('un documento PENDIENTE de revisión no cuenta', function () {
    // Que alguien haya subido un PDF no significa que nadie lo haya mirado.
    approveDocuments($this->scenario->assignedCarrier->id, $this->scenario->tenant->id, status: 'pending');

    $load = $this->scenario->load;
    $load->status = LoadStatus::Assigned;

    expect(Guards::blocking($load, 'dispatched'))
        ->toContain('missingDocument:certificate_of_insurance');
});

it('un documento aprobado pero VENCIDO tampoco cuenta', function () {
    approveDocuments(
        $this->scenario->assignedCarrier->id,
        $this->scenario->tenant->id,
        expiration: now()->subDay()->toDateString(),
    );

    $load = $this->scenario->load;
    $load->status = LoadStatus::Assigned;

    expect(Guards::blocking($load, 'dispatched'))
        ->toContain('missingDocument:certificate_of_insurance');
});

it('con los tres aprobados y vigentes, la puerta deja pasar', function () {
    approveDocuments($this->scenario->assignedCarrier->id, $this->scenario->tenant->id);

    $load = $this->scenario->load;
    $load->status = LoadStatus::Assigned;

    $blocking = Guards::blocking($load, 'dispatched');

    expect(array_filter($blocking, fn (string $b) => str_starts_with($b, 'missingDocument')))->toBeEmpty();
});

/* ── La subida ──────────────────────────────────────────────────────────── */

it('guarda el fichero fuera de public y con nombre aleatorio', function () {
    signIn($this->scenario, Role::Admin);

    $this->post('/documents', [
        'file' => UploadedFile::fake()->create('seguro.pdf', 40, 'application/pdf'),
        'owner_type' => 'carrier',
        'owner_id' => $this->scenario->assignedCarrier->id,
        'document_type' => 'certificate_of_insurance',
        'expiration_date' => now()->addYear()->toDateString(),
    ])->assertRedirect();

    $version = DB::table('document_versions')->latest('created_at')->first();

    expect($version->storage_key)->toStartWith('documents/'.$this->scenario->tenant->id)
        // El nombre original es un DATO: llega del usuario y puede traer «../».
        ->and($version->original_filename)->toBe('seguro.pdf')
        ->and($version->storage_key)->not->toContain('seguro.pdf')
        ->and($version->sha256)->toHaveLength(64)
        // Sin antivirus configurado no se afirma que está limpio. Y tampoco
        // se queda en `pending`, que era prometer un análisis en camino: se
        // analiza en la misma petición y el veredicto del adaptador simulado es
        // «no había con qué mirar». Ver lote 69.
        ->and($version->malware_scan_status)->toBe('unavailable')
        ->and($version->malware_scan_at)->not->toBeNull();

    expect(Storage::disk('local')->exists($version->storage_key))->toBeTrue();
});

it('rechaza un ejecutable renombrado a .pdf', function () {
    signIn($this->scenario, Role::Admin);

    // El tipo se comprueba por el CONTENIDO, no por la extensión del nombre.
    $this->post('/documents', [
        // Fichero REAL en disco, no UploadedFile::fake(): el falso miente sobre
        // su propio tipo MIME —lo deduce de la extensión— así que `mimetypes:`
        // recibía «application/pdf» y lo aceptaba. Con un fichero de verdad
        // finfo lee los bytes y lo rechaza. La aplicación siempre estuvo bien.
        'file' => (function () {
            $ruta = tempnam(sys_get_temp_dir(), 'goliath');
            file_put_contents($ruta, "MZ\x90\x00binario");

            return new UploadedFile($ruta, 'seguro.pdf', 'application/pdf', null, true);
        })(),
        'owner_type' => 'carrier',
        'owner_id' => $this->scenario->assignedCarrier->id,
        'document_type' => 'certificate_of_insurance',
    ])->assertSessionHasErrors('file');
});

it('rechaza un tipo de documento que no existe', function () {
    signIn($this->scenario, Role::Admin);

    $this->post('/documents', [
        'file' => UploadedFile::fake()->create('x.pdf', 10, 'application/pdf'),
        'owner_type' => 'carrier',
        'owner_id' => $this->scenario->assignedCarrier->id,
        'document_type' => 'inventado',
    ])->assertSessionHasErrors('document_type');
});

it('el transportista no puede colgarle un documento a otro', function () {
    signIn($this->scenario, Role::Carrier);

    // El selector solo le ofrece el suyo, pero una petición a mano se lo salta.
    $this->post('/documents', [
        'file' => UploadedFile::fake()->create('x.pdf', 10, 'application/pdf'),
        'owner_type' => 'carrier',
        'owner_id' => $this->scenario->otherCarrier->id,
        'document_type' => 'certificate_of_insurance',
    ])->assertSessionHasErrors('owner_id');
});

it('una versión nueva no pisa la anterior y vuelve a la cola', function () {
    signIn($this->scenario, Role::Admin);

    $this->post('/documents', [
        'file' => UploadedFile::fake()->create('v1.pdf', 10, 'application/pdf'),
        'owner_type' => 'carrier',
        'owner_id' => $this->scenario->assignedCarrier->id,
        'document_type' => 'certificate_of_insurance',
    ]);

    $documentId = DB::table('documents')->latest('created_at')->value('id');

    DB::table('documents')->where('id', $documentId)->update(['review_status' => 'approved']);

    $this->post('/documents', [
        'file' => UploadedFile::fake()->create('v2.pdf', 10, 'application/pdf'),
        'document_id' => $documentId,
    ])->assertRedirect();

    $versions = DB::table('document_versions')->where('document_id', $documentId)
        ->orderBy('version_number')->get();

    expect($versions)->toHaveCount(2)
        ->and($versions[0]->original_filename)->toBe('v1.pdf')
        ->and($versions[1]->original_filename)->toBe('v2.pdf');

    // Volver a la cola importa: si no, se aprobaría un certificado y se
    // sustituiría después por otro sin que nadie lo mirase.
    expect(DB::table('documents')->where('id', $documentId)->value('review_status'))->toBe('pending');
});

/* ── La revisión ────────────────────────────────────────────────────────── */

it('rechazar exige explicación', function () {
    $documentId = uploadedDocument($this->scenario);

    signIn($this->scenario, Role::Admin);

    // El transportista lo va a leer, y «rechazado» a secas garantiza una
    // segunda subida igual de mala.
    $this->post("/documents/{$documentId}/review", ['decision' => 'rejected'])
        ->assertSessionHasErrors('notes');

    $this->post("/documents/{$documentId}/review", [
        'decision' => 'rejected',
        'notes' => 'La póliza no cubre carga sobredimensionada.',
    ])->assertRedirect();

    expect(DB::table('documents')->where('id', $documentId)->value('review_status'))->toBe('rejected');
});

it('la revisión se ata a la VERSIÓN concreta', function () {
    $documentId = uploadedDocument($this->scenario);

    signIn($this->scenario, Role::Admin);
    $this->post("/documents/{$documentId}/review", ['decision' => 'approved']);

    $review = DB::table('document_reviews')->where('document_id', $documentId)->first();
    $current = DB::table('documents')->where('id', $documentId)->value('current_version_id');

    // Sin esto, una versión nueva heredaría la aprobación de la anterior y la
    // revisión dejaría de significar nada.
    expect($review->document_version_id)->toBe($current);
});

it('un despachador no puede revisar', function () {
    $documentId = uploadedDocument($this->scenario);

    signIn($this->scenario, Role::Dispatcher);

    // Sube quien tiene el papel; aprueba quien responde por él. Solo
    // administración y contabilidad tienen `document:review`.
    $this->post("/documents/{$documentId}/review", ['decision' => 'approved'])->assertRedirect()->assertSessionHas('error');
});

/* ── La descarga ────────────────────────────────────────────────────────── */

it('la descarga registra quién la pidió', function () {
    $documentId = uploadedDocument($this->scenario);

    signIn($this->scenario, Role::Admin);
    $this->get("/documents/{$documentId}/download")->assertRedirect();

    // `document_access_logs` es lo que responde «¿quién ha visto el número de
    // póliza de este transportista?».
    expect(DB::table('document_access_logs')->where('document_id', $documentId)->count())->toBe(1);
});

it('el fichero no se sirve sin firma', function () {
    $documentId = uploadedDocument($this->scenario);
    $key = base64_encode((string) DB::table('document_versions')
        ->where('document_id', $documentId)->value('storage_key'));

    signIn($this->scenario, Role::Admin);

    $this->get("/documents/file/{$key}")->assertForbidden();
});

/* ── Ámbitos ────────────────────────────────────────────────────────────── */

it('cada rol ve su ámbito de documentos', function (Role $role, string $scope) {
    signIn($this->scenario, $role);

    $this->get('/documents')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('App/Documents/Index')
            ->where('scope', $scope));
})->with([
    'admin' => [Role::Admin, 'tenant'],
    'contabilidad' => [Role::Accounting, 'tenant'],
    'despachador' => [Role::Dispatcher, 'assigned'],
    'transportista' => [Role::Carrier, 'carrier'],
    'conductor' => [Role::Driver, 'own'],
]);

it('el transportista no ve los documentos de otro transportista', function () {
    uploadedDocument($this->scenario, $this->scenario->otherCarrier->id);

    signIn($this->scenario, Role::Carrier);

    $this->get('/documents')->assertInertia(fn (Assert $page) => $page->where('documents.meta.total', 0));
});

/* ── Ayudas ─────────────────────────────────────────────────────────────── */

/**
 * Aprueba los tres documentos obligatorios de un transportista.
 */
function approveDocuments(
    string $carrierId,
    string $tenantId,
    string $status = 'approved',
    ?string $expiration = null,
): void {
    foreach (['certificate_of_insurance', 'certificate_of_authority', 'carrier_agreement'] as $type) {
        DB::table('documents')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $tenantId,
            'document_type' => $type,
            'owner_type' => 'carrier',
            'owner_id' => $carrierId,
            'title' => $type,
            'review_status' => $status,
            'is_required' => true,
            'expiration_date' => $expiration ?? now()->addYear()->toDateString(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }
}

/**
 * Sube un documento por HTTP y devuelve su id.
 */
function uploadedDocument(Scenario $scenario, ?string $carrierId = null): string
{
    signIn($scenario, Role::Admin);

    test()->post('/documents', [
        'file' => UploadedFile::fake()->create('seguro.pdf', 20, 'application/pdf'),
        'owner_type' => 'carrier',
        'owner_id' => $carrierId ?? $scenario->assignedCarrier->id,
        'document_type' => 'certificate_of_insurance',
    ]);

    return (string) DB::table('documents')->latest('created_at')->value('id');
}
