<?php

declare(strict_types=1);

use App\Support\Oversize\NeedsPapers;
use Tests\Support\Source;

use function PHPUnit\Framework\assertArrayHasKey;
use function PHPUnit\Framework\assertMatchesRegularExpression;
use function PHPUnit\Framework\assertStringContainsString;
use function PHPUnit\Framework\assertStringNotContainsString;

/**
 * Las dos puertas de papeles preguntan por las MISMAS banderas.
 *
 * ## El defecto
 *
 * `Guards::blocking` cerraba sus dos puertas —el permiso aprobado y la
 * validación del administrador— con la misma expresión escrita a mano:
 *
 * ```php
 * if ((bool) $load->is_oversize && $load->permit_ready_approved_at === null) {
 * ```
 *
 * `Evaluator` pone `is_oversize` y `is_overweight` por separado. Una carga de
 * maquinaria compacta —medidas legales, exceso de peso— sale con `is_oversize =
 * 0`, así que se despachaba sin permiso aprobado y sin validación.
 *
 * Y la pantalla de permisos SÍ la listaba: su consulta preguntaba por las dos
 * banderas. Le pintaba «pendiente de firma» y «todavía no aprobado» en rojo, y
 * quien lleva esa pantalla creía que esas dos columnas eran puertas. Para esa
 * carga eran etiquetas.
 *
 * La forma es conocida: la misma pregunta contestada en dos sitios acaba
 * contestándose distinto, y el sitio que se olvida es el que cierra la puerta
 * —el que muestra los datos casi nunca se olvida, porque se ve—.
 *
 * ## La segunda mitad de la frase
 *
 * La pantalla decía además, tajante, que «el despacho permanece bloqueado hasta
 * que un administrador valide esta evaluación». Eso solo es cierto con
 * `require_oversize_admin_validation` encendido, y viene APAGADO de fábrica. Por
 * eso `exigeValidacion()` vive en esta clase y no escondida en `Guards`: la
 * pantalla tiene que poder contestar la misma pregunta con el mismo código.
 */
function raizBanderas(): string
{
    return Source::root();
}

/** La pantalla sin sus comentarios: un comentario no cierra ninguna puerta. */
function pantallaBanderas(string $ruta): string
{
    $texto = (string) file_get_contents(raizBanderas().'/'.$ruta);
    $texto = (string) preg_replace('#/\*.*?\*/#s', '', $texto);

    return (string) preg_replace('#^\s*//.*$#m', '', $texto);
}

it('cada bandera declarada dice por qué necesita papeles', function (): void {
    expect(NeedsPapers::BANDERAS)->not->toBe([]);

    foreach (NeedsPapers::BANDERAS as $bandera => $motivo) {
        // El motivo es lo que obliga a pensar al añadir una bandera nueva. Sin
        // él, la lista se convierte en un `array` que alguien amplía sin mirar.
        expect(strlen($motivo))->toBeGreaterThan(40, "la bandera «{$bandera}» no dice por qué necesita papeles");
    }
});

it('las banderas declaradas son columnas reales de `loads`', function (): void {
    // Una bandera mal escrita haría que `laCarga()` devolviera siempre falso
    // para ella —`$carga->{$bandera} ?? false`— sin que nada se quejara: la
    // puerta se quedaría abierta en silencio, que es exactamente el defecto.
    //
    // Se comprueba contra el esquema en SQL y no contra la base de datos porque
    // estos guardianes no arrancan la aplicación a propósito.
    $esquema = (string) file_get_contents(raizBanderas().'/database/schema/04_loads_routes_permits_tables.sql');

    foreach (array_keys(NeedsPapers::BANDERAS) as $bandera) {
        assertMatchesRegularExpression(
            '/^\s+'.preg_quote($bandera, '/').'\s+tinyint\(1\)/m',
            $esquema,
            "«{$bandera}» no es una columna booleana de `loads`",
        );
    }
});

it('el sobrepeso solo cuenta como carga que necesita papeles', function (): void {
    // ESTE ES EL FALLO. Medidas legales, peso fuera de límite.
    expect(NeedsPapers::laCarga((object) ['is_oversize' => 0, 'is_overweight' => 1]))->toBeTrue();
    expect(NeedsPapers::laCarga((object) ['is_oversize' => 1, 'is_overweight' => 0]))->toBeTrue();
    expect(NeedsPapers::laCarga((object) ['is_oversize' => 1, 'is_overweight' => 1]))->toBeTrue();
    expect(NeedsPapers::laCarga((object) ['is_oversize' => 0, 'is_overweight' => 0]))->toBeFalse();

    // Y una carga a la que le falta la columna no es una carga con papeles: el
    // `??` está para que un objeto parcial no reviente, no para que invente.
    expect(NeedsPapers::laCarga((object) []))->toBeFalse();
});

it('las dos puertas de `Guards` preguntan por la pieza y no por una bandera', function (): void {
    $fuente = Source::compacta(raizBanderas().'/app/Support/Loads/Guards.php');

    // Las dos puertas, cada una con su condición completa.
    assertStringContainsString(
        'NeedsPapers::laCarga($load)&&$load->permit_ready_approved_at===null',
        $fuente,
        'la puerta del permiso aprobado dejó de usar NeedsPapers',
    );
    assertStringContainsString(
        'NeedsPapers::laCarga($load)&&$load->oversize_validated_at===null&&NeedsPapers::exigeValidacion(',
        $fuente,
        'la puerta de la validación dejó de usar NeedsPapers',
    );

    // Y ninguna bandera suelta: el `is_oversize` escrito a mano es de donde
    // vino el defecto, y `is_overweight` escrito a mano lo repetiría.
    foreach (array_keys(NeedsPapers::BANDERAS) as $bandera) {
        assertStringNotContainsString(
            "\$load->{$bandera}",
            $fuente,
            "`Guards` volvió a preguntar por «{$bandera}» a mano",
        );
    }

    // Y la copia privada del ajuste, que era la otra mitad del problema: dos
    // piezas contestando «¿esta empresa lo exige?» derivan.
    assertStringNotContainsString('requiresOversizeValidation', $fuente);
});

it('el listado de permisos y las puertas usan la misma pregunta', function (): void {
    $fuente = Source::compacta(raizBanderas().'/app/Http/Controllers/App/PermitController.php');

    assertStringContainsString('NeedsPapers::enConsulta(', $fuente);

    // El `||` escrito a mano en la consulta es lo que hacía que la pantalla
    // listara lo que la puerta no miraba. Si vuelve, vuelve la divergencia.
    assertStringNotContainsString("orWhere('loads.is_overweight'", $fuente);
    assertStringNotContainsString("where('loads.is_oversize',1)", $fuente);
});

it('la pantalla recibe si el bloqueo del que habla existe', function (): void {
    $fuente = Source::compacta(raizBanderas().'/app/Http/Controllers/App/PermitController.php');

    assertStringContainsString("'validationRequired'=>NeedsPapers::exigeValidacion(", $fuente);
    assertStringContainsString("'needsPapers'=>NeedsPapers::laCarga(\$carga)", $fuente);
});

it('la pantalla no afirma el bloqueo sin haberlo comprobado', function (): void {
    $pantalla = pantallaBanderas('resources/js/pages/App/Permits/Show.tsx');

    // La frase que bloquea va detrás de las dos condiciones. Antes se escribía
    // siempre, con el ajuste apagado incluido: alguien la leía, delegaba y
    // dejaba de mirar.
    $compacta = (string) preg_replace('/\s+/', '', $pantalla);

    assertStringContainsString('bloquea={validationRequired&&load.needsPapers}', $compacta);
    assertStringContainsString("bloquea?t('oversize.validation.blocks')", $compacta);
    assertStringContainsString(":t('oversize.validation.advisory')", $compacta);

    // Y la descripción sigue escribiéndose siempre: lo que se separó es la
    // afirmación del bloqueo, no el panel.
    assertStringContainsString("t('oversize.validation.description')", $compacta);
});

it('el diccionario separa lo que siempre es cierto de lo que depende del ajuste', function (): void {
    foreach (['es', 'en'] as $idioma) {
        $validacion = json_decode(
            (string) file_get_contents(raizBanderas()."/lang/{$idioma}/oversize.json"),
            true,
        )['validation'];

        foreach (['description', 'blocks', 'advisory', 'notFlagged'] as $clave) {
            assertArrayHasKey($clave, $validacion, "falta «{$clave}» en {$idioma}");
        }

        // La descripción se escribe SIEMPRE, así que no puede prometer un
        // bloqueo: esa era la frase falsa.
        $sinBloqueo = $idioma === 'es' ? 'bloquead' : 'blocked';
        assertStringNotContainsString(
            $sinBloqueo,
            mb_strtolower($validacion['description']),
            "la descripción de {$idioma} volvió a prometer un bloqueo incondicional",
        );
    }
});

it('el sembrador marca el sobrepeso por el mismo número que la evaluación', function (): void {
    // La demostración no tenía NI UNA carga con sobrepeso y medidas legales:
    // el sembrador comparaba `$weight` —lo que va encima del remolque— contra
    // las 80.000 libras, que son el límite del CONJUNTO. `Evaluator` compara
    // `gross_vehicle_weight_pounds` contra `max_gross_weight_pounds`.
    //
    // Así que el estado donde vivía el defecto de este lote no existía en la
    // demostración, y nadie podía tropezar con él mirando. Un sembrador que
    // calcula una bandera por su cuenta enseña estados que la aplicación no
    // produce — y esconde los que sí.
    $sembrador = Source::compacta(raizBanderas().'/database/seeders/DemoDataSeeder.php');

    assertStringContainsString(
        "'is_overweight'=>\$weight+32_000>DefaultRules::PESO_BRUTO",
        $sembrador,
        'el sembrador volvió a calcular el sobrepeso por su cuenta',
    );
    assertStringNotContainsString("'is_overweight'=>\$weight>80_000", $sembrador);

    // Y la evaluación sigue comparando el bruto, que es de donde sale el
    // criterio. Si esto cambia, el sembrador de arriba deja de estar alineado.
    $evaluador = Source::compacta(raizBanderas().'/app/Support/Oversize/Evaluator.php');

    assertStringContainsString('$entradas[\'grossWeightPounds\']??$entradas[\'weightPounds\']', $evaluador);
});

it('los motivos de bloqueo no dicen «sobredimensionada» de una carga con solo sobrepeso', function (): void {
    // El motivo se le enseña al despachador sobre ESTA carga. Decirle que es
    // sobredimensionada cuando no lo es es la misma media verdad, escrita en el
    // sitio donde más se lee.
    foreach ([['es', ['sobredimension', 'sobredimensionad']], ['en', ['oversize']]] as [$idioma, $prohibidas]) {
        $bloqueo = json_decode(
            (string) file_get_contents(raizBanderas()."/lang/{$idioma}/loads.json"),
            true,
        )['blocking'];

        foreach (['permitNotApproved', 'oversizeNotValidated'] as $clave) {
            foreach ($prohibidas as $palabra) {
                assertStringNotContainsString(
                    $palabra,
                    mb_strtolower($bloqueo[$clave]),
                    "«{$clave}» en {$idioma} sigue hablando solo de sobredimensión",
                );
            }
        }
    }
});
