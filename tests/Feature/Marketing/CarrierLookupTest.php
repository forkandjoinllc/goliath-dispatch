<?php

declare(strict_types=1);

use App\Support\Forms\FormToken;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;

uses(DatabaseTransactions::class);

/**
 * La búsqueda en el registro federal desde el alta pública.
 *
 * El adaptador simulado es determinista por el último dígito del USDOT —ver
 * `MockFmcsaDirectory`— y eso es lo que hace comprobables los cuatro
 * desenlaces sin inventar un doble a mano:
 *
 *   · acaba en 0 → el registro contesta y no tiene a nadie
 *   · acaba en 1 → el proveedor falla
 *   · acaba en 2 → ficha con NOT AUTHORIZED
 *   · cualquier otro → ficha completa y autorizada
 */
function buscar(array $cuerpo = []): TestResponse
{
    return test()->postJson('/carrier-lookup', [
        'kind' => 'dot',
        'number' => '1234567',
        'form_token' => FormToken::issue('carrier_signup'),
        'hp_field' => '',
        ...$cuerpo,
    ]);
}

/* ── Los cuatro desenlaces ──────────────────────────────────────────────── */

it('un USDOT conocido trae nombre, domicilio y teléfono', function () {
    $r = buscar(['number' => '1234567'])->assertOk();

    expect($r->json('status'))->toBe('found');
    expect($r->json('carrier.legalName'))->toBe('DEMO CARRIER 1234567 LLC');
    expect($r->json('carrier.line1'))->not->toBeNull();
    expect($r->json('carrier.city'))->not->toBeNull();
    expect($r->json('carrier.postalCode'))->not->toBeNull();
    expect($r->json('carrier.phone'))->not->toBeNull();
});

it('distingue «no existe» de «el proveedor falló»', function () {
    // Las dos se arreglan de forma distinta: una escribiendo bien el número y
    // la otra esperando. Un solo «no se pudo» obligaría a la pantalla a mentir
    // en una de las dos.
    expect(buscar(['number' => '7654320'])->assertOk()->json('status'))->toBe('not_found');
    expect(buscar(['number' => '7654321'])->assertOk()->json('status'))->toBe('error');
});

it('un número con forma imposible ni se consulta', function () {
    expect(buscar(['number' => '12'])->assertOk()->json('status'))->toBe('invalid');
});

it('dice cuando el registro marca que no puede operar', function () {
    // No bloquea el alta —eso lo decide la casa al revisarla— pero no se lo
    // calla: rellenar veinte campos de alguien que no puede rodar y no
    // mencionarlo es la promesa falsa más cara de este formulario.
    $r = buscar(['number' => '7654322'])->assertOk();

    expect($r->json('status'))->toBe('found');
    expect($r->json('carrier.allowedToOperate'))->toBeFalse();
    expect($r->json('carrier.operatingStatus'))->toBe('NOT AUTHORIZED');
});

it('se puede buscar por MC y por DOT', function () {
    expect(buscar(['kind' => 'mc', 'number' => '445566'])->assertOk()->json('status'))->toBe('found');
});

/* ── Lo que NO sale por aquí ────────────────────────────────────────────── */

it('no dice si ese transportista ya está dado de alta', function () {
    /*
    | `CarrierController::lookup()` sí lo dice, y ahí dentro es lo más útil que
    | devuelve. Aquí fuera hay un desconocido sin sesión: con esa respuesta
    | enumera la cartera entera probando números.
    |
    | Se siembra un transportista con ESE USDOT justamente para que, si algún
    | día alguien copia el método de dentro, esta prueba se caiga.
    */
    $tenant = DB::table('tenants')->first();

    if ($tenant !== null) {
        DB::table('carriers')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $tenant->id,
            'legal_name' => 'SECRETO DEL CLIENTE LLC',
            'dot_number' => '1234567',
            'onboarding_status' => 'draft',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    $r = buscar(['number' => '1234567'])->assertOk();

    expect($r->json('existing'))->toBeNull();
    expect(json_encode($r->json()))->not->toContain('SECRETO DEL CLIENTE');
});

it('dice si fue una consulta de verdad o el simulado', function () {
    // Sin credenciales se ata el simulado. La pantalla necesita saberlo para
    // no presentar datos fabricados como venidos del registro federal.
    $r = buscar()->assertOk();

    expect($r->json('live'))->toBeFalse();
    expect($r->json('provider'))->toBe('mock');
    expect($r->json('checkedAt'))->not->toBeNull();
});

/* ── Las defensas ───────────────────────────────────────────────────────── */

it('sin sello válido no se consulta nada', function () {
    buscar(['form_token' => 'inventado.xxx'])
        ->assertStatus(422)
        ->assertJson(['status' => 'rejected']);
});

it('un sello de otro formulario no vale', function () {
    buscar(['form_token' => FormToken::issue('contact')])
        ->assertStatus(422)
        ->assertJson(['status' => 'rejected']);
});

it('el sello recién emitido SÍ vale para buscar', function () {
    /*
    | La pausa de tres segundos vale para los envíos y no para esto: a la
    | casilla del USDOT llega alguien con el número en la mano, lo pega y pulsa
    | buscar. Con la regla puesta, el camino rápido era el que se rechazaba.
    */
    buscar(['form_token' => FormToken::issue('carrier_signup')])->assertOk();
});

it('el campo trampa relleno corta la consulta', function () {
    buscar(['hp_field' => 'soy un robot'])->assertStatus(422);
});

it('el envío del formulario sigue exigiendo la pausa', function () {
    // Que la búsqueda la perdone no puede aflojar el envío.
    $resultado = FormToken::verify(FormToken::issue('carrier_signup'), 'carrier_signup');

    expect($resultado['valid'])->toBeFalse();
    expect($resultado['reason'])->toBe('too_fast');
});

it('un chorro de consultas desde una IP se corta', function () {
    /*
    | FMCSA es un servicio público y gratuito. Un formulario abierto que le
    | pega sin freno es la forma más rápida de que dejen de contestarnos — y
    | entonces se rompe también la ficha de dentro, que sí hace falta.
    |
    | Doce por hora le sobran a cualquier persona: se busca una vez, y dos si
    | se tecleó mal.
    */
    for ($i = 0; $i < 12; $i++) {
        buscar(['number' => '123456'.$i])->assertOk();
    }

    buscar(['number' => '1234567'])->assertStatus(429);
});
