<?php

declare(strict_types=1);

use App\Enums\Role;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Tests\Support\Scenario;

/**
 * La medida, no el razonamiento: quién ve cada nota al pedir la pantalla.
 *
 * Las pruebas de fuente comprueban que la puerta está escrita. Estas comprueban
 * que la puerta cierra, que es lo único que le importa a la empresa cuyo
 * despachador escribió «este transportista cobra de más» en un campo que
 * prometía no enseñárselo.
 */
uses(DatabaseTransactions::class);

beforeEach(function (): void {
    $this->escenario = Scenario::create();
    $this->transportista = $this->escenario->assignedCarrier;
    $this->carga = $this->escenario->load;

    DB::table('carriers')->where('id', $this->transportista->id)
        ->update(['notes' => 'NOTA-SOBRE-EL-TRANSPORTISTA']);

    // `special_instructions` en null a propósito: era el caso que enseñaba las
    // notas internas en el hueco de las instrucciones del conductor.
    DB::table('loads')->where('id', $this->carga->id)
        ->update(['internal_notes' => 'NOTA-SOBRE-LA-CARGA', 'special_instructions' => null]);
});

function props(TestResponse $r): array
{
    return json_decode((string) json_encode($r->viewData('page')['props'] ?? []), true);
}

it('el transportista no recibe las notas de su propia ficha', function (): void {
    signIn($this->escenario, Role::Carrier);

    $r = $this->get("/carriers/{$this->transportista->id}");

    $r->assertOk();
    test()->assertStringNotContainsString('NOTA-SOBRE-EL-TRANSPORTISTA', (string) $r->getContent());
    // `?? 'ausente'` no valdría: el operador dispara también con null, que es
    // justo el valor correcto. La clave tiene que estar y valer null.
    $carrier = props($r)['carrier'];
    test()->assertArrayHasKey('notes', $carrier);
    expect($carrier['notes'])->toBeNull();
});

it('el transportista no recibe las notas internas de su propia carga', function (): void {
    signIn($this->escenario, Role::Carrier);

    $r = $this->get("/loads/{$this->carga->id}");

    $r->assertOk();
    test()->assertStringNotContainsString('NOTA-SOBRE-LA-CARGA', (string) $r->getContent());
    $carga = props($r)['load'];
    test()->assertArrayHasKey('internalNotes', $carga);
    expect($carga['internalNotes'])->toBeNull();
});

it('y tampoco le decimos que la tarjeta existe', function (): void {
    // Un «Sin notas registradas» le contaría que hay un sitio donde se escriben
    // notas sobre él, y le mentiría los días que sí las hay.
    signIn($this->escenario, Role::Carrier);

    expect(props($this->get("/carriers/{$this->transportista->id}"))['can']['readInternalNotes'] ?? null)->toBeFalse();
    expect(props($this->get("/loads/{$this->carga->id}"))['can']['readInternalNotes'] ?? null)->toBeFalse();
});

it('el equipo sí las ve, que para eso las escribe', function (): void {
    // La mitad que se rompe sin querer al cerrar la otra: una puerta que cierra
    // para todos no arregla nada, borra la función.
    signIn($this->escenario, Role::Dispatcher);

    $r = $this->get("/carriers/{$this->transportista->id}");
    $r->assertOk();
    expect(props($r)['carrier']['notes'] ?? null)->toBe('NOTA-SOBRE-EL-TRANSPORTISTA')
        ->and(props($r)['can']['readInternalNotes'] ?? null)->toBeTrue();

    $r2 = $this->get("/loads/{$this->carga->id}");
    $r2->assertOk();
    expect(props($r2)['load']['internalNotes'] ?? null)->toBe('NOTA-SOBRE-LA-CARGA')
        ->and(props($r2)['can']['readInternalNotes'] ?? null)->toBeTrue();
});

it('contabilidad también es del equipo', function (): void {
    // Quien factura lee las notas del transportista para cobrar bien. Cerrar
    // por «no es despachador» habría sido cerrar de más.
    signIn($this->escenario, Role::Accounting);

    $r = $this->get("/carriers/{$this->transportista->id}");
    $r->assertOk();
    expect(props($r)['carrier']['notes'] ?? null)->toBe('NOTA-SOBRE-EL-TRANSPORTISTA');
});

it('las notas del cliente siguen sin salir por ningún lado', function (): void {
    // No estaban rotas; se comprueban porque la promesa es la misma y ahora hay
    // dónde escribirla.
    DB::table('customers')->where('id', $this->escenario->customer->id)
        ->update(['notes' => 'NOTA-SOBRE-EL-CLIENTE']);

    signIn($this->escenario, Role::Carrier);

    test()->assertStringNotContainsString(
        'NOTA-SOBRE-EL-CLIENTE',
        (string) $this->get("/loads/{$this->carga->id}")->getContent(),
    );
});
