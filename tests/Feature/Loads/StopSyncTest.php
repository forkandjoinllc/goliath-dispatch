<?php

declare(strict_types=1);

use App\Enums\Role;
use App\Support\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\Support\Scenario;

uses(DatabaseTransactions::class);

beforeEach(function () {
    app(TenantContext::class)->forget();
    $this->scenario = Scenario::create();
});

afterEach(fn () => app(TenantContext::class)->forget());

/**
 * Las paradas vivas de una carga, en orden, como «1:Ciudad».
 *
 * `paradasVivasDe` y no `paradasDe`: esa ya existe en
 * `tests/Feature/Tracking/StopProgressTest.php`. Pest carga todos los ficheros
 * de prueba en un espacio global y dos funciones de primer nivel con el mismo
 * nombre son un fatal que se lleva la suite ENTERA — y solo aparece al correrla
 * entera. Cuarta vez en cinco lotes; el grep previo ya es obligatorio.
 */
function paradasVivasDe(string $tenantId, string $loadId): array
{
    return app(TenantContext::class)->runAs($tenantId, fn () => DB::table('load_stops')
        ->where('load_id', $loadId)
        ->whereNull('deleted_at')
        ->orderBy('sequence')
        ->get(['sequence', 'city'])
        ->map(fn (object $s): string => "{$s->sequence}:{$s->city}")
        ->all());
}

/** Las filas crudas de una carga, borradas incluidas. */
function paradasCrudas(string $loadId): Collection
{
    return app(TenantContext::class)->withoutTenant(fn () => DB::table('load_stops')
        ->where('load_id', $loadId)->orderBy('sequence')->get());
}

/** El cuerpo mínimo que acepta el formulario de edición. */
function edicion(Scenario $s, array $stops): array
{
    return [
        'customer_id' => (string) $s->customer->id,
        'commodity' => 'Acero en rollos',
        'weight_pounds' => 42000,
        'stops' => $stops,
    ];
}

/* ── Nadie toca la parada de otra empresa ────────────────────────────────── */

it('no se puede pisar la parada de otra empresa mandando su id', function () {
    // `stops.*.id` se validaba como ['nullable','string','size:36'] y se metía
    // tal cual en un UPDATE sin load_id ni tenant_id. Con dos empresas montadas
    // se comprobó que la parada de la segunda pasaba de «Laredo» a lo que
    // mandara la primera.
    app(TenantContext::class)->forget();
    $otra = Scenario::create();
    app(TenantContext::class)->forget();

    $ajena = app(TenantContext::class)->runAs($otra->tenant->id, fn () => DB::table('load_stops')
        ->where('load_id', $otra->load->id)->orderBy('sequence')->first());

    signIn($this->scenario, Role::Admin);

    $this->patch("/loads/{$this->scenario->load->id}", edicion($this->scenario, [
        ['stop_type' => 'pickup', 'city' => 'Houston', 'state' => 'TX'],
        ['stop_type' => 'delivery', 'city' => 'Dallas', 'state' => 'TX'],
        ['id' => $ajena->id, 'stop_type' => 'delivery', 'city' => 'PISADA', 'state' => 'TX'],
    ]))->assertRedirect()->assertSessionHasErrors('stops.2.id');

    $despues = app(TenantContext::class)->withoutTenant(
        fn () => DB::table('load_stops')->where('id', $ajena->id)->first()
    );

    expect((string) $despues->city)->toBe((string) $ajena->city)
        ->and((string) $despues->facility_name)->toBe((string) $ajena->facility_name);
});

it('el error señala la parada que mandó el formulario, no otra', function () {
    // `$request->validate()` NO devuelve el array en el orden de envío: lo monta
    // regla por regla, así que las paradas con `id` salen antes. Señalando la
    // posición del array reordenado, el formulario marcaba en rojo una fila
    // inocente.
    app(TenantContext::class)->forget();
    $otra = Scenario::create();
    app(TenantContext::class)->forget();

    $ajena = app(TenantContext::class)->runAs($otra->tenant->id, fn () => DB::table('load_stops')
        ->where('load_id', $otra->load->id)->first());

    signIn($this->scenario, Role::Admin);

    $this->patch("/loads/{$this->scenario->load->id}", edicion($this->scenario, [
        ['stop_type' => 'pickup', 'city' => 'Houston', 'state' => 'TX'],
        ['stop_type' => 'delivery', 'city' => 'Dallas', 'state' => 'TX'],
        ['id' => $ajena->id, 'stop_type' => 'delivery', 'city' => 'PISADA', 'state' => 'TX'],
    ]))->assertSessionHasErrors('stops.2.id');
});

it('un id inventado se rechaza igual que uno ajeno', function () {
    // Mismo mensaje para los dos casos, a propósito: distinguirlos confirmaría
    // que el ajeno existe.
    signIn($this->scenario, Role::Admin);

    $this->patch("/loads/{$this->scenario->load->id}", edicion($this->scenario, [
        ['stop_type' => 'pickup', 'city' => 'Houston', 'state' => 'TX'],
        ['id' => (string) Str::uuid(), 'stop_type' => 'delivery', 'city' => 'X', 'state' => 'TX'],
    ]))->assertSessionHasErrors('stops.1.id');
});

it('no se puede pisar la parada de OTRA CARGA de la misma empresa', function () {
    // El caso que el ámbito de empresa NO cubre. La búsqueda filtra por
    // tenant_id Y por load_id, y hacen falta los dos: con solo el primero, un
    // despachador podría mover a su carga una parada de la carga de al lado.
    $loadId = (string) $this->scenario->load->id;
    $ajena = paradasCrudas((string) $this->scenario->otherLoad->id)->first();

    expect($ajena)->not->toBeNull();

    signIn($this->scenario, Role::Admin);

    $this->patch("/loads/{$loadId}", edicion($this->scenario, [
        ['stop_type' => 'pickup', 'city' => 'Houston', 'state' => 'TX'],
        ['id' => (string) $ajena->id, 'stop_type' => 'delivery', 'city' => 'ROBADA', 'state' => 'TX'],
    ]))->assertSessionHasErrors('stops.1.id');

    $despues = app(TenantContext::class)->withoutTenant(
        fn () => DB::table('load_stops')->where('id', $ajena->id)->first()
    );

    expect((string) $despues->city)->toBe((string) $ajena->city)
        ->and((string) $despues->load_id)->toBe((string) $this->scenario->otherLoad->id);
});

/* ── El orden es el que se manda ─────────────────────────────────────────── */

it('una parada nueva puesta la primera se guarda la primera', function () {
    // Se guardaba la ÚLTIMA. Y `sequence` no es decorativo: StopProgress impide
    // anotar la llegada a una parada si otra de sequence menor no ha llegado.
    $tenantId = (string) $this->scenario->tenant->id;
    $loadId = (string) $this->scenario->load->id;

    $antes = paradasCrudas($loadId)->values();

    signIn($this->scenario, Role::Admin);

    $this->patch("/loads/{$loadId}", edicion($this->scenario, [
        ['stop_type' => 'pickup', 'city' => 'NUEVA', 'state' => 'TX'],
        ['id' => (string) $antes[0]->id, 'stop_type' => 'pickup', 'city' => (string) $antes[0]->city, 'state' => 'TX'],
        ['id' => (string) $antes[1]->id, 'stop_type' => 'delivery', 'city' => (string) $antes[1]->city, 'state' => 'TX'],
    ]))->assertRedirect();

    expect(paradasVivasDe($tenantId, $loadId))->toBe([
        '1:NUEVA', '2:'.$antes[0]->city, '3:'.$antes[1]->city,
    ]);
});

it('intercambiar dos paradas no choca con el índice único', function () {
    // UNIQUE (load_id, live_sequence) es correcto y por eso estorba a mitad de
    // faena: la 1 pasa a 2 mientras la 2 todavía es la 2.
    $tenantId = (string) $this->scenario->tenant->id;
    $loadId = (string) $this->scenario->load->id;

    $antes = paradasCrudas($loadId)->values();

    signIn($this->scenario, Role::Admin);

    $this->patch("/loads/{$loadId}", edicion($this->scenario, [
        ['id' => (string) $antes[1]->id, 'stop_type' => 'pickup', 'city' => (string) $antes[1]->city, 'state' => 'TX'],
        ['id' => (string) $antes[0]->id, 'stop_type' => 'delivery', 'city' => (string) $antes[0]->city, 'state' => 'TX'],
    ]))->assertRedirect();

    expect(paradasVivasDe($tenantId, $loadId))->toBe(['1:'.$antes[1]->city, '2:'.$antes[0]->city]);
});

/* ── Quitar una parada no la borra de verdad ─────────────────────────────── */

it('quitar una parada la deja en blando, con quién y por qué', function () {
    $tenantId = (string) $this->scenario->tenant->id;
    $loadId = (string) $this->scenario->load->id;

    $antes = paradasCrudas($loadId)->values();

    signIn($this->scenario, Role::Admin);

    $this->patch("/loads/{$loadId}", edicion($this->scenario, [
        ['id' => (string) $antes[0]->id, 'stop_type' => 'pickup', 'city' => (string) $antes[0]->city, 'state' => 'TX'],
        ['stop_type' => 'delivery', 'city' => 'OTRA ENTREGA', 'state' => 'TX'],
    ]))->assertRedirect();

    $quitada = app(TenantContext::class)->withoutTenant(
        fn () => DB::table('load_stops')->where('id', $antes[1]->id)->first()
    );

    // La fila SIGUE. Un comprobante que apunte a ella no se queda huérfano, y
    // el historial de la carga sigue explicándose.
    expect($quitada)->not->toBeNull()
        ->and($quitada->deleted_at)->not->toBeNull()
        ->and($quitada->deleted_by)->not->toBeNull()
        ->and((string) $quitada->deletion_reason)->toBe('stop_removed_on_load_edit');
});

it('el número de orden de una parada quitada se puede volver a usar', function () {
    // Sin la columna generada, el índice único guardaba el número ocupado para
    // siempre: quita la parada 2 y esa carga no vuelve a tener una parada 2.
    // Eso es lo que hacía que borrar de verdad fuera el único camino.
    $tenantId = (string) $this->scenario->tenant->id;
    $loadId = (string) $this->scenario->load->id;

    $antes = paradasCrudas($loadId)->values();

    signIn($this->scenario, Role::Admin);

    $this->patch("/loads/{$loadId}", edicion($this->scenario, [
        ['id' => (string) $antes[0]->id, 'stop_type' => 'pickup', 'city' => (string) $antes[0]->city, 'state' => 'TX'],
        ['stop_type' => 'delivery', 'city' => 'SUSTITUTA', 'state' => 'TX'],
    ]))->assertRedirect();

    expect(paradasVivasDe($tenantId, $loadId))->toBe(['1:'.$antes[0]->city, '2:SUSTITUTA']);

    // Y la vieja sigue ahí, con su número desplazado y su live_sequence en NULL.
    $vieja = app(TenantContext::class)->withoutTenant(
        fn () => DB::table('load_stops')->where('id', $antes[1]->id)->first()
    );

    expect($vieja->live_sequence)->toBeNull();
});

it('un comprobante colgado de una parada quitada no pierde su parada', function () {
    // `load_documents.stop_id` es ON DELETE SET NULL. Borrando de verdad, un
    // comprobante de entrega subido PARA esa parada se quedaba sin saber de qué
    // parada era: el papel sobrevive, lo que se pierde es qué prueba.
    $loadId = (string) $this->scenario->load->id;
    $antes = paradasCrudas($loadId)->values();
    $stopId = (string) $antes[1]->id;

    Storage::fake('local');

    signIn($this->scenario, Role::Admin);

    $this->post("/loads/{$loadId}/documents", [
        'file' => UploadedFile::fake()->create('pod.pdf', 20, 'application/pdf'),
        'document_type' => 'pod',
        'stop_id' => $stopId,
    ])->assertRedirect();

    $this->patch("/loads/{$loadId}", edicion($this->scenario, [
        ['id' => (string) $antes[0]->id, 'stop_type' => 'pickup', 'city' => (string) $antes[0]->city, 'state' => 'TX'],
        ['stop_type' => 'delivery', 'city' => 'OTRA', 'state' => 'TX'],
    ]))->assertRedirect();

    $vinculo = app(TenantContext::class)->withoutTenant(fn () => DB::table('load_documents')
        ->where('load_id', $loadId)->whereNull('deleted_at')->first());

    expect((string) $vinculo->stop_id)->toBe($stopId);
});
