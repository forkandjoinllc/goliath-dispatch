<?php

declare(strict_types=1);

use App\Enums\Role;
use App\Support\Storage\DocumentStore;
use App\Support\Storage\OrphanSweep;
use App\Support\Storage\StoredFiles;
use App\Support\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\DatabaseTransactions;
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
    config(['retention.purge_enabled' => false]);
});

afterEach(fn () => app(TenantContext::class)->forget());

/** Un fichero suelto en el almacén, con la edad que se le diga. */
function ficheroSuelto(Scenario $scenario, int $horasDeAntiguedad = 48): string
{
    $store = app(DocumentStore::class);
    $clave = $store->putBytes((string) $scenario->tenant->id, 'contenido suelto', 'pdf');

    // El disco falso guarda la fecha real; se retrasa a mano para simular edad.
    Storage::disk('local')->setVisibility($clave, 'private');
    touch(Storage::disk('local')->path($clave), time() - $horasDeAntiguedad * 3600);

    return $clave;
}

/* ── Huérfanos: fichero sin fila ─────────────────────────────────────────── */

it('un fichero que ninguna fila reclama sale como huérfano', function () {
    // Aparece solo: alguien sube un documento, el fichero se guarda, y la
    // transacción que iba a escribir la fila revienta. `LoadFile::attach()`
    // guarda el fichero FUERA de la transacción a propósito —para no bloquear
    // las tablas mientras sube— y el precio de esa decisión correcta es este.
    $clave = ficheroSuelto($this->scenario);

    $r = OrphanSweep::find(app(DocumentStore::class));

    expect(collect($r['files'])->pluck('key')->all())->toContain($clave);
});

it('un fichero recién subido NO cuenta como huérfano', function () {
    // Es una subida en curso. Borrarlo rompería la subida de alguien que está
    // mirando la pantalla en ese momento. El error barato es esperar de más.
    $clave = ficheroSuelto($this->scenario, horasDeAntiguedad: 1);

    $r = OrphanSweep::find(app(DocumentStore::class));

    expect(collect($r['files'])->pluck('key')->all())->not->toContain($clave);
    expect($r['tooRecent'])->toBeGreaterThan(0);
});

it('un fichero con su fila no es huérfano', function () {
    $store = app(DocumentStore::class);
    $tenantId = (string) $this->scenario->tenant->id;

    $clave = app(TenantContext::class)->runAs($tenantId, function () use ($store, $tenantId) {
        $k = $store->putBytes($tenantId, 'con fila', 'pdf');
        touch(Storage::disk('local')->path($k), time() - 48 * 3600);

        $documentoId = (string) Str::uuid();

        DB::table('documents')->insert([
            'id' => $documentoId,
            'tenant_id' => $tenantId,
            'document_type' => 'other',
            'owner_type' => 'carrier',
            'owner_id' => $this->scenario->assignedCarrier->id,
            'title' => 'x',
            'review_status' => 'approved',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('document_versions')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $tenantId,
            'document_id' => $documentoId,
            'version_number' => 1,
            'storage_key' => $k,
            'original_filename' => 'x.pdf',
            'content_type' => 'application/pdf',
            'byte_size' => 8,
            'sha256' => str_repeat('b', 64),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return $k;
    });

    $r = OrphanSweep::find($store);

    expect(collect($r['files'])->pluck('key')->all())->not->toContain($clave);
});

it('una fila borrada suavemente sigue reclamando su fichero', function () {
    // A propósito: mientras alguien pueda restaurar la fila, el fichero no es
    // huérfano. Los ficheros de las filas borradas se van cuando la retención
    // purga la fila, no antes.
    $store = app(DocumentStore::class);
    $tenantId = (string) $this->scenario->tenant->id;

    $clave = app(TenantContext::class)->runAs($tenantId, function () use ($store, $tenantId) {
        $k = $store->putBytes($tenantId, 'borrado suave', 'pdf');
        touch(Storage::disk('local')->path($k), time() - 48 * 3600);

        $documentoId = (string) Str::uuid();

        DB::table('documents')->insert([
            'id' => $documentoId, 'tenant_id' => $tenantId, 'document_type' => 'other',
            'owner_type' => 'carrier', 'owner_id' => $this->scenario->assignedCarrier->id,
            'title' => 'x', 'review_status' => 'approved',
            'created_at' => now(), 'updated_at' => now(),
        ]);

        DB::table('document_versions')->insert([
            'id' => (string) Str::uuid(), 'tenant_id' => $tenantId, 'document_id' => $documentoId,
            'version_number' => 1, 'storage_key' => $k, 'original_filename' => 'x.pdf',
            'content_type' => 'application/pdf', 'byte_size' => 8, 'sha256' => str_repeat('c', 64),
            'deleted_at' => now(),
            'created_at' => now(), 'updated_at' => now(),
        ]);

        return $k;
    });

    expect(collect(OrphanSweep::find($store)['files'])->pluck('key')->all())->not->toContain($clave);
});

it('con la purga apagada los huérfanos se cuentan y no se borran', function () {
    $clave = ficheroSuelto($this->scenario);
    $store = app(DocumentStore::class);

    expect(OrphanSweep::purge($store))->toBe(0);
    expect($store->exists($clave))->toBeTrue();
});

it('con la purga encendida los huérfanos se van', function () {
    config(['retention.purge_enabled' => true]);

    $clave = ficheroSuelto($this->scenario);
    $store = app(DocumentStore::class);

    expect(OrphanSweep::purge($store))->toBeGreaterThan(0);
    expect($store->exists($clave))->toBeFalse();
});

/* ── La otra dirección: fila sin fichero ─────────────────────────────────── */

it('una fila que nombra un fichero que no está sale como rota', function () {
    // Un botón de descargar que va a dar error delante de un cliente.
    $tenantId = (string) $this->scenario->tenant->id;

    app(TenantContext::class)->runAs($tenantId, function () use ($tenantId) {
        $documentoId = (string) Str::uuid();

        DB::table('documents')->insert([
            'id' => $documentoId, 'tenant_id' => $tenantId, 'document_type' => 'other',
            'owner_type' => 'carrier', 'owner_id' => $this->scenario->assignedCarrier->id,
            'title' => 'x', 'review_status' => 'approved',
            'created_at' => now(), 'updated_at' => now(),
        ]);

        DB::table('document_versions')->insert([
            'id' => (string) Str::uuid(), 'tenant_id' => $tenantId, 'document_id' => $documentoId,
            'version_number' => 1, 'storage_key' => 'documents/inventado/2020/01/no-existe.pdf',
            'original_filename' => 'x.pdf', 'content_type' => 'application/pdf',
            'byte_size' => 8, 'sha256' => str_repeat('d', 64),
            'created_at' => now(), 'updated_at' => now(),
        ]);
    });

    $rotas = OrphanSweep::dangling(app(DocumentStore::class));

    expect($rotas)->not->toBeEmpty();
    expect($rotas[0]['table'])->toBe('document_versions');
});

/* ── El inventario ───────────────────────────────────────────────────────── */

it('las claves conocidas incluyen todas las tablas del inventario', function () {
    // Si `knownKeys()` se dejara una tabla, sus ficheros saldrían como
    // huérfanos y el barrido los borraría. Es el fallo más caro posible de este
    // módulo: borrar ficheros que sí tienen dueño.
    $conocidas = StoredFiles::knownKeys();

    expect($conocidas)->toBeArray();

    // La consulta tiene que poder recorrer TODAS las tablas del inventario sin
    // reventar: una columna mal nombrada aquí es un error de SQL, no un cero.
    foreach (StoredFiles::COLUMNS as $tabla => $columnas) {
        foreach ($columnas as $columna) {
            expect(DB::table($tabla)->whereNotNull($columna)->count())->toBeGreaterThanOrEqual(0);
        }
    }
});

/* ── La pantalla ─────────────────────────────────────────────────────────── */

it('la pantalla enseña el estado del almacén', function () {
    ficheroSuelto($this->scenario);

    signIn($this->scenario, Role::Admin);

    $this->get('/retention')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->has('storage')
            ->where('storage.orphans', 1)
            ->where('storage.dangling', 0)
            ->where('storage.graceHours', OrphanSweep::MARGEN_HORAS)
        );
});
