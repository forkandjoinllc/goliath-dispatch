<?php

declare(strict_types=1);

use App\Services\Vin\DecodedVin;
use App\Services\Vin\OfflineVinDecoder;
use App\Support\Equipment\Vin;
use App\Support\Equipment\Wmi;

/**
 * Lo que un VIN dice de sí mismo.
 *
 * El formulario de alta de un camión rellena marca, modelo y año a partir del
 * VIN. Dos de los tres salen del propio número sin preguntarle a nadie, y esa
 * aritmética es lo que se comprueba aquí — con VIN reales conocidos, no con
 * cadenas inventadas: un VIN inventado casi nunca cuadra el dígito de control,
 * y probar contra él demostraría lo contrario de lo que se quiere demostrar.
 */
it('reconoce la forma de un VIN', function (): void {
    expect(Vin::tieneForma('1M8GDM9AXKP042788'))->toBeTrue();

    // Dieciséis caracteres.
    expect(Vin::tieneForma('1M8GDM9AXKP04278'))->toBeFalse();

    // Con las letras prohibidas: se excluyen para no confundirlas con 1 y 0.
    foreach (Vin::PROHIBIDAS as $letra) {
        expect(Vin::tieneForma('1M8GDM9AXKP04278'.$letra))->toBeFalse("{$letra} no debería admitirse");
    }
});

it('cuadra el dígito de control de un VIN de verdad', function (): void {
    // El ejemplo canónico del estándar, cuyo dígito es una X.
    expect(Vin::sumaBien('1M8GDM9AXKP042788'))->toBeTrue();

    // Y uno real de otro fabricante, para no depender de un solo caso.
    expect(Vin::sumaBien('5YJ3E1EA6PF384836'))->toBeTrue();
});

it('rechaza un VIN con una errata', function (): void {
    // Cambiar UN carácter rompe la suma: es justo para lo que existe el dígito.
    expect(Vin::sumaBien('1M8GDM9AXKP042789'))->toBeFalse();
    expect(Vin::sumaBien('1M8GDM9AXKP042778'))->toBeFalse();
});

it('lee el año de la posición 10', function (): void {
    // `K` en el ciclo viejo, y la posición 7 numérica lo confirma.
    expect(Vin::ano('1M8GDM9AXKP042788', 2026))->toBe(1989);

    // `P` en el ciclo nuevo: 2023.
    expect(Vin::ano('5YJ3E1EA6PF384836', 2026))->toBe(2023);
});

it('no devuelve un año del futuro', function (): void {
    // La tabla se repite cada treinta años y la posición 7 no siempre sigue la
    // regla en remolques viejos. Un año que todavía no ha llegado es señal de
    // que el desempate falló, y entonces manda el otro ciclo.
    $ano = Vin::ano('5YJ3E1EA6PF384836', 2015);

    expect($ano)->not->toBeNull();
    expect($ano)->toBeLessThanOrEqual(2016);
});

it('el WMI dice el fabricante, y calla cuando no lo sabe', function (): void {
    expect(Wmi::de('1FUJGLDR8MLBA1101'))->toBe('Freightliner');
    expect(Wmi::de('1XKYDPHX1NJ421104'))->toBe('Kenworth');

    // Lo que la tabla no conoce se deja en blanco. Rellenar «Marca» con un
    // fabricante que no es sería peor que no rellenarla.
    expect(Wmi::de('5JYD53HB6MP310310'))->toBeNull();
});

it('la tabla de fabricantes está bien formada', function (): void {
    foreach (Wmi::FABRICANTES as $wmi => $fabricante) {
        expect(mb_strlen((string) $wmi))->toBe(3, "{$wmi} no son tres caracteres");
        expect(preg_match('/^[A-HJ-NPR-Z0-9]{3}$/', (string) $wmi))->toBe(1, "{$wmi} lleva un carácter que un VIN no tiene");
        expect(trim($fabricante))->not->toBe('', "{$wmi} no dice de quién es");
    }
});

/* ── El decodificador de respaldo ────────────────────────────────────────── */

it('el respaldo saca año y marca, y nunca modelo', function (): void {
    $r = (new OfflineVinDecoder)->decode('1FUJGLDR8MLBA1101');

    expect($r)->not->toBeNull();
    expect($r->make)->toBe('Freightliner');
    expect($r->year)->toBe(2021);

    // El modelo vive en las posiciones 4-8, que define cada fabricante.
    // Devolver algo ahí sería inventárselo.
    expect($r->model)->toBeNull();
    expect($r->sources)->toBe([DecodedVin::DEL_NUMERO]);
});

it('el respaldo no contesta a un VIN que no cuadra', function (): void {
    // Rellenar marca y año de un número mal copiado saca un vehículo
    // verosímil que NO es el que la persona tiene delante.
    expect((new OfflineVinDecoder)->decode('1M8GDM9AXKP042789'))->toBeNull();
});

it('el respaldo no se hace pasar por el servicio vivo', function (): void {
    expect((new OfflineVinDecoder)->isLive())->toBeFalse();
});

it('lo que ya se sabe no lo pisa el respaldo', function (): void {
    $dela = new DecodedVin(make: 'Peterbilt', model: '389', year: 2023, sources: [DecodedVin::DE_LA_NHTSA]);
    $suyo = new DecodedVin(make: 'Freightliner', model: null, year: 2021, sources: [DecodedVin::DEL_NUMERO]);

    $junto = $dela->completarCon($suyo);

    expect($junto->make)->toBe('Peterbilt');
    expect($junto->model)->toBe('389');
    expect($junto->year)->toBe(2023);
    expect($junto->sources)->toBe([DecodedVin::DE_LA_NHTSA, DecodedVin::DEL_NUMERO]);
});
