<?php

declare(strict_types=1);

use App\Enums\Role;
use App\Support\Retention\Holds;
use App\Support\Retention\Sweeper;
use App\Support\Storage\DocumentStore;
use App\Support\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\Support\Scenario;

uses(DatabaseTransactions::class);

beforeEach(function () {
    Storage::fake('local');
    app(TenantContext::class)->forget();
    $this->scenario = Scenario::create();
    config(['retention.purge_enabled' => true]);
});

afterEach(fn () => app(TenantContext::class)->forget());

/**
 * Un documento con su versión y su fichero de verdad en el almacén.
 *
 * @return array{0: string, 1: string} [id de la versión, clave del fichero]
 */
function documentoConFichero(Scenario $scenario, CarbonImmutable $cuando): array
{
    $store = app(DocumentStore::class);
    $clave = $store->putBytes((string) $scenario->tenant->id, '%PDF-1.4 falso', 'pdf');

    $documentoId = (string) Str::uuid();
    $versionId = (string) Str::uuid();

    DB::table('documents')->insert([
        'id' => $documentoId,
        'tenant_id' => $scenario->tenant->id,
        'document_type' => 'other',
        'owner_type' => 'carrier',
        'owner_id' => $scenario->assignedCarrier->id,
        'title' => 'Un papel viejo',
        'review_status' => 'approved',
        'created_at' => $cuando,
        'updated_at' => $cuando,
    ]);

    DB::table('document_versions')->insert([
        'id' => $versionId,
        'tenant_id' => $scenario->tenant->id,
        'document_id' => $documentoId,
        'version_number' => 1,
        'storage_key' => $clave,
        'original_filename' => 'viejo.pdf',
        'content_type' => 'application/pdf',
        'byte_size' => 14,
        'sha256' => str_repeat('a', 64),
        'created_at' => $cuando,
        'updated_at' => $cuando,
    ]);

    return [$versionId, $clave];
}

/* ── El agujero que este lote cierra ─────────────────────────────────────── */

it('purgar una fila se lleva su fichero', function () {
    // ESTE ES EL FALLO. La purga del lote 52 borraba la fila y dejaba el
    // fichero: el sistema decía «purgado» y el PDF seguía en el disco. Y no era
    // un despiste aislado — nadie tenía la lista de qué columnas apuntan al
    // almacén, así que no había forma de saber qué ficheros se llevaba cada
    // borrado.
    $tenantId = (string) $this->scenario->tenant->id;
    $store = app(DocumentStore::class);

    [$versionId, $clave] = app(TenantContext::class)->runAs(
        $tenantId,
        fn () => documentoConFichero($this->scenario, CarbonImmutable::now()->subYears(20)),
    );

    expect($store->exists($clave))->toBeTrue();

    Sweeper::archive($tenantId, CarbonImmutable::now()->subYears(10));
    Sweeper::purge($store, $tenantId);

    // La fila se fue...
    expect(app(TenantContext::class)->withoutTenant(
        fn () => DB::table('document_versions')->where('id', $versionId)->exists()
    ))->toBeFalse();

    // ...y el fichero también.
    expect($store->exists($clave))->toBeFalse();
});

it('el bloqueo legal salva la fila Y el fichero', function () {
    $tenantId = (string) $this->scenario->tenant->id;
    $store = app(DocumentStore::class);

    [$versionId, $clave] = app(TenantContext::class)->runAs(
        $tenantId,
        fn () => documentoConFichero($this->scenario, CarbonImmutable::now()->subYears(20)),
    );

    Sweeper::archive($tenantId, CarbonImmutable::now()->subYears(10));

    $actor = app(App\Authorization\ActorFactory::class)->for(
        $this->scenario->user(Role::Admin)->fresh(),
        $tenantId,
    );
    Holds::apply($actor, 'Pleito', 'Hay un pleito abierto y este papel es prueba.', 'entity_type', 'document_versions');

    Sweeper::purge($store, $tenantId);

    expect(app(TenantContext::class)->withoutTenant(
        fn () => DB::table('document_versions')->where('id', $versionId)->exists()
    ))->toBeTrue();

    expect($store->exists($clave))->toBeTrue();
});

it('con la purga apagada no se toca ningún fichero', function () {
    config(['retention.purge_enabled' => false]);

    $tenantId = (string) $this->scenario->tenant->id;
    $store = app(DocumentStore::class);

    [, $clave] = app(TenantContext::class)->runAs(
        $tenantId,
        fn () => documentoConFichero($this->scenario, CarbonImmutable::now()->subYears(20)),
    );

    Sweeper::archive($tenantId, CarbonImmutable::now()->subYears(10));
    Sweeper::purge($store, $tenantId);

    expect($store->exists($clave))->toBeTrue();
});

it('archivar NO toca los ficheros', function () {
    // Archivar es marcar y se deshace. Si se llevara los ficheros por delante
    // dejaría de ser reversible sin que su nombre lo diga, que es la peor forma
    // de que una operación destructiva se cuele.
    $tenantId = (string) $this->scenario->tenant->id;
    $store = app(DocumentStore::class);

    [, $clave] = app(TenantContext::class)->runAs(
        $tenantId,
        fn () => documentoConFichero($this->scenario, CarbonImmutable::now()->subYears(20)),
    );

    Sweeper::archive($tenantId);

    expect($store->exists($clave))->toBeTrue();
});

it('el rastro cuenta los ficheros que se fueron', function () {
    $tenantId = (string) $this->scenario->tenant->id;
    $store = app(DocumentStore::class);

    app(TenantContext::class)->runAs(
        $tenantId,
        fn () => documentoConFichero($this->scenario, CarbonImmutable::now()->subYears(20)),
    );

    Sweeper::archive($tenantId, CarbonImmutable::now()->subYears(10));
    $r = Sweeper::run($store, $tenantId);

    expect($r['files'])->toBeGreaterThan(0);
});

/* ── El almacén ──────────────────────────────────────────────────────────── */

it('borrar un fichero que ya no está cuenta como hecho', function () {
    // No es indulgencia: quien llama está terminando de borrar algo, y un
    // fichero que falta es el estado que quería. Distinguirlo de un fallo real
    // haría que el barrido contara como errores las repeticiones de su trabajo.
    $store = app(DocumentStore::class);

    expect($store->delete('documents/nada/2020/01/inventado.pdf'))->toBeTrue();
});

it('deleteMany devuelve cuántos se fueron', function () {
    $store = app(DocumentStore::class);
    $tenantId = (string) $this->scenario->tenant->id;

    $a = $store->putBytes($tenantId, 'uno', 'pdf');
    $b = $store->putBytes($tenantId, 'dos', 'pdf');

    expect($store->deleteMany([$a, $b]))->toBe(2);
    expect($store->exists($a))->toBeFalse();
    expect($store->exists($b))->toBeFalse();
});
