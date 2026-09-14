<?php

declare(strict_types=1);

use App\Support\Notifications\Channels;
use Illuminate\Foundation\Testing\DatabaseTransactions;

uses(DatabaseTransactions::class);

/**
 * Lo que la página pública dice hoy sobre los mensajes de texto.
 *
 * El guardián de `tests/Unit/Suite/SmsPromiseTest.php` lee los diccionarios.
 * Esto PIDE LA PÁGINA y lee lo que llega, que es lo único que demuestra que el
 * texto corregido es el que ve una persona — la sección se arma por bucle sobre
 * una lista de secciones, y una clave que se quedara fuera de esa lista pasaría
 * el guardián de diccionario sin pintarse nunca.
 */
function paginaPrivacidad(string $idioma): string
{
    return textoDeLaPagina((string) test()->get("/{$idioma}/privacy")->getContent());
}

/**
 * La respuesta con sus escapes Unicode deshechos.
 *
 * Inertia manda las traducciones dentro de un atributo HTML como JSON, y ese
 * JSON sale con `\u00ed` en vez de `í`. Buscar «no envía mensajes de texto»
 * sobre el contenido crudo NO CASA NUNCA — y lo peligroso no es el fallo, que
 * se ve, sino el acierto: una comprobación en negativo («que no diga X») con
 * una tilde dentro pasa siempre, con el defecto puesto y sin él.
 */
function textoDeLaPagina(string $crudo): string
{
    return (string) preg_replace_callback(
        '/\\\\u([0-9a-fA-F]{4})/',
        static fn (array $m): string => mb_convert_encoding(pack('H*', $m[1]), 'UTF-8', 'UTF-16BE'),
        $crudo,
    );
}

it('la página de privacidad no promete STOP ni HELP', function (string $idioma) {
    expect(Channels::SUPRIMIDOS)->toHaveKey('sms');

    $pagina = paginaPrivacidad($idioma);

    // El texto viaja dentro del JSON de Inertia con las comillas escapadas, así
    // que se busca sobre el contenido crudo tal cual.
    expect($pagina)->not->toContain('STOP');
    expect($pagina)->not->toContain('HELP');
})->with(['es', 'en']);

it('la página de privacidad dice que no se mandan mensajes de texto', function (string $idioma, string $frase) {
    expect(paginaPrivacidad($idioma))->toContain($frase);
})->with([
    ['es', 'no envía mensajes de texto'],
    ['en', 'does not send text messages'],
]);

it('la sección de SMS se pinta de verdad, con su número', function () {
    // Numerada entre las demás: si alguien la saca de `SECTIONS`, la política
    // deja de hablar de SMS y este lote se deshace en silencio.
    $pagina = paginaPrivacidad('es');

    expect($pagina)->toContain('smsConsentAndStop');
    expect($pagina)->toContain('Mensajes de texto (SMS)');
});

it('la lista de subencargados no nombra a nadie que no reciba datos', function (string $idioma, array $prohibidas) {
    $pagina = paginaPrivacidad($idioma);

    foreach ($prohibidas as $frase) {
        expect($pagina)->not->toContain($frase);
    }
})->with([
    ['es', ['entrega de SMS', 'mapas y rutas', 'datos de rastreo,']],
    ['en', ['SMS delivery', 'mapping and routing', 'tracking data providers,']],
]);

it('la descripción de la página para buscadores ya no anuncia consentimiento de SMS', function (string $idioma, string $prohibida, string $esperada) {
    // Esto sale en el `<head>` y es lo que enseña un buscador: la promesa más
    // barata de olvidar, porque no se ve mirando la página. Decía «incluido el
    // consentimiento de SMS y de rastreo» — la mitad cierta, y esa mitad es la
    // que hace creíble la otra.
    $cabecera = textoDeLaPagina((string) test()->get("/{$idioma}/privacy")->getContent());

    expect($cabecera)->not->toContain($prohibida);
    expect($cabecera)->toContain($esperada);
})->with([
    ['es', 'consentimiento de SMS', 'consentimiento de rastreo por GPS'],
    ['en', 'including SMS and tracking consent', 'including GPS tracking consent'],
]);
