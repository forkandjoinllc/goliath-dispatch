<?php

declare(strict_types=1);

use App\Support\Documents\DocumentTypes;
use App\Support\Documents\ExpiryEffect;
use Tests\Support\Source;

/**
 * La promesa del vencimiento tiene que decir la verdad del tipo elegido.
 *
 * ## El defecto
 *
 * El formulario de subir un documento decía, bajo la casilla de la fecha:
 *
 * > Se le avisará {days} días antes, y la puerta de despacho bloquea en cuanto
 * > vence.
 *
 * La misma frase para los DIECISIETE tipos de su desplegable. La primera mitad
 * vale para todos —la barredora no mira el tipo—. La segunda vale para TRES:
 * `Guards::documentCompliance()` se llama una sola vez en todo el proyecto,
 * con `'carrier'`, y solo mira lo que `requiredFor('carrier')` declara
 * obligatorio.
 *
 * Media promesa verdadera es peor que una entera falsa: la mitad que se cumple
 * hace creíble la otra, y quien la lee deja de vigilar esa fecha a mano.
 *
 * ## Lo que vigila este fichero
 *
 * Que el efecto se CALCULE de las mismas funciones que consulta la puerta —no
 * de una lista paralela que pueda divergir—, que `DUENOS_VIGILADOS` siga siendo
 * el reflejo de las llamadas reales a `documentCompliance()`, y que las dos
 * pantallas digan lo que el efecto dice, en los dos idiomas.
 */
function raizVencimiento(): string
{
    return Source::root();
}

it('los dueños vigilados son los que la puerta consulta de verdad', function (): void {
    // El corazón del lote. `DUENOS_VIGILADOS` es lo único declarado a mano, y
    // esta prueba lo ata a `Guards.php`: si mañana aparece un
    // `documentCompliance('truck', ...)`, esto se pone rojo hasta que la lista
    // lo recoja — y entonces la copia de las dos pantallas se corrige sola,
    // porque sale calculada de aquí.
    $puerta = Source::compacta(raizVencimiento().'/app/Support/Loads/Guards.php');

    preg_match_all("/self::documentCompliance\('([a-z_]+)'/", $puerta, $m);

    $consultados = array_values(array_unique($m[1]));
    sort($consultados);

    $declarados = ExpiryEffect::DUENOS_VIGILADOS;
    sort($declarados);

    expect($consultados)->not->toBe([]);
    expect($consultados)->toBe($declarados);
});

it('el efecto se calcula, no se declara en una lista aparte', function (): void {
    // Una lista de tipos con su efecto al lado es una segunda opinión sobre el
    // comportamiento, y las segundas opiniones divergen. `of()` pregunta a
    // `requiredFor()`, que es lo mismo que pregunta la puerta.
    $registro = Source::compacta(raizVencimiento().'/app/Support/Documents/ExpiryEffect.php');

    $cuerpo = cuerpoDeVencimiento($registro, 'publicstaticfunctionof(', 'publicstaticfunctionbloquea(');

    expect($cuerpo)->toContain('DocumentTypes::requiredFor($dueno)');
    expect($cuerpo)->toContain('self::DUENOS_VIGILADOS');
});

it('cada dueño que la puerta NO vigila tiene su motivo escrito', function (): void {
    // Un hueco sin nombre se lee como un descuido y se arregla dos veces, o
    // como una decisión y no se arregla nunca.
    $duenosDelFormulario = ['carrier', 'driver', 'truck', 'trailer'];

    foreach ($duenosDelFormulario as $dueno) {
        if (in_array($dueno, ExpiryEffect::DUENOS_VIGILADOS, true)) {
            continue;
        }

        expect(ExpiryEffect::SIN_VIGILAR)->toHaveKey($dueno);
        expect(ExpiryEffect::SIN_VIGILAR[$dueno])->toBeString();
        expect(mb_strlen(ExpiryEffect::SIN_VIGILAR[$dueno]))->toBeGreaterThan(40);
    }

    // Y al revés: declarar sin motivo un dueño que sí se vigila sería una
    // excusa para algo que no hace falta excusar.
    foreach (array_keys(ExpiryEffect::SIN_VIGILAR) as $dueno) {
        expect(ExpiryEffect::DUENOS_VIGILADOS)->not->toContain($dueno);
    }
});

it('el registro cubre el catálogo entero', function (): void {
    // Un tipo nuevo sin efecto es un tipo sobre el que la pantalla no sabe qué
    // decir. Se calcula, así que esto no puede quedarse atrás por olvido — y
    // por eso mismo la prueba vale: si alguien vuelve a una lista a mano, falla.
    expect(array_keys(ExpiryEffect::map()))->toBe(DocumentTypes::all());
});

it('el formulario elige el aviso según el tipo, no uno fijo', function (): void {
    $pantalla = (string) file_get_contents(raizVencimiento().'/resources/js/pages/App/Documents/Form.tsx');

    expect($pantalla)->toContain("expiryEffects[form.data.document_type] === 'blocks'");
    expect($pantalla)->toContain('expirationHintBlocks');
    expect($pantalla)->toContain('expirationHintWarns');
    // Y contesta algo antes de que se elija tipo: en blanco, la casilla de
    // fecha se queda sin explicación ninguna.
    expect($pantalla)->toContain('expirationHintPick');

    // La clave vieja —la que prometía bloqueo para todos— tiene que haber
    // desaparecido de las dos pantallas Y de los dos diccionarios. Dejarla
    // suelta invita a volver a usarla.
    expect($pantalla)->not->toContain("'documents.form.expirationHint'");
});

it('la ficha del documento dice qué significa vencer, y lo del conductor aparte', function (): void {
    $pantalla = (string) file_get_contents(raizVencimiento().'/resources/js/pages/App/Documents/Show.tsx');

    expect($pantalla)->toContain("document.expiryEffect === 'blocks'");
    expect($pantalla)->toContain('expiryBlocks');
    expect($pantalla)->toContain('expiryWarns');

    // El conductor lleva su propia frase porque su caso NO es «no se comprueba
    // nada»: la puerta mira las columnas de su ficha en vez de sus documentos.
    // Decirle que no se comprueba nada sería la mentira contraria.
    expect($pantalla)->toContain("owner.type === 'driver'");
    expect($pantalla)->toContain('expiryWarnsDriver');
});

it('las tres frases existen en los dos idiomas, y la vieja en ninguno', function (): void {
    // Un detector escrito en un solo idioma deja pasar el otro. Ver
    // docs/testing.md.
    foreach (['es', 'en'] as $idioma) {
        $dic = json_decode(
            (string) file_get_contents(raizVencimiento()."/lang/{$idioma}/documents.json"),
            true,
        );

        foreach (['expirationHintPick', 'expirationHintBlocks', 'expirationHintWarns'] as $clave) {
            expect($dic['form'][$clave] ?? null)->toBeString();
            expect($dic['form'][$clave])->toContain('{days}');
        }

        foreach (['expiryBlocks', 'expiryWarns', 'expiryWarnsDriver'] as $clave) {
            expect($dic['detail'][$clave] ?? null)->toBeString();
        }

        expect($dic['form'])->not->toHaveKey('expirationHint');
    }
});

it('los dos controles mandan el efecto a su pantalla', function (): void {
    $control = Source::compacta(raizVencimiento().'/app/Http/Controllers/App/DocumentController.php');

    expect($control)->toContain("'expiryEffects'=>ExpiryEffect::map()");
    expect($control)->toContain("'expiryEffect'=>ExpiryEffect::of(");
});

/**
 * El cuerpo de un método, con sus DOS fronteras.
 *
 * Cortar hasta el final del fichero se traga los métodos de abajo. Ver
 * `docs/testing.md`.
 */
function cuerpoDeVencimiento(string $fuente, string $desde, string $hasta): string
{
    $i = strpos($fuente, $desde);
    $f = strpos($fuente, $hasta);

    expect($i)->not->toBeFalse();
    expect($f)->not->toBeFalse();
    expect($i)->toBeLessThan($f);

    return substr($fuente, $i, $f - $i);
}
