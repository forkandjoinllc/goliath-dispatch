<?php

declare(strict_types=1);

use App\Support\Branding\Templates;
use Tests\Support\Source;

/**
 * Un correo a un cliente no puede salir con las llaves puestas.
 *
 * ## El defecto
 *
 * Las dos plantillas editables viven juntas en la misma pantalla y NO ofrecen
 * las mismas fichas:
 *
 * | Evento | Fichas |
 * |---|---|
 * | `invoice.sent` | `{tenant}`, `{invoice}`, `{amount}`, `{url}` |
 * | `tracking.link` | `{tenant}`, `{url}` |
 *
 * Al guardar solo se comprobaba que el texto no pasara de 4000 caracteres. Y
 * `sustituir()` reemplaza ÚNICAMENTE las fichas que recibe, así que cualquier
 * otra sobrevive tal cual. Medido:
 *
 *     entra: «Enlace de {tenant}: {url}. Factura {invoice} por {amount}.»
 *     sale:  «Enlace de Demo Dispatch: https://… . Factura {invoice} por {amount}.»
 *
 * Eso es lo que se manda. El cliente de la casa de despacho recibe un correo
 * con llaves dentro, firmado por ellos, y nadie avisa: ni al guardar, ni al
 * enviar.
 *
 * ## Dos sitios, porque son dos momentos distintos
 *
 *  - **Al guardar** hay alguien delante que puede arreglarlo, y se le dice qué
 *    ficha sobra y cuáles admite ese correo.
 *  - **Al enviar** no hay nadie a quien preguntar. Una plantilla que no se
 *    puede rellenar NO SE USA: sale el texto de siempre, que siempre es
 *    correcto, y queda una advertencia en el registro. Es el único camino que
 *    alcanza a las plantillas guardadas ANTES de la validación.
 */
function raizFichas(): string
{
    return Source::root();
}

/* ── La detección ────────────────────────────────────────────────────────── */

it('una ficha que el evento no ofrece se detecta', function (): void {
    expect(Templates::fichasDesconocidas('tracking.link', 'Factura {invoice} por {amount} — {url}'))
        ->toBe(['amount', 'invoice']);
});

it('las que sí ofrece no se señalan', function (): void {
    expect(Templates::fichasDesconocidas('tracking.link', 'Enlace de {tenant}: {url}'))->toBe([])
        ->and(Templates::fichasDesconocidas('invoice.sent', '{tenant} {invoice} {amount} {url}'))->toBe([]);
});

it('la forma de doble llave también', function (): void {
    // `sustituir()` admite `{ficha}` y `{{ficha}}` a propósito: el diccionario
    // usa una llave y el esquema documenta dos. Una comprobación que mirara
    // solo una dejaría pasar la otra — justo la que alguien copia del esquema.
    expect(Templates::fichasDesconocidas('tracking.link', 'Doble {{invoice}} y suelta {url}'))
        ->toBe(['invoice']);
});

it('un texto vacío o nulo no es un error', function (): void {
    expect(Templates::fichasDesconocidas('tracking.link', null))->toBe([])
        ->and(Templates::fichasDesconocidas('tracking.link', '   '))->toBe([]);
});

it('lo que no parece una ficha se deja en paz', function (): void {
    // Llaves que no encierran un nombre no son fichas: un texto puede llevar
    // llaves por mil motivos y avisar de todas convertiría la comprobación en
    // ruido, que es como se acaba desactivando.
    expect(Templates::fichasDesconocidas('tracking.link', 'Horario {} y {9to5} y { }'))->toBe([]);
});

it('las dos listas de fichas siguen siendo distintas', function (): void {
    // Es la razón de ser de todo esto: si algún día las dos ofrecieran lo
    // mismo, nada de esto haría falta — y si se igualaran por accidente, la
    // comprobación dejaría de proteger sin que nadie lo notara.
    expect(Templates::FICHAS['tracking.link'])->not->toBe(Templates::FICHAS['invoice.sent']);

    foreach (Templates::EDITABLES as $evento) {
        expect(Templates::FICHAS[$evento] ?? null)->toBeArray("El evento {$evento} es editable y no declara sus fichas.");
    }
});

/* ── Al guardar ──────────────────────────────────────────────────────────── */

it('la pantalla comprueba las fichas antes de guardar nada', function (): void {
    $fuente = Source::compacta(raizFichas().'/app/Http/Controllers/App/TenantSettingController.php');

    test()->assertStringContainsString(
        'Templates::fichasDesconocidas(',
        $fuente,
        'Sin esto se guarda una plantilla que después manda llaves al cliente.',
    );

    // Los DOS campos: el asunto es lo primero que ve quien recibe el correo.
    test()->assertStringContainsString("foreach(['subject','body']as\$campo)", $fuente);

    // Y antes de escribir ninguna: guardar la primera y rechazar la segunda
    // dejaría la pantalla a medias sin decirlo.
    $posComprobacion = strpos($fuente, 'Templates::fichasDesconocidas(');
    $posGuardado = strpos($fuente, 'Templates::save(');

    expect($posComprobacion)->toBeInt()->and($posGuardado)->toBeInt();
    expect($posComprobacion)->toBeLessThan($posGuardado, 'La comprobación tiene que ir antes de guardar.');
});

it('el mensaje dice cuál sobra y cuáles admite', function (): void {
    // Un «esa ficha no vale» a secas manda a adivinar. El de la factura ya
    // decía cuántas cargas; esto es lo mismo aplicado aquí.
    foreach (['es', 'en'] as $idioma) {
        $d = json_decode((string) file_get_contents(raizFichas()."/lang/{$idioma}/settings.json"), true);
        $texto = $d['brand']['unknownTokens'] ?? null;

        expect($texto)->toBeString("Falta settings.brand.unknownTokens en {$idioma}.");
        test()->assertStringContainsString('{tokens}', (string) $texto, 'El mensaje tiene que decir cuál sobra.');
        test()->assertStringContainsString('{allowed}', (string) $texto, 'Y cuáles admite ese correo.');
    }
});

it('el rechazo llega al campo, no solo a la respuesta', function (): void {
    // Medido en el navegador antes de arreglarlo: el servidor devolvía 422 con
    // el nombre de la ficha que sobra, la pantalla no guardaba nada… y no
    // pintaba una sola línea. El usuario veía su texto intacto y ninguna
    // explicación, que desde su silla es indistinguible de «se guardó».
    //
    // La causa es que el servidor nombra el error `templates.0.body`, una ruta
    // con puntos que NO es una clave del formulario: `form.errors.body` no
    // existe. Hace falta leerla como cadena.
    $fuente = Source::sinComentarios(raizFichas().'/resources/js/pages/App/Settings/Index.tsx');

    test()->assertStringContainsString(
        '`templates.${i}.${campo}`',
        $fuente,
        'El error viene con la ruta con puntos; hay que buscarlo por esa clave.',
    );

    foreach (['templateSubject', 'templateBody'] as $campo) {
        test()->assertMatchesRegularExpression(
            "/settings\\.brand\\.{$campo}'\\)\\}\\s+error=\\{errorDe\\(/",
            $fuente,
            "El campo {$campo} tiene que pintar su propio error.",
        );
    }
});

/* ── Al enviar ───────────────────────────────────────────────────────────── */

it('una plantilla que no se puede rellenar no se usa', function (): void {
    $fuente = Source::compacta(raizFichas().'/app/Support/Branding/Templates.php');

    test()->assertStringContainsString(
        'self::utilizable($eventKey,$plantilla?->subject',
        $fuente,
        'El asunto propio tiene que pasar por la comprobación.',
    );

    test()->assertStringContainsString(
        'self::utilizable($eventKey,$plantilla?->body',
        $fuente,
        'Y el cuerpo también.',
    );

    // Y cae al texto de siempre, no a una cadena vacía: un correo sin cuerpo es
    // peor que uno con el texto estándar.
    test()->assertStringContainsString('return$porDefecto;', $fuente);
});

it('el descarte queda en el registro', function (): void {
    // Sin esto, la empresa manda el texto estándar durante meses creyendo que
    // manda el suyo, y nadie tiene por dónde empezar a mirar.
    $fuente = Source::compacta(raizFichas().'/app/Support/Branding/Templates.php');

    test()->assertStringContainsString('Log::warning(', $fuente);
    test()->assertStringContainsString("'unknown_tokens'=>\$desconocidas", $fuente);
});

it('sustituir sigue admitiendo las dos formas de llave', function (): void {
    // Si se quitara una, las plantillas escritas con esa forma dejarían de
    // rellenarse y saldrían con las llaves puestas — el mismo defecto por la
    // puerta de al lado.
    expect(Templates::sustituir('{a} y {{a}}', ['a' => 'X']))->toBe('X y X');
});
