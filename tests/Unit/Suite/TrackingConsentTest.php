<?php

declare(strict_types=1);

use App\Support\Tracking\Consent;
use Tests\Support\Source;

/**
 * La frase que la pantalla de rastreo lleva prometiendo desde el primer día
 * tiene que seguir teniendo una puerta detrás.
 *
 * ## El defecto
 *
 * `tracking.consent.description` dice —y decía— que «el rastreo no puede
 * iniciarse hasta que el conductor otorgue su consentimiento, y se detiene de
 * inmediato si el consentimiento se retira». No había puerta, ni registro, ni
 * forma de retirarlo. `consent_records` estaba vacía, la fecha en `drivers` solo
 * se pintaba, y ni los sucesos de rastreo ni la acción de bitácora
 * `tracking.consent_changed` los escribía nadie.
 *
 * Lo que hace este caso peor que los tres lotes anteriores es sobre qué mentía:
 * la ubicación en vivo de una persona, enseñada además a terceros por un enlace
 * público.
 *
 * ## Qué comprueba
 *
 * 1. Que la puerta exista: quien abre una sesión llama a `Consent`. Un `grep`
 *    burdo, sí — pero el caso que se coló es el categórico: NADIE la llamaba.
 * 2. Que retirar el consentimiento cierre sesiones Y enlaces públicos. La
 *    segunda mitad es la que se olvida: parar el rastreo por dentro y seguir
 *    enseñándolo por fuera es no haberlo parado.
 * 3. Que la versión del texto esté puesta y no vacía. Un consentimiento sin
 *    versión no dice sobre qué se dio.
 *
 * Y lo que NO comprueba, porque no se puede y conviene decirlo: si el texto que
 * se enseña es suficiente donde quiera que esto se use. Eso es una cuestión
 * legal y no la contesta una prueba.
 *
 * `tests/Unit` no arranca la aplicación: la raíz sube tres niveles.
 */
function raizRastreo(): string
{
    return dirname(__DIR__, 3);
}

/** El código de un fichero sin sus comentarios. */
function codigoDeRastreoSinComentarios(string $ruta): string
{
    // El cuerpo vivía copiado en quince ficheros. Ver Tests\Support\Source:
    // no quitaba los espacios, y por eso varias agujas de esta carpeta no
    // podían casar con nada.
    return Source::sinComentarios($ruta);
}

it('el consentimiento tiene una versión', function (): void {
    expect(Consent::VERSION)->not->toBe('')
        ->and(Consent::TIPO)->toBe('tracking_location');
});

it('abrir una sesión de rastreo pasa por el consentimiento', function (): void {
    $codigo = codigoDeRastreoSinComentarios(raizRastreo().'/app/Support/Tracking/Sessions.php');

    expect(str_contains($codigo, 'Consent::permiteRastrear'))->toBeTrue(
        'App\\Support\\Tracking\\Sessions abre sesiones sin preguntar por el consentimiento. '
        .'La pantalla promete que no se puede iniciar el rastreo sin él: si esto falla, vuelve a ser mentira.'
    );
});

it('retirar el consentimiento cierra sesiones y enlaces públicos', function (): void {
    $codigo = codigoDeRastreoSinComentarios(raizRastreo().'/app/Support/Tracking/Sessions.php');

    // La función que corre al retirar tiene que tocar las dos tablas. Con solo
    // la primera, el rastreo se para por dentro y el enlace del cliente sigue
    // enseñando dónde está el camión.
    expect(str_contains($codigo, 'tracking_sessions'))->toBeTrue()
        ->and(str_contains($codigo, 'public_tracking_links'))->toBeTrue(
            'Retirar el consentimiento no revoca los enlaces públicos vivos. '
            .'Parar el rastreo por dentro y seguir enseñándolo por fuera es no haberlo parado.'
        );

    $consent = codigoDeRastreoSinComentarios(raizRastreo().'/app/Support/Tracking/Consent.php');

    expect(str_contains($consent, 'Sessions::cerrarPorRetirada'))->toBeTrue(
        'Retirar el consentimiento no cierra nada. «Se detiene de inmediato» es la mitad de la frase que importa.'
    );
});
