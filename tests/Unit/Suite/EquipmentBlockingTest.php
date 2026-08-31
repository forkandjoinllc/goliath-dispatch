<?php

declare(strict_types=1);

use App\Support\Equipment\Eligibility;

/**
 * Los motivos de bloqueo de una unidad: uno por regla, una regla por motivo, y
 * una sola regla para todos los que la miran.
 *
 * ## El defecto que esto cierra
 *
 * El diccionario de equipos decía —y sigue diciendo— que una unidad pendiente de
 * verificar «no se puede poner en una carga hasta que alguien la haya revisado».
 * Era mentira: la asignación solo rechazaba `out_of_service`. Una frase falsa en
 * una pantalla se cree; un botón roto se nota.
 *
 * Y había un segundo filo: el desplegable de asignación marcaba en regla lo que
 * la puerta iba a rechazar. Ahí el usuario descubre el muro chocándose con él —
 * elige el camión, pulsa asignar, y sale un error que la lista no anticipaba.
 *
 * ## Qué comprueba
 *
 * 1. Que cada constante de `Eligibility` tenga su frase en los dos idiomas. Sin
 *    frase, la pantalla enseña la clave en crudo (ver App\Support\i18n: `t`
 *    devuelve la clave a propósito, para que se vea).
 * 2. Que no sobre ninguna frase. Una frase sin regla es exactamente el defecto
 *    original: la pantalla promete una puerta que no existe.
 * 3. Que la puerta y el desplegable lean LA MISMA regla. Si uno de los dos se
 *    la reimplementara, volverían a poder discrepar — y discreparon.
 *
 * `tests/Unit` no arranca la aplicación: la raíz sube tres niveles.
 */
function raizEquipo(): string
{
    return dirname(__DIR__, 3);
}

/** Las constantes de motivo de Eligibility. */
function motivosDeEquipo(): array
{
    $reflexion = new ReflectionClass(Eligibility::class);

    return array_values(array_filter(
        $reflexion->getConstants(),
        static fn (mixed $v, string $k): bool => is_string($v) && $k !== 'RESOURCES',
        ARRAY_FILTER_USE_BOTH,
    ));
}

/** El código de un fichero sin sus comentarios. Tres guardianes han pasado por no hacerlo. */
function codigoDeEquipoSinComentarios(string $ruta): string
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

it('cada motivo tiene su frase en los dos idiomas', function (): void {
    foreach (['es', 'en'] as $idioma) {
        $dicc = json_decode(
            (string) file_get_contents(raizEquipo()."/lang/{$idioma}/equipment.json"),
            true,
        );

        $frases = array_keys($dicc['blocking'] ?? []);
        $motivos = motivosDeEquipo();

        sort($frases);
        sort($motivos);

        expect($frases)->toBe(
            $motivos,
            "En {$idioma}, `equipment.blocking` y App\\Support\\Equipment\\Eligibility no dicen lo mismo. "
            .'Una regla sin frase enseña la clave en crudo; una frase sin regla promete una puerta que no existe, '
            .'que es el defecto que este guardián existe para cerrar.'
        );
    }
});

it('la puerta y el desplegable leen la misma regla', function (): void {
    $obligados = [
        // La puerta: rechaza la asignación.
        'app/Http/Controllers/App/LoadAssignmentController.php',
        // El desplegable: dice de antemano cuál no puede elegirse.
        'app/Http/Controllers/App/LoadController.php',
        // Y la ficha de la unidad, que explica por qué no aparece en ninguno.
        'app/Http/Controllers/App/EquipmentController.php',
    ];

    foreach ($obligados as $relativo) {
        $codigo = codigoDeEquipoSinComentarios(raizEquipo().'/'.$relativo);

        expect(str_contains($codigo, 'Eligibility::reasons'))->toBeTrue(
            "{$relativo} no usa App\\Support\\Equipment\\Eligibility. "
            .'Si reimplementa la regla, la pantalla y la puerta pueden discrepar — y discreparon: '
            .'el desplegable marcaba en regla unidades que la asignación iba a rechazar.'
        );
    }
});
