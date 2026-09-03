<?php

declare(strict_types=1);

use Tests\Support\Source;

/**
 * La promesa del SITIO PÚBLICO tiene que tener quien la cumpla.
 *
 * ## El defecto
 *
 * `marketing.json` dice, en cinco sitios distintos —el paso 4 de «cómo
 * funciona», la página de servicios, la de clientes y dos descripciones de SEO—:
 *
 * > «Una vez despachada su carga, recibirá un enlace seguro por correo
 * > electrónico — no un usuario y contraseña.»
 *
 * No salía ningún correo. `public_tracking_links.recipient_email` se pedía en el
 * formulario, se guardaba, y no lo leía nadie; y nada se disparaba al despachar.
 *
 * Es el mismo patrón de los cuatro lotes anteriores con una diferencia que lo
 * empeora: **esta promesa es un argumento de venta y se la hacemos a alguien que
 * no es nuestro usuario.** Un cliente de la casa de despacho lee esa frase, no
 * le llega nada, y quien queda mal no somos nosotros.
 *
 * ## Qué comprueba
 *
 * Que el disparo exista. Un `grep` burdo, sí — pero el caso que se coló durante
 * todo el proyecto es el categórico: NADIE mandaba nada.
 *
 * Lo que NO comprueba, y conviene decirlo: que el correo llegue. Eso depende del
 * servidor de correo y no lo contesta una prueba.
 *
 * `tests/Unit` no arranca la aplicación: la raíz sube tres niveles.
 */
function raizEnlace(): string
{
    return dirname(__DIR__, 3);
}

/** El código de un fichero sin sus comentarios. */
function codigoDeEnlaceSinComentarios(string $ruta): string
{
    // El cuerpo vivía copiado en quince ficheros. Ver Tests\Support\Source:
    // no quitaba los espacios, y por eso varias agujas de esta carpeta no
    // podían casar con nada.
    return Source::sinComentarios($ruta);
}

it('la frase sigue estando donde creemos', function (): void {
    // Si alguien la reescribe o la quita, esta prueba lo dice y hay que revisar
    // si la puerta que la cumple sigue teniendo sentido.
    foreach (['es', 'en'] as $idioma) {
        $texto = (string) file_get_contents(raizEnlace()."/lang/{$idioma}/marketing.json");

        expect(str_contains($texto, $idioma === 'es' ? 'enlace seguro por correo' : 'secure link by email'))
            ->toBeTrue("La promesa del sitio público cambió en {$idioma}. Revisa si App\\Support\\Tracking\\CustomerLink sigue cumpliendo lo que dice ahora.");
    }
});

it('despachar manda el enlace al cliente', function (): void {
    $codigo = codigoDeEnlaceSinComentarios(
        raizEnlace().'/app/Http/Controllers/App/LoadController.php'
    );

    expect(str_contains($codigo, 'CustomerLink::sendForLoad'))->toBeTrue(
        'Despachar una carga ya no manda el enlace de rastreo. El sitio público lo promete en cinco sitios, '
        .'y se lo promete a alguien que no es nuestro usuario: el cliente de la casa de despacho.'
    );
});

it('el envío respeta el interruptor de la empresa y anota que salió', function (): void {
    $codigo = codigoDeEnlaceSinComentarios(
        raizEnlace().'/app/Support/Tracking/CustomerLink.php'
    );

    expect(str_contains($codigo, 'TrackingLinks::enabledFor'))->toBeTrue(
        'El envío automático se salta `public_tracking_enabled`. Un ajuste que la creación manual respeta '
        .'y el envío automático ignora es el mismo defecto de siempre por la puerta de atrás.'
    )->and(str_contains($codigo, 'TrackingLinks::markSent'))->toBeTrue(
        'No se anota que el correo salió. Con la dirección sola, a un cliente que dice que no le llegó nada '
        .'solo se le puede contestar «a esa dirección era».'
    );
});
