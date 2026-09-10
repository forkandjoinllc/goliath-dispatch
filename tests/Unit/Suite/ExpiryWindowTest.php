<?php

declare(strict_types=1);

use App\Support\Compliance\ExpiryWindow;
use Tests\Support\Source;

/**
 * Un solo plazo de aviso para todo el producto.
 *
 * ## El defecto
 *
 * Ajustes deja fijar «Avisar de documentos por caducar (días)». Documentos y el
 * Panel lo respetaban; Conductores y Equipos llevaban `WARN_DAYS = 45` a fuego.
 *
 * Medido: ajuste en 20 días, licencia que caduca dentro de 30, y Conductores la
 * seguía listando como «Por vencer».
 *
 * ## Lo que hace peor el hallazgo
 *
 * El arreglo ya estaba escrito. `DocumentController::warnDays()` traía el
 * docblock de ESTE MISMO defecto —«Era una constante de 45 días que ignoraba esa
 * columna […] la aplicación avisaba con quince días más de los que la empresa
 * había pedido»— y hasta nombraba la regla: «los CUATRO sitios que lo usaban
 * […] tienen que contestar lo mismo, o la lista y el contador se contradicen».
 *
 * Se corrigió en Documentos y se quedó ahí. Las dos pantallas que siguieron con
 * la constante son donde viven la CDL, la tarjeta médica, la matrícula y la
 * inspección.
 */
function raizPlazo(): string
{
    return Source::root();
}

it('ninguna pantalla se guarda su propio plazo', function (): void {
    // La forma exacta del defecto. Copiar `warnDays()` a cada controlador
    // habría dejado tres sitios donde volver a divergir; por eso el guardián
    // mira TODOS los controladores, no solo los tres de la lista.
    $sospechosos = [];

    foreach (glob(raizPlazo().'/app/Http/Controllers/{,*/,*/*/}*.php', GLOB_BRACE) ?: [] as $fichero) {
        $fuente = Source::compacta($fichero);

        if (preg_match('/(WARN_DAYS|WARNING_DAYS|EXPIR\w*_DAYS)\s*=/i', $fuente) === 1) {
            $sospechosos[] = str_replace(raizPlazo().'/', '', $fichero);
        }
    }

    expect($sospechosos)->toBe([], 'Estos controladores se guardan su propio plazo de aviso.');
});

it('las tres pantallas que avisan pasan por el mismo sitio', function (): void {
    foreach (ExpiryWindow::PANTALLAS as $pantalla => $fichero) {
        $ruta = raizPlazo().'/'.$fichero;

        expect(file_exists($ruta))->toBeTrue("El registro nombra {$fichero} y no está.");

        $fuente = Source::compacta($ruta);

        test()->assertStringContainsString(
            'ExpiryWindow::',
            $fuente,
            "La pantalla {$pantalla} resuelve el plazo por su cuenta.",
        );
    }
});

it('el registro no se queda corto', function (): void {
    // Si mañana otra pantalla empieza a avisar de caducidades, tiene que
    // declararse aquí. Un `expiring=1` nuevo con su propio número es
    // exactamente cómo se llegó al defecto.
    $conFiltro = [];

    foreach (glob(raizPlazo().'/app/Http/Controllers/{,*/,*/*/}*.php', GLOB_BRACE) ?: [] as $fichero) {
        $fuente = Source::compacta($fichero);

        if (str_contains($fuente, "\$filters['expiring']") || str_contains($fuente, "'expiring'=>")) {
            $conFiltro[] = str_replace(raizPlazo().'/', '', $fichero);
        }
    }

    sort($conFiltro);
    $declaradas = array_values(ExpiryWindow::PANTALLAS);
    sort($declaradas);

    expect($conFiltro)->toBe($declaradas, 'Hay pantallas que avisan de caducidades y no están en el registro.');
});

it('el plazo sale de los ajustes de la empresa', function (): void {
    $fuente = Source::compacta(raizPlazo().'/app/Support/Compliance/ExpiryWindow.php');

    test()->assertStringContainsString('->documentWarningDays', $fuente);
    test()->assertStringNotContainsString('=45', $fuente, 'Un número a fuego es el defecto otra vez.');
});

it('lo que caduca hoy cuenta como próximo, no como caducado', function (): void {
    // Se comparan DÍAS y no marcas de tiempo. A las nueve de la mañana, una
    // licencia que vence hoy todavía vale, y decir lo contrario hace rechazar
    // una carga que sí podía salir.
    $fuente = Source::compacta(raizPlazo().'/app/Support/Compliance/ExpiryWindow.php');

    test()->assertStringContainsString('->startOfDay()', $fuente);
    test()->assertStringContainsString("\$dias<0=>'expired'", $fuente);
    test()->assertStringContainsString("\$dias<=self::days()=>'soon'", $fuente);
});

it('la etiqueta del ajuste sigue prometiendo esto en los dos idiomas', function (): void {
    foreach (['es', 'en'] as $idioma) {
        $d = json_decode((string) file_get_contents(raizPlazo()."/lang/{$idioma}/settings.json"), true);

        expect($d['ops']['docWarning'] ?? null)->toBeString("Falta settings.ops.docWarning en {$idioma}.")
            ->and($d['ops']['docWarningHint'] ?? null)->toBeString("Falta settings.ops.docWarningHint en {$idioma}.");
    }
});
