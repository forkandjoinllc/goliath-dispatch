<?php

declare(strict_types=1);

use App\Enums\Role;
use App\Support\Documents\DocumentTypes;
use App\Support\Onboarding\Readiness;
use App\Support\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Tests\Support\Scenario;

/**
 * El visto verde dice lo de HOY.
 *
 * La ficha del transportista pintaba la lista de cumplimiento desde la columna
 * `carrier_onboardings.checklist`. Nadie la escribía: en el alta se guardaba
 * `[]` y solo el sembrador de demostración le ponía valores. Con datos reales
 * la tarjeta no salía; con los de demostración salía un visto verde congelado
 * el día que se sembró.
 */
uses(DatabaseTransactions::class);

beforeEach(function (): void {
    $this->escenario = Scenario::create();
    $this->tenantId = (string) $this->escenario->tenant->id;
    $this->carrierId = (string) $this->escenario->assignedCarrier->id;
});

afterEach(fn () => app(TenantContext::class)->forget());

/**
 * @return array<string, array{done: bool, blocking: bool}>
 */
function listaDe(object $prueba, string $carrierId): array
{
    $p = json_decode((string) json_encode(
        $prueba->get("/carriers/{$carrierId}")->viewData('page')['props'] ?? []), true);

    $lista = [];

    foreach ($p['onboarding']['checklist'] ?? [] as $fila) {
        $lista[$fila['key']] = ['done' => $fila['done'], 'blocking' => $fila['blocking']];
    }

    return $lista;
}

/* ── La lista dice lo de hoy ─────────────────────────────────────────────── */

it('un documento aprobado hoy sale marcado, y sin él no', function (): void {
    signIn($this->escenario, Role::Admin);

    $sinPapeles = listaDe($this, $this->carrierId);

    expect($sinPapeles)->not->toBe([], 'La tarjeta no llega a la pantalla.');
    expect($sinPapeles['certificate_of_insurance']['done'])->toBeFalse();

    $this->escenario->approveCarrierDocuments($this->carrierId);

    expect(listaDe($this, $this->carrierId)['certificate_of_insurance']['done'])->toBeTrue();
});

it('y deja de estarlo si el papel se retira', function (): void {
    // Esta es la prueba que la columna congelada no podía pasar: el visto verde
    // seguía puesto el día que caducaba el seguro.
    signIn($this->escenario, Role::Admin);

    $this->escenario->approveCarrierDocuments($this->carrierId);

    expect(listaDe($this, $this->carrierId)['certificate_of_insurance']['done'])->toBeTrue();

    DB::table('documents')
        ->where('owner_id', $this->carrierId)
        ->where('document_type', 'certificate_of_insurance')
        ->update(['review_status' => 'expired']);

    expect(listaDe($this, $this->carrierId)['certificate_of_insurance']['done'])->toBeFalse();
});

/* ── Las filas salen del esquema ─────────────────────────────────────────── */

it('hay una fila por cada documento que el despacho exige', function (): void {
    // De `DocumentTypes::requiredFor('carrier')`, no de una lista escrita a
    // mano: si se escribiera aquí, esta tarjeta diría «listo» mientras Guards
    // bloquea el despacho.
    signIn($this->escenario, Role::Admin);

    $lista = listaDe($this, $this->carrierId);

    foreach (DocumentTypes::requiredFor('carrier') as $tipo) {
        test()->assertArrayHasKey($tipo, $lista, "Falta la fila de {$tipo}.");
        expect($lista[$tipo]['blocking'])->toBeTrue("La fila de {$tipo} bloquea el despacho y no lo dice.");
    }
});

it('el W-9 no sale, porque no bloquea nada', function (): void {
    // Estaba en la lista congelada con su visto verde, sugiriendo que era una
    // puerta. No lo es. Que deba serlo es una decisión de negocio.
    signIn($this->escenario, Role::Admin);

    test()->assertArrayNotHasKey('w9', listaDe($this, $this->carrierId));
});

it('FMCSA sale sin marcar mientras no se haya comprobado', function (): void {
    // Un sabotaje que ponía esta fila en `done => true` a secas salió VERDE:
    // ninguna prueba miraba si el visto de FMCSA correspondía a una
    // comprobación de verdad. Tres estados distintos, tres respuestas.
    signIn($this->escenario, Role::Admin);

    // Nunca comprobado.
    expect(listaDe($this, $this->carrierId)['fmcsa']['done'])->toBeFalse();

    // Comprobado hoy.
    DB::table('fmcsa_verifications')->insert([
        'id' => (string) Str::uuid(),
        'tenant_id' => $this->tenantId,
        'carrier_id' => $this->carrierId,
        'checked_at' => now(),
        'provider' => 'mock',
        'status' => 'verified',
        'attempt' => 1,
        'dot_number' => (string) $this->escenario->assignedCarrier->dot_number,
        'created_at' => now(),
        'updated_at' => now(),
    ]);

    expect(listaDe($this, $this->carrierId)['fmcsa']['done'])->toBeTrue();

    // Comprobado hace demasiado: vuelve a no estar hecho.
    DB::table('fmcsa_verifications')
        ->where('carrier_id', $this->carrierId)
        ->update(['checked_at' => now()->subYears(2)]);

    expect(listaDe($this, $this->carrierId)['fmcsa']['done'])->toBeFalse();
});

it('la fila de FMCSA va marcada como aviso', function (): void {
    // Hoy no impide despachar. Pintarla igual que las demás haría creer que sí.
    signIn($this->escenario, Role::Admin);

    $lista = listaDe($this, $this->carrierId);

    test()->assertArrayHasKey('fmcsa', $lista);
    expect($lista['fmcsa']['blocking'])->toBeFalse();
});

/* ── La columna ya no está ───────────────────────────────────────────────── */

it('la columna congelada no existe', function (): void {
    // Una columna que nadie escribe y que nadie puede leer sin equivocarse es
    // una trampa esperando a la siguiente persona.
    expect(Schema::hasColumn('carrier_onboardings', 'checklist'))->toBeFalse();
});

it('la lista se calcula igual desde el servicio', function (): void {
    // Que la pantalla y el servicio no puedan discrepar: es una sola fuente.
    app(TenantContext::class)->runAs($this->tenantId, function (): void {
        $lista = Readiness::checklist($this->tenantId, $this->carrierId);

        expect($lista)->not->toBe([]);

        foreach ($lista as $fila) {
            test()->assertArrayHasKey('key', $fila);
            test()->assertArrayHasKey('done', $fila);
            test()->assertArrayHasKey('blocking', $fila);
        }
    });
});
