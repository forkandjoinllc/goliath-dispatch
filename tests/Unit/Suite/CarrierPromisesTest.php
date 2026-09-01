<?php

declare(strict_types=1);

use App\Support\Equipment\Eligibility;
use App\Support\Equipment\Media;

/**
 * Lo que el sitio público le promete al TRANSPORTISTA tiene que tener quien lo
 * cumpla.
 *
 * ## El defecto
 *
 * La página de transportistas hacía tres afirmaciones concretas, y dos eran
 * falsas:
 *
 *  1. «Su autoridad ante la FMCSA se revalida automáticamente cada 7 días.» El
 *     barrido AVISABA a una persona de que tocaba revalidar y ahí se acababa. Si
 *     nadie entraba a pulsar el botón, la foto del registro envejecía sola y la
 *     carga salía igual.
 *  2. «El VIN de su equipo se coteja con su certificado de seguro antes de poder
 *     asignarlo.» Cierta desde el lote 57.
 *  3. «Cada camión y remolque necesita al menos cuatro fotos antes de
 *     activarse.» `equipment_media` estaba vacía.
 *
 * Y la portada las juntaba las cuatro —FMCSA, COI/VIN, credenciales del
 * conductor y fotos— en un «se verifican automáticamente antes de asignar una
 * carga, no se detectan después».
 *
 * ## Qué comprueba
 *
 * Que las piezas que cumplen esas frases sigan ahí. No comprueba que la
 * verificación sea CORRECTA —eso lo hacen las pruebas de cada dominio— sino el
 * caso categórico, que es el que se coló durante todo el proyecto: que no las
 * cumpliera nadie.
 *
 * `tests/Unit` no arranca la aplicación: la raíz sube tres niveles.
 */
function raizPromesas(): string
{
    return dirname(__DIR__, 3);
}

/** El código de un fichero sin sus comentarios. */
function codigoDePromesasSinComentarios(string $ruta): string
{
    $codigo = '';

    foreach (token_get_all((string) file_get_contents($ruta)) as $token) {
        if (is_array($token) && in_array($token[0], [T_COMMENT, T_DOC_COMMENT], true)) {
            continue;
        }

        $codigo .= is_array($token) ? $token[1] : $token;
    }

    return $codigo;
}

it('el barrido revalida la autoridad, no solo avisa', function (): void {
    $codigo = codigoDePromesasSinComentarios(
        raizPromesas().'/app/Console/Commands/SweepNotifications.php'
    );

    expect(str_contains($codigo, 'Revalidation::sweep'))->toBeTrue(
        'El barrido volvió a limitarse a avisar. El sitio público dice que la autoridad ante la FMCSA '
        .'«se revalida automáticamente cada 7 días»: un aviso mensual que nadie atiende no es eso.'
    );
});

it('sin credenciales no se finge una comprobación', function (): void {
    $codigo = codigoDePromesasSinComentarios(
        raizPromesas().'/app/Support/Fmcsa/Revalidation.php'
    );

    expect(str_contains($codigo, 'isLive'))->toBeTrue(
        'La revalidación ya no comprueba si el proveedor está en vivo. Anotar una verificación simulada '
        .'con fecha de hoy dejaría a todos los transportistas al día y a nadie comprobado, y apagaría '
        .'el aviso que hoy sí funciona.'
    );
});

it('faltar fotos bloquea, y son cuatro lados', function (): void {
    expect(Media::ANGULOS)->toHaveCount(4)
        ->and(in_array(Eligibility::FALTAN_FOTOS, (new ReflectionClass(Eligibility::class))->getConstants(), true))
        ->toBeTrue();

    $codigo = codigoDePromesasSinComentarios(
        raizPromesas().'/app/Support/Equipment/Eligibility.php'
    );

    expect(str_contains($codigo, 'missingAngles'))->toBeTrue(
        'La regla de asignación ya no mira las fotos. El sitio público promete cuatro antes de activar la unidad.'
    );
});

it('las tres frases siguen estando donde creemos', function (): void {
    // Si alguien las reescribe, esta prueba lo dice y hay que revisar si lo que
    // se cumple sigue siendo lo que se promete.
    $es = (string) file_get_contents(raizPromesas().'/lang/es/marketing.json');
    $en = (string) file_get_contents(raizPromesas().'/lang/en/marketing.json');

    foreach ([['revalida automáticamente', $es], ['re-verified automatically', $en]] as [$frase, $texto]) {
        expect(str_contains($texto, $frase))->toBeTrue(
            "La promesa de revalidación cambió. Revisa si App\\Support\\Fmcsa\\Revalidation cumple lo que dice ahora."
        );
    }

    foreach ([['cuatro fotos', $es], ['four photos', $en]] as [$frase, $texto]) {
        expect(str_contains($texto, $frase))->toBeTrue(
            "La promesa de las fotos cambió. Revisa si App\\Support\\Equipment\\Media cumple lo que dice ahora."
        );
    }
});
