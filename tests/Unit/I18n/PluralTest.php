<?php

declare(strict_types=1);

use App\Support\Plural;

/**
 * Concordancia de número.
 *
 * Durante seis lotes la aplicación decía «1 facturas», «1 cargas» y «1 años».
 * No es un detalle de estilo: es lo primero que hace parecer barato un producto
 * que se vende en dos idiomas.
 *
 * La regla es una sola y la aplican las dos mitades —`Plural::key()` en PHP y
 * `t()` en resources/js/lib/i18n.tsx—: con `n` igual a 1 se usa la clave
 * hermana `<clave>One`; con cualquier otro número, incluido el cero, la base.
 *
 * Esta prueba no comprueba que las frases estén bien escritas —eso no lo puede
 * saber— sino algo más útil: que sobre CADA clave con `{n}` alguien haya tomado
 * una decisión. O tiene hermana singular, o está en la lista de invariables con
 * su motivo. Una clave nueva con `{n}` no puede colarse sin que alguien elija.
 */

/**
 * Claves con `{n}` que NO concuerdan, y por qué.
 *
 * No es una lista de excepciones para acallar la prueba: cada línea es una
 * decisión sobre el idioma, y por eso lleva su motivo al lado.
 *
 * @var array<string, string>
 */
const INVARIABLES = [
    // Etiquetas ordinales: el número identifica, no cuenta.
    'carriers.form.contactN' => 'Rótulo: «Contacto 1», «Contacto 2».',
    'loads.form.stopNumber' => 'Rótulo: «Parada 1», «Parada 2».',

    // El sustantivo va antes del número o no existe.
    'platform.show.of' => 'Es el segundo miembro de «3 de 10»; el sustantivo está en la otra clave.',
    'dashboard.permissions.granted' => 'En español «1 de 57 permisos» es correcto: concuerda con el catálogo, no con n.',

    // Sin sustantivo detrás: adjetivos y abreviaturas invariables.
    'notifications.bell.unread' => '«1 sin leer» y «1 unread» son correctos.',
    'loads.eligibility.failsShort' => '«1 sin cumplir» es correcto.',
    'loads.eligibility.unknownShort' => '«1 sin constar» es correcto.',
    'leads.show.pounds' => '«lb» es una abreviatura de unidad y no lleva plural.',
];

/** @return array<string, string> clave con puntos => texto */
function todasLasClaves(string $locale): array
{
    $salida = [];

    foreach (glob(dirname(__DIR__, 3)."/lang/{$locale}/*.json") ?: [] as $ruta) {
        $espacio = basename($ruta, '.json');
        $datos = json_decode((string) file_get_contents($ruta), true, flags: JSON_THROW_ON_ERROR);

        foreach (aplanarClaves($datos) as $clave => $texto) {
            $salida["{$espacio}.{$clave}"] = $texto;
        }
    }

    return $salida;
}

/**
 * @param  array<string, mixed>  $nodo
 * @return array<string, string>
 */
function aplanarClaves(array $nodo, string $prefijo = ''): array
{
    $salida = [];

    foreach ($nodo as $clave => $valor) {
        $camino = $prefijo === '' ? (string) $clave : "{$prefijo}.{$clave}";

        if (is_array($valor)) {
            $salida += aplanarClaves($valor, $camino);

            continue;
        }

        if (is_string($valor)) {
            $salida[$camino] = $valor;
        }
    }

    return $salida;
}

it('sobre cada clave con un número se ha tomado una decisión', function () {
    foreach (['en', 'es'] as $locale) {
        $claves = todasLasClaves($locale);
        $sinDecidir = [];

        foreach ($claves as $clave => $texto) {
            if (! str_contains($texto, '{n}')) {
                continue;
            }

            // Las propias formas singulares llevan `{n}` y no necesitan hermana.
            if (str_ends_with($clave, 'One')) {
                continue;
            }

            if (array_key_exists($clave, INVARIABLES)) {
                continue;
            }

            if (! array_key_exists($clave.'One', $claves)) {
                $sinDecidir[] = $clave;
            }
        }

        sort($sinDecidir);

        expect($sinDecidir)->toBe([], implode("\n", [
            "Claves con {n} en «{$locale}» sin forma singular ni motivo para no tenerla:",
            ...$sinDecidir,
            '',
            'O se añade la clave hermana «…One», o se añade a INVARIABLES con su motivo.',
        ]));
    }
});

it('la lista de invariables no se queda con claves muertas', function () {
    // Una excepción que sobrevive a la clave que excusaba es ruido que el
    // siguiente tiene que investigar.
    $claves = todasLasClaves('es');
    $fantasmas = array_values(array_filter(
        array_keys(INVARIABLES),
        static fn (string $c): bool => ! array_key_exists($c, $claves),
    ));

    expect($fantasmas)->toBe([], 'Invariables que ya no existen: '.implode(', ', $fantasmas));
});

it('la forma singular dice algo distinto de la plural', function () {
    // Una hermana copiada del plural pasa la prueba de arriba y no arregla
    // nada. Aquí se exige que de verdad cambien.
    foreach (['en', 'es'] as $locale) {
        $claves = todasLasClaves($locale);
        $iguales = [];

        foreach ($claves as $clave => $texto) {
            if (! str_ends_with($clave, 'One')) {
                continue;
            }

            $base = substr($clave, 0, -3);

            if (($claves[$base] ?? null) === $texto) {
                $iguales[] = $clave;
            }
        }

        expect($iguales)->toBe([], "Formas singulares idénticas a su plural en «{$locale}»: ".implode(', ', $iguales));
    }
});

it('las dos mitades eligen la misma clave', function () {
    // `Plural::key` en PHP y `t()` en el cliente tienen que partir igual. Si
    // difirieran, la pantalla diría «1 comisión» y el mensaje de confirmación
    // «1 comisiones».
    expect(Plural::key('x', 1))->toBe('xOne');
    expect(Plural::key('x', 0))->toBe('x');
    expect(Plural::key('x', 2))->toBe('x');
    expect(Plural::key('x', '1'))->toBe('xOne');
});

it('el cliente aplica la misma regla', function () {
    // Se lee la implementación del cliente en vez de duplicarla: lo que se
    // comprueba es que sigue partiendo por «uno» y usando el sufijo `One`.
    $cliente = (string) file_get_contents(dirname(__DIR__, 3).'/resources/js/lib/i18n.tsx');

    expect($cliente)->toContain("Number(params.n) === 1");
    expect($cliente)->toContain("key + 'One'");
});
