<?php

declare(strict_types=1);

use App\Support\Equipment\Measure;
use Tests\Support\Source;

/**
 * Pies y pulgadas por fuera, una sola cifra por dentro — y las dos mitades de
 * acuerdo.
 *
 * ## El defecto que vigila
 *
 * La conversión está escrita DOS veces y tiene que estarlo: el servidor suma
 * los pies y las pulgadas que llegan del formulario (`Support\Equipment\Measure`)
 * y el navegador parte la cifra guardada para enseñarla y para rellenar las
 * casillas (`resources/js/lib/measure.ts`). El navegador no puede leer una
 * constante de PHP.
 *
 * Dos copias de un número son dos copias que un día dicen cosas distintas. El
 * día que una diga diez, la ficha enseñará 63′ 6″ donde la base guarda 762
 * pulgadas y nadie lo notará hasta que un permiso salga mal —y un permiso mal
 * medido no es un error de pantalla, es un camión parado en una báscula.
 *
 * ## Y la pantalla no puede volver a pedir pulgadas sueltas
 *
 * Nadie mide un remolque en pulgadas. Las etiquetas decían «Largo (pulg)» y
 * obligaban a multiplicar de cabeza; la petición fue explícita: todas las
 * medidas de tractores y remolques, en pies y pulgadas por separado.
 */
function jsDeMedidas(): string
{
    return (string) file_get_contents(Source::root().'/resources/js/lib/measure.ts');
}

it('las dos mitades dicen doce', function (): void {
    expect(Measure::PULGADAS_POR_PIE)->toBe(12);

    test()->assertStringContainsString(
        'export const INCHES_PER_FOOT = '.Measure::PULGADAS_POR_PIE,
        jsDeMedidas(),
        'La pantalla y el servidor ya no convierten con el mismo número de pulgadas por pie.',
    );
});

it('la casilla de pulgadas no admite una duodécima', function (): void {
    // Doce pulgadas son un pie. Admitirlas dejaría dos maneras de escribir la
    // misma medida —«12 pies 14» y «13 pies 2»— y dos fichas idénticas que no
    // se parecen.
    $controlador = Source::sinComentarios(
        Source::root().'/app/Http/Controllers/App/EquipmentController.php',
    );

    test()->assertStringContainsString(
        "'max:'.(Measure::PULGADAS_POR_PIE - 1)",
        $controlador,
        'El tope de las pulgadas dejó de salir de la constante: si se escribe a mano, deja de moverse con ella.',
    );

    // Y la casilla tampoco, para que no haga falta llegar al servidor.
    test()->assertStringContainsString(
        'max={INCHES_PER_FOOT - 1}',
        (string) file_get_contents(Source::root().'/resources/js/components/Form/FeetInchesField.tsx'),
        'La casilla de pulgadas dejó de tener tope, o el tope dejó de salir de la constante.',
    );
});

it('ninguna etiqueta vuelve a pedir pulgadas sueltas', function (): void {
    foreach (['es' => 'pulg', 'en' => '(in)'] as $idioma => $marca) {
        $d = json_decode(
            (string) file_get_contents(Source::root()."/lang/{$idioma}/equipment.json"),
            true,
            512,
            JSON_THROW_ON_ERROR,
        );

        foreach (['length', 'width', 'height', 'deckHeight', 'wellLength'] as $medida) {
            $etiqueta = (string) ($d['form'][$medida] ?? '');

            expect($etiqueta)->not->toBe('', "Falta equipment.form.{$medida} en {$idioma}.");
            expect(str_contains($etiqueta, $marca))->toBeFalse(
                "«{$etiqueta}» vuelve a pedir la medida en pulgadas sueltas ({$idioma}).",
            );
        }
    }
});

it('el formulario pide las medidas en dos casillas', function (): void {
    $pantalla = (string) file_get_contents(
        Source::root().'/resources/js/pages/App/Equipment/Form.tsx',
    );

    test()->assertStringContainsString(
        "from '@/components/Form/FeetInchesField'",
        $pantalla,
    );

    foreach (['length', 'width', 'height', 'deck_height', 'well_length'] as $medida) {
        test()->assertStringContainsString(
            "campoMedida('{$medida}'",
            $pantalla,
            "La medida `{$medida}` dejó de pedirse en pies y pulgadas.",
        );
    }

    // Y la ficha las enseña como se toman: 13′ 6″, no 162.
    $ficha = (string) file_get_contents(
        Source::root().'/resources/js/pages/App/Equipment/Show.tsx',
    );

    test()->assertStringContainsString('formatInches', $ficha);
});
