<?php

declare(strict_types=1);

use App\Support\Security\SensitiveNumber;
use Tests\TestCase;

// Necesita la aplicación arrancada porque Crypt y la clave vienen del
// contenedor, pero no toca la base de datos.
uses(TestCase::class);

/*
| ADVERTENCIA: escritas sin poder ejecutarse (ver docs/testing.md). Todos los
| valores esperados se comprobaron llamando a SensitiveNumber a mano.
*/

it('devuelve las tres columnas juntas', function () {
    $c = SensitiveNumber::columns('TX-1234567');

    // O las tres o ninguna: escribir solo el cifrado dejaría el índice ciego
    // apuntando al número anterior, y la detección de duplicados encontraría a
    // la persona equivocada.
    expect($c['encrypted'])->toBeString()
        ->and($c['last4'])->toBe('4567')
        ->and($c['hash'])->toHaveLength(64);
});

it('el valor en claro no aparece en ninguna de las tres columnas', function () {
    $c = SensitiveNumber::columns('TX-1234567');

    foreach ($c as $value) {
        expect((string) $value)->not->toContain('1234567');
    }
});

it('descifra a la forma normalizada', function () {
    expect(SensitiveNumber::reveal(SensitiveNumber::columns('tx-123 4567')['encrypted']))
        ->toBe('TX1234567');
});

it('el mismo número escrito de varias formas da el mismo índice ciego', function (string $written) {
    // Es lo que hace que la detección de duplicados sirva: los guiones y los
    // espacios se los pone cada quien.
    expect(SensitiveNumber::hash($written))->toBe(SensitiveNumber::hash('TX1234567'));
})->with(['TX-1234567', 'tx 1234567', 'Tx.123.4567', '  TX1234567  ']);

it('números distintos dan índices distintos', function () {
    expect(SensitiveNumber::hash('TX1234567'))->not->toBe(SensitiveNumber::hash('TX1234568'));
});

it('cifrar dos veces el mismo valor da resultados distintos', function () {
    // Vector de inicialización aleatorio. Es POR ESO que hace falta un índice
    // ciego: sin él no habría forma de buscar un número sin descifrar la tabla
    // entera.
    expect(SensitiveNumber::columns('TX1234567')['encrypted'])
        ->not->toBe(SensitiveNumber::columns('TX1234567')['encrypted']);
});

it('un valor sin letras ni números se trata como ausente', function () {
    // Alguien pega «---» en el formulario. Lo que importa es que no reviente y
    // que no cree un índice ciego de la cadena vacía, que casaría con cualquier
    // otro campo vacío.
    expect(SensitiveNumber::columns('-- ..'))
        ->toBe(['encrypted' => null, 'last4' => null, 'hash' => null]);
});

it('nulo devuelve tres nulos', function () {
    expect(SensitiveNumber::columns(null))
        ->toBe(['encrypted' => null, 'last4' => null, 'hash' => null]);
});

it('descifrar basura devuelve nulo en vez de reventar', function () {
    // Un valor cifrado con una clave anterior. Una licencia ilegible es un
    // problema de datos, no motivo para tumbar la pantalla de un conductor.
    expect(SensitiveNumber::reveal('esto-no-es-un-payload-cifrado'))->toBeNull();
});
