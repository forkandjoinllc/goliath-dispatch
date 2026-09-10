<?php

declare(strict_types=1);

use Tests\Support\Source;

/**
 * Una lista de cumplimiento se calcula; no se guarda.
 *
 * ## El defecto
 *
 * La ficha del transportista pintaba vistos verdes —seguro, autoridad, contrato
 * firmado, FMCSA— leídos de la columna JSON `carrier_onboardings.checklist`.
 *
 * Nadie la escribía. En el alta se guardaba `json_encode([])` y ningún camino
 * la actualizaba; los únicos valores de verdad los ponía el sembrador de datos
 * de demostración. Así que con datos reales la tarjeta no salía nunca, y con
 * los de demostración salía un visto verde del día en que se sembró.
 *
 * ## Lo que hace peor el hallazgo
 *
 * El argumento en contra ya estaba escrito en el repositorio, en el docblock de
 * `App\Support\Onboarding\Readiness`:
 *
 * > SE CALCULA, NO SE GUARDA. `carrier_onboardings` tiene una columna
 * > `checklist` de tipo JSON y este servicio NO la escribe, a propósito: una
 * > lista guardada dice «listo» el día que se guardó y sigue diciéndolo el día
 * > que caduca el certificado de seguro.
 *
 * Ese servicio ya calculaba el estado en vivo, tirando de `Guards` —la misma
 * clase que decide si una carga se puede despachar—, y la pantalla de
 * Incorporación ya lo usaba. La ficha del transportista leía la columna.
 */
function raizLista(): string
{
    return Source::root();
}

/**
 * El cuerpo de un método, y solo ese.
 *
 * Cortar desde su nombre hasta el final del fichero mete dentro los métodos que
 * vienen detrás: el primer intento de este guardián se disparó con un
 * `'carrier_agreement'` que vive en `firmaDelAcuerdo()`, tres métodos más
 * abajo, y que no tiene nada que ver con la lista.
 */
function cuerpoDe(string $fuente, string $firma): string
{
    $desde = strpos($fuente, $firma);

    expect($desde)->toBeInt("No está el método {$firma}.");

    $resto = substr($fuente, $desde + strlen($firma));
    $siguiente = preg_match('/(public|private|protected)staticfunction/', $resto, $m, PREG_OFFSET_CAPTURE) === 1
        ? $m[0][1]
        : strlen($resto);

    return substr($resto, 0, $siguiente);
}

it('la columna congelada no se escribe ni se lee en ninguna parte', function (): void {
    // La forma exacta del defecto: mientras exista un sitio que la escriba,
    // vuelve a haber una lista que dice «listo» el día que se guardó.
    $culpables = [];

    $patron = '/[\'"]checklist[\'"]\s*=>|->checklist\b/';

    foreach (['app', 'database', 'tests/Support'] as $carpeta) {
        foreach (glob(raizLista()."/{$carpeta}/{,*/,*/*/,*/*/*/}*.php", GLOB_BRACE) ?: [] as $fichero) {
            if (str_contains($fichero, 'drop_frozen_onboarding_checklist')) {
                continue;
            }

            $fuente = Source::sinComentarios($fichero);

            if (preg_match($patron, $fuente) === 1) {
                $culpables[] = str_replace(raizLista().'/', '', $fichero);
            }
        }
    }

    // `CarrierController` sí puede nombrarla: es donde se manda la lista
    // CALCULADA a la pantalla.
    $culpables = array_values(array_filter(
        $culpables,
        fn (string $f): bool => $f !== 'app/Http/Controllers/App/CarrierController.php',
    ));

    expect($culpables)->toBe([], 'Estos ficheros vuelven a guardar o leer la lista congelada.');
});

it('la ficha manda la lista calculada', function (): void {
    $fuente = Source::compacta(raizLista().'/app/Http/Controllers/App/CarrierController.php');

    test()->assertStringContainsString(
        "'checklist'=>Readiness::checklist(",
        $fuente,
        'La ficha tiene que calcular la lista, no leer una columna.',
    );

    test()->assertStringNotContainsString('json_decode((string)$row->checklist', $fuente);
});

it('las filas salen del esquema y no de una lista escrita a mano', function (): void {
    // Un guardián que recorriera una lista escrita aquí no comprobaría nada:
    // sería mi lista contra mi lista. Lo que importa es que el servicio lea
    // `requiredDocuments`, que sale de `DocumentTypes::requiredFor`.
    $fuente = Source::compacta(raizLista().'/app/Support/Onboarding/Readiness.php');

    $lista = cuerpoDe($fuente, 'publicstaticfunctionchecklist(');

    test()->assertStringContainsString("foreach(\$estado['requiredDocuments']as\$tipo)", $lista);
    test()->assertStringContainsString("in_array(\$tipo,\$estado['approvedDocuments'],true)", $lista);

    // Y ni un tipo de documento escrito a mano en el método.
    expect(preg_match("/'(certificate_of_\w+|carrier_agreement|w9)'/", $lista))
        ->toBe(0, 'Hay un tipo de documento escrito a mano en la lista.');
});

it('la fila de FMCSA se marca como aviso', function (): void {
    // Hoy no impide despachar. Pintarla igual que las demás haría creer que sí.
    $fuente = Source::compacta(raizLista().'/app/Support/Onboarding/Readiness.php');

    $lista = cuerpoDe($fuente, 'publicstaticfunctionchecklist(');

    test()->assertStringContainsString("'key'=>'fmcsa'", $lista);
    test()->assertStringContainsString("'blocking'=>false", $lista);
    test()->assertStringContainsString("'blocking'=>true", $lista);
});

it('la pantalla dice que la lista es de ahora', function (): void {
    $pantalla = Source::sinComentarios(raizLista().'/resources/js/pages/App/Carriers/Show.tsx');

    test()->assertStringContainsString("t('carriers.onboarding.checklistNote')", $pantalla);
    test()->assertStringContainsString("t('carriers.onboarding.checklistWarningOnly')", $pantalla);

    // Y rotula cada papel con el mismo nombre que tiene en Documentos.
    test()->assertStringContainsString('t(`documents.types.${key}`)', $pantalla);

    foreach (['es', 'en'] as $idioma) {
        $d = json_decode((string) file_get_contents(raizLista()."/lang/{$idioma}/carriers.json"), true);

        expect($d['onboarding']['checklistNote'] ?? null)->toBeString("Falta checklistNote en {$idioma}.")
            ->and($d['onboarding']['checklistWarningOnly'] ?? null)->toBeString("Falta checklistWarningOnly en {$idioma}.")
            ->and($d['onboarding']['checklistItems']['fmcsa'] ?? null)->toBeString("Falta el rótulo de FMCSA en {$idioma}.");
    }
});

it('la ficha manda el diccionario que sus rótulos necesitan', function (): void {
    // Rotular con `documents.types.*` sin mandar ese diccionario deja la
    // pantalla enseñando la clave cruda.
    $fuente = Source::compacta(raizLista().'/app/Http/Controllers/App/CarrierController.php');

    test()->assertStringContainsString("usesDictionary(\$request,['carriers','documents','nav'])", $fuente);
});
