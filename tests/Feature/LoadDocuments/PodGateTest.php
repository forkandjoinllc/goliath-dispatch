<?php

declare(strict_types=1);

use App\Support\Loads\Guards;
use App\Support\TenantContext;
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
 * Cuelga un documento de la carga del escenario y devuelve el id del enlace.
 *
 * Escrito con `DB::table` a propósito: la prueba tiene que poder escribir la
 * fila EXACTA que el esquema admite, sin pasar por la clase que estoy
 * arreglando. Si usara `LoadFile::attach()` estaría comprobando que el código
 * es consistente consigo mismo, que es lo que ya hacía antes de este lote.
 */
function pegarPapelALaCarga(Scenario $scenario, string $tipo, ?string $stopId = null): string
{
    $documentId = (string) Str::uuid();
    $linkId = (string) Str::uuid();

    DB::table('documents')->insert([
        'id' => $documentId,
        'tenant_id' => $scenario->tenant->id,
        'document_type' => $tipo,
        'owner_type' => 'load',
        'owner_id' => $scenario->load->id,
        'title' => $tipo,
        'review_status' => 'approved',
        'created_at' => now(),
        'updated_at' => now(),
    ]);

    DB::table('load_documents')->insert([
        'id' => $linkId,
        'tenant_id' => $scenario->tenant->id,
        'load_id' => $scenario->load->id,
        'document_id' => $documentId,
        'document_type' => $tipo,
        'stop_id' => $stopId,
        'created_at' => now(),
        'updated_at' => now(),
    ]);

    return $linkId;
}

it('sin comprobante la puerta bloquea', function () {
    expect(Guards::blocking($this->scenario->load, 'pod_received'))->toBe(['noPodDocument']);
});

it('con un comprobante colgado la puerta abre', function () {
    // Esta prueba fallaba antes del arreglo, y no por un descuido de matiz: la
    // puerta buscaba `document_type = 'proof_of_delivery'`, que es un valor que
    // el CHECK de `documents.document_type` NO admite. Ninguna fila podía
    // tenerlo jamás, así que la puerta no era estricta — era IMPOSIBLE, y el
    // estado `pod_received` inalcanzable en producción. Con él se factura.
    app(TenantContext::class)->runAs(
        $this->scenario->tenant->id,
        fn () => pegarPapelALaCarga($this->scenario, 'pod'),
    );

    expect(Guards::blocking($this->scenario->load, 'pod_received'))->toBe([]);
});

it('un albarán no vale como comprobante de entrega', function () {
    // La puerta tiene que seguir siendo una puerta. Un `bol` es el papel de la
    // RECOGIDA: existe desde antes de salir, y aceptarlo dejaría marcar
    // «entregado» a una carga que aún va por la carretera.
    app(TenantContext::class)->runAs(
        $this->scenario->tenant->id,
        fn () => pegarPapelALaCarga($this->scenario, 'bol'),
    );

    expect(Guards::blocking($this->scenario->load, 'pod_received'))->toBe(['noPodDocument']);
});

it('un comprobante borrado deja de contar', function () {
    $linkId = app(TenantContext::class)->runAs(
        $this->scenario->tenant->id,
        fn () => pegarPapelALaCarga($this->scenario, 'pod'),
    );

    expect(Guards::blocking($this->scenario->load, 'pod_received'))->toBe([]);

    DB::table('load_documents')->where('id', $linkId)->update(['deleted_at' => now()]);

    expect(Guards::blocking($this->scenario->load, 'pod_received'))->toBe(['noPodDocument']);
});
