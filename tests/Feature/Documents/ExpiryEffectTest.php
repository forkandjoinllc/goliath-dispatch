<?php

declare(strict_types=1);

use App\Enums\Role;
use App\Support\Documents\DocumentTypes;
use App\Support\Documents\ExpiryEffect;
use App\Support\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\Support\Scenario;

/**
 * Vencer no significa lo mismo en todos los documentos, y la pantalla lo decía.
 *
 * El formulario de subida prometía, para los DIECISIETE tipos de su
 * desplegable: «se le avisará N días antes, y la puerta de despacho bloquea en
 * cuanto vence». La primera mitad es verdad siempre. La segunda lo es en TRES.
 *
 * Estas pruebas miden las dos mitades por separado, que es justo lo que la
 * frase juntaba.
 */
uses(DatabaseTransactions::class);

beforeEach(function (): void {
    app(TenantContext::class)->forget();
    $this->scenario = Scenario::create();
    $this->scenario->approveCarrierDocuments();
});

afterEach(fn () => app(TenantContext::class)->forget());

/** Un documento de este tipo y dueño, vencido ayer y aprobado. */
function documentoVencido(Scenario $s, string $tipo, string $duenoTipo, string $duenoId): string
{
    $id = (string) Str::uuid();

    DB::table('documents')->insert([
        'id' => $id,
        'tenant_id' => $s->tenant->id,
        'document_type' => $tipo,
        'owner_type' => $duenoTipo,
        'owner_id' => $duenoId,
        'title' => 'Papel de prueba',
        'review_status' => 'approved',
        'is_required' => DocumentTypes::isRequired($tipo) ? 1 : 0,
        'expiration_date' => now()->subDay(),
        'created_at' => now(),
        'updated_at' => now(),
    ]);

    return $id;
}

function despachar(Scenario $s): TestResponse
{
    $id = (string) $s->load->id;

    test()->post("/loads/{$id}/status/available");
    test()->post("/loads/{$id}/status/assigned");
    $s->crew($s->load);

    return test()->post("/loads/{$id}/status/dispatched");
}

/* ── La mitad que siempre fue verdad ───────────────────────────────────── */

it('la barredora avisa de CUALQUIER documento con fecha, bloquee o no', function (): void {
    // La barredora no mira el tipo. Por eso la primera mitad de la frase valía
    // para los diecisiete, y por eso hacía creíble la segunda.
    signIn($this->scenario, Role::Admin);

    documentoVencido(
        $this->scenario,
        'w9',
        'carrier',
        (string) $this->scenario->assignedCarrier->id,
    );

    $documento = (string) DB::table('documents')
        ->where('document_type', 'w9')
        ->value('id');

    $delDocumento = fn (): int => DB::table('notifications')
        ->where('dedupe_key', 'like', "%{$documento}%")
        ->count();

    expect($delDocumento())->toBe(0);

    $this->artisan('notifications:sweep')->assertSuccessful();

    // Se cuenta por el id del documento y no por la clave del suceso: son DOS
    // —`document.expiring` y `document.expired`— y cuál sale depende de si la
    // fecha ya pasó. Fijar una de las dos hace que la prueba mida el calendario
    // en vez de la barredora; la primera versión de esto miraba
    // `document.expiring` sobre un documento vencido ayer y daba cero.
    expect($delDocumento())->toBeGreaterThan(0);
});

/* ── Y la mitad que no lo era ──────────────────────────────────────────── */

it('un tipo NO obligatorio del transportista vencido no para el despacho', function (): void {
    // `w9` sale en el desplegable, admite fecha de vencimiento, y su
    // vencimiento no cierra ninguna puerta. La frase decía lo contrario.
    signIn($this->scenario, Role::Admin);

    documentoVencido(
        $this->scenario,
        'w9',
        'carrier',
        (string) $this->scenario->assignedCarrier->id,
    );

    despachar($this->scenario)->assertRedirect();

    expect(DB::table('loads')->where('id', $this->scenario->load->id)->value('status'))
        ->toBe('dispatched');
});

it('el registro de un camión vencido tampoco lo para, aunque esté marcado obligatorio', function (): void {
    // Este es el que peor se lee. `truck_registration` está declarado
    // OBLIGATORIO —sale con su estrella en el desplegable— y ninguna puerta lo
    // consulta: `documentCompliance()` se llama una sola vez, con 'carrier'.
    signIn($this->scenario, Role::Admin);

    expect(DocumentTypes::isRequired('truck_registration'))->toBeTrue();

    $this->scenario->crew($this->scenario->load);

    $camion = (string) DB::table('trucks')
        ->where('tenant_id', $this->scenario->tenant->id)
        ->value('id');

    documentoVencido($this->scenario, 'truck_registration', 'truck', $camion);

    $id = (string) $this->scenario->load->id;
    $this->post("/loads/{$id}/status/available");
    $this->post("/loads/{$id}/status/assigned");
    $this->post("/loads/{$id}/status/dispatched")->assertRedirect();

    expect(DB::table('loads')->where('id', $id)->value('status'))->toBe('dispatched');
});

it('uno de los tres del transportista vencido SÍ lo para, y antes de despachar', function (): void {
    signIn($this->scenario, Role::Admin);

    // El escenario los deja al día; se vence uno.
    DB::table('documents')
        ->where('owner_id', $this->scenario->assignedCarrier->id)
        ->where('document_type', 'certificate_of_insurance')
        ->update(['expiration_date' => now()->subDay()]);

    $id = (string) $this->scenario->load->id;
    $this->post("/loads/{$id}/status/available")->assertRedirect();

    // Para en ASIGNAR, no en despachar: `carrierCompliance()` se consulta en
    // las dos puertas y la de asignar es la primera que se cruza. La versión
    // anterior de esta prueba esperaba que la carga se quedara en «asignada» y
    // se quedaba en «disponible» — comprobar que algo se bloquea no es
    // comprobar dónde.
    $this->post("/loads/{$id}/status/assigned")->assertSessionHasErrors('action');

    expect(DB::table('loads')->where('id', $id)->value('status'))->toBe('available');
});

/* ── Y el registro dice exactamente eso ────────────────────────────────── */

it('el registro dice que bloquean tres y solo avisan los demás', function (): void {
    $mapa = ExpiryEffect::map();

    $bloquean = array_keys(array_filter($mapa, fn (string $e): bool => $e === ExpiryEffect::BLOQUEA));

    sort($bloquean);

    expect($bloquean)->toBe([
        'carrier_agreement',
        'certificate_of_authority',
        'certificate_of_insurance',
    ]);

    // Y cubre el catálogo entero: un tipo sin efecto sería un tipo sobre el que
    // la pantalla no sabría qué decir.
    expect(array_keys($mapa))->toBe(DocumentTypes::all());
});

it('el efecto de un tipo sale de la misma función que consulta la puerta', function (): void {
    // No es una segunda opinión sobre el comportamiento: es la misma consulta.
    foreach (DocumentTypes::all() as $tipo) {
        $obligatorioParaUnVigilado = false;

        foreach (ExpiryEffect::DUENOS_VIGILADOS as $dueno) {
            if (in_array($tipo, DocumentTypes::requiredFor($dueno), true)) {
                $obligatorioParaUnVigilado = true;
            }
        }

        expect(ExpiryEffect::bloquea($tipo))->toBe($obligatorioParaUnVigilado);
    }
});

/* ── Y las pantallas lo reciben ────────────────────────────────────────── */

it('el formulario recibe el efecto de cada tipo', function (): void {
    signIn($this->scenario, Role::Admin);

    $props = json_decode((string) json_encode(
        $this->get('/documents/upload')->viewData('page')['props'] ?? []
    ), true);

    $efectos = $props['expiryEffects'] ?? [];

    expect($efectos['certificate_of_insurance'] ?? null)->toBe('blocks');
    expect($efectos['w9'] ?? null)->toBe('warns');
    expect($efectos['truck_registration'] ?? null)->toBe('warns');
});

it('la ficha de un documento recibe el suyo', function (): void {
    signIn($this->scenario, Role::Admin);

    $id = documentoVencido(
        $this->scenario,
        'w9',
        'carrier',
        (string) $this->scenario->assignedCarrier->id,
    );

    $props = json_decode((string) json_encode(
        $this->get("/documents/{$id}")->viewData('page')['props'] ?? []
    ), true);

    expect($props['document']['expiryEffect'] ?? null)->toBe('warns');
});
