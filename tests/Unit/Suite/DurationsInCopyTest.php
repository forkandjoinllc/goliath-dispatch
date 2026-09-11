<?php

declare(strict_types=1);

use Tests\Support\Source;

/**
 * Ningún texto dice un número que el producto calcula.
 *
 * ## El defecto
 *
 * `documents.form.expirationHint` decía, en los dos idiomas:
 *
 * > Se le avisará **45 días** antes, y la puerta de despacho bloquea en cuanto
 * > vence.
 *
 * El aviso lo decide `ExpiryWindow`, o sea `tenant_settings`, con **30** por
 * defecto. Una empresa que hubiera puesto 20 recibía el aviso a 20. Quien leía
 * ese texto al subir una póliza planeaba la renovación contando con quince días
 * que el producto no le daba.
 *
 * ## Por qué esta prueba y no solo el arreglo
 *
 * Porque el lote anterior unificó ese plazo en las tres pantallas y **dejó este
 * texto en pie**. El guardián de aquel lote comprobaba que la clave del ajuste
 * existiera; no que ningún texto llevara el número escrito. Un número en el
 * diccionario es una copia del cálculo, y las copias se despistan — es el mismo
 * defecto que `WARN_DAYS = 45`, una capa más arriba.
 *
 * ## Lo que sí puede llevar número
 *
 * Un tramo que de verdad es fijo. Los de antigüedad del cobro —1-30, 31-60,
 * 61-90, más de 90— son el reparto de siempre en cobros y están escritos igual
 * en `PeriodReport`. Van declarados abajo, uno a uno y con su motivo: la lista
 * es corta a propósito, y añadir a ella es una decisión que se toma a
 * conciencia, no por hacer pasar la prueba.
 */
function raizTextos(): string
{
    return Source::root();
}

/**
 * Claves que pueden decir un número, y por qué.
 *
 * @return array<string, string>
 */
function duracionesFijas(): array
{
    return [
        // Tramos de cobro. Fijos en `PeriodReport::aging()` con el mismo
        // reparto, y cambiarlos obligaría a cambiar los dos sitios a la vez.
        'reports.aging.d1_30' => 'tramo fijo de la cartera',
        'reports.aging.d31_60' => 'tramo fijo de la cartera',
        'reports.aging.d61_90' => 'tramo fijo de la cartera',
        'reports.aging.d90plus' => 'tramo fijo de la cartera',
        'finance.invoice.aging.0-30' => 'tramo fijo de la cartera',
        'finance.invoice.aging.31-60' => 'tramo fijo de la cartera',
        'finance.invoice.aging.61-90' => 'tramo fijo de la cartera',

        // Formas del singular y tope de un desplegable: el número ES el texto.
        'drivers.form.moreThan30' => 'tope del desplegable de años limpios',
        'drivers.form.nYearsOne' => 'singular de «años»',
        'invoices.show.nDaysOne' => 'singular de «días»',

        // Atajo de fechas cuyo nombre es su definición.
        'report.filters.presets.weekly' => 'atajo de siete días, su nombre lo define',
    ];
}

it('ningún texto lleva escrito un plazo que se calcula', function (): void {
    $patron = '/\b\d+\s*(d[ií]as?|days?|horas?|hours?|meses|months?|años?|years?)\b/iu';
    $fijas = duracionesFijas();
    $culpables = [];

    foreach (['es', 'en'] as $idioma) {
        foreach (glob(raizTextos()."/lang/{$idioma}/*.json") ?: [] as $fichero) {
            $nombre = basename($fichero, '.json');

            // Las páginas de marketing describen el producto a quien todavía no
            // lo usa, y ahí un número redondo es una frase, no una promesa
            // operativa sobre SU empresa.
            if ($nombre === 'marketing') {
                continue;
            }

            $d = json_decode((string) file_get_contents($fichero), true);

            $recorrer = function (mixed $nodo, string $ruta) use (&$recorrer, $patron, $fijas, $nombre, &$culpables): void {
                if (is_array($nodo)) {
                    foreach ($nodo as $k => $v) {
                        $recorrer($v, $ruta === '' ? (string) $k : $ruta.'.'.$k);
                    }

                    return;
                }

                if (! is_string($nodo) || preg_match($patron, $nodo) !== 1) {
                    return;
                }

                // Un texto que recibe el número no lo lleva escrito.
                if (str_contains($nodo, '{')) {
                    return;
                }

                $clave = $nombre.'.'.$ruta;

                if (! array_key_exists($clave, $fijas)) {
                    $culpables[$clave] = $nodo;
                }
            };

            $recorrer($d, '');
        }
    }

    expect(array_keys($culpables))->toBe(
        [],
        'Estos textos llevan un plazo escrito. O el plazo es fijo y se declara en duracionesFijas(), o el texto tiene que recibirlo: '
            .json_encode($culpables, JSON_UNESCAPED_UNICODE),
    );
});

it('el aviso de caducidad recibe el número de la empresa', function (): void {
    foreach (['es', 'en'] as $idioma) {
        $d = json_decode((string) file_get_contents(raizTextos()."/lang/{$idioma}/documents.json"), true);

        test()->assertStringContainsString(
            '{days}',
            (string) ($d['form']['expirationHint'] ?? ''),
            "El aviso de caducidad en {$idioma} tiene que recibir el plazo, no llevarlo escrito.",
        );
    }

    $controlador = Source::compacta(raizTextos().'/app/Http/Controllers/App/DocumentController.php');
    test()->assertStringContainsString("'warnDays'=>ExpiryWindow::days()", $controlador);

    $pantalla = Source::sinComentarios(raizTextos().'/resources/js/pages/App/Documents/Form.tsx');
    test()->assertStringContainsString("t('documents.form.expirationHint', { days: String(warnDays) })", $pantalla);
});

it('la lista de excepciones no se traga el defecto que la hizo nacer', function (): void {
    // La salida fácil cuando esta prueba se pone roja es meter la clave nueva
    // en `duracionesFijas()` y seguir. Aquí están las que NO pueden entrar
    // nunca: son plazos que el producto calcula, y declararlos fijos sería
    // escribir la mentira en la lista de excepciones.
    $prohibidas = [
        'documents.form.expirationHint' => 'el plazo sale de tenant_settings',
    ];

    foreach ($prohibidas as $clave => $motivo) {
        test()->assertArrayNotHasKey(
            $clave,
            duracionesFijas(),
            "{$clave} no puede declararse fija: {$motivo}.",
        );
    }

    // Y la lista se queda corta a propósito: si crece mucho, ha dejado de ser
    // una lista de excepciones.
    expect(count(duracionesFijas()))->toBeLessThanOrEqual(20);
});

it('lo declarado como fijo sigue existiendo', function (): void {
    // Una lista de excepciones que nombra claves muertas deja de proteger sin
    // que nadie lo note: al borrar la clave, la excepción sobrevive y tapa a la
    // siguiente que se llame igual.
    foreach (duracionesFijas() as $clave => $motivo) {
        [$fichero, $resto] = explode('.', $clave, 2);

        $d = json_decode((string) file_get_contents(raizTextos()."/lang/es/{$fichero}.json"), true);

        $texto = $d;

        foreach (explode('.', $resto) as $paso) {
            $texto = is_array($texto) ? ($texto[$paso] ?? null) : null;
        }

        expect($texto)->toBeString("La excepción {$clave} ({$motivo}) ya no existe en el diccionario.");
    }
});
