<?php

declare(strict_types=1);

use App\Support\Branding\LogoImage;
use Tests\Support\Source;

/**
 * El logo de una empresa no puede traer instrucciones dentro.
 *
 * ## El defecto
 *
 * La validación de la subida aceptaba `image/svg+xml`. Un SVG **no es una
 * imagen, es un documento**: admite `<script>`, CSS y `foreignObject`. Y
 * `BrandLogoController` lo sirve en `GET /b/{tenant}/logo`, que es pública sin
 * sesión y sin firma —a propósito, para que la página de rastreo la pinte—.
 *
 * Medido subiendo un SVG con una etiqueta `<script>` dentro:
 *
 * ```
 * HTTP/1.1 200 OK
 * Content-Type: image/svg+xml
 * Content-Disposition: inline
 * ```
 *
 * devuelto byte a byte, sin `X-Content-Type-Options`, sin
 * `Content-Security-Policy` —no hay ninguna en toda la aplicación— y sin pasar
 * por `Scanning`. Abrir esa dirección ejecuta ese guion EN EL ORIGEN de la
 * aplicación, que es uno solo para todas las empresas.
 *
 * Y el resto de la aplicación ya lo hacía bien: la ÚNICA respuesta de fichero
 * que no usa `->download()` —que fuerza `attachment` y no ejecuta nada— era
 * precisamente esta, la pública.
 *
 * ## Tres capas, y ninguna sobra
 *
 * 1. **No se acepta.** Un logo no necesita ser un documento ejecutable.
 * 2. **No se sirve.** La comprobación corre también AL SALIR, porque en disco
 *    puede haber logos de antes del cambio. Así quedan cubiertos sin migración
 *    y sin borrarle a nadie su fichero.
 * 3. **Y si algo se colara, no se ejecuta.** `nosniff` y una
 *    `Content-Security-Policy` con `sandbox` en esa respuesta.
 */
function raizLogo(): string
{
    return Source::root();
}

/* ── No se acepta ────────────────────────────────────────────────────────── */

it('la subida ya no admite SVG', function (): void {
    expect(LogoImage::TIPOS)->toBe(['image/png', 'image/jpeg', 'image/webp'])
        ->and(LogoImage::TIPOS)->not->toContain('image/svg+xml');

    $fuente = Source::compacta(raizLogo().'/app/Http/Controllers/App/TenantSettingController.php');

    expect($fuente)->not->toContain('image/svg+xml', 'La validación volvió a admitir un formato ejecutable.');

    // Del catálogo y no de una lista escrita a mano: si se escribiera aparte,
    // la regla de entrada y la de salida se separarían.
    test()->assertStringContainsString(
        "'mimetypes:'.implode(',',LogoImage::TIPOS)",
        $fuente,
        'La lista de la validación tiene que salir de LogoImage.',
    );
});

it('la subida comprueba además los bytes', function (): void {
    // `mimetypes:` mira el contenido con finfo y está bien; esta segunda capa
    // es la MISMA que corre al servir, y tenerla en los dos sitios es lo que
    // impide guardar algo que la ruta pública después se niega a devolver.
    $fuente = Source::compacta(raizLogo().'/app/Http/Controllers/App/TenantSettingController.php');

    test()->assertStringContainsString('LogoImage::valid(', $fuente);
});

/* ── La pieza distingue una imagen de un documento ───────────────────────── */

it('un SVG no es una imagen', function (): void {
    $svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>void 0</script></svg>';

    expect(LogoImage::mime($svg))->toBeNull()
        ->and(LogoImage::valid($svg))->toBeFalse();
});

it('un HTML disfrazado tampoco', function (): void {
    expect(LogoImage::valid('<html><body>hola</body></html>'))->toBeFalse();
});

it('un fichero vacío tampoco', function (): void {
    expect(LogoImage::valid(''))->toBeFalse();
});

it('un PNG de verdad sí, y se dice de qué tipo es', function (): void {
    // Un PNG de 1×1, el más pequeño que existe.
    $png = base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==');

    expect(LogoImage::mime($png))->toBe('image/png');
});

it('el tipo que se devuelve es el ANALIZADO, no uno que venga de fuera', function (): void {
    // Es lo que después va en Content-Type: así esa cabecera no puede decir una
    // cosa mientras el cuerpo es otra.
    $fuente = Source::compacta(raizLogo().'/app/Support/Branding/LogoImage.php');

    test()->assertStringContainsString('getimagesizefromstring(', $fuente);
    test()->assertStringContainsString('in_array($mime,self::TIPOS,true)', $fuente);
});

/* ── No se sirve lo que no sea una imagen ────────────────────────────────── */

it('la ruta pública comprueba los bytes antes de devolverlos', function (): void {
    $fuente = Source::compacta(raizLogo().'/app/Http/Controllers/Public/BrandLogoController.php');

    test()->assertStringContainsString('LogoImage::mime($bytes)', $fuente, 'La ruta pública no mira lo que sirve.');
    test()->assertStringContainsString('abort_if($mime===null,404)', $fuente, 'Un logo que no es imagen tiene que dar 404, igual que no tener ninguno.');

    // Y ya no delega en Storage::response(), que deduce el tipo y manda inline
    // con el nombre del fichero.
    expect($fuente)->not->toContain('->response($clave', 'Volvió a servirse dejando que el disco decida el tipo.');
});

it('las cabeceras de la respuesta desactivan la ejecución', function (): void {
    $png = base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==');
    $cabeceras = LogoImage::headers((string) LogoImage::mime($png));

    expect($cabeceras['X-Content-Type-Options'] ?? null)->toBe('nosniff');
    expect($cabeceras['Content-Type'] ?? null)->toBe('image/png');

    $csp = $cabeceras['Content-Security-Policy'] ?? '';
    test()->assertStringContainsString("default-src 'none'", $csp);
    test()->assertStringContainsString('sandbox', $csp);

    // `inline` hace falta —la página de rastreo tiene que pintarlo— pero el
    // nombre del fichero no sale.
    test()->assertStringContainsString('inline', $cabeceras['Content-Disposition'] ?? '');
    expect($cabeceras['Content-Disposition'] ?? '')->not->toContain('.bin');
});

/* ── El resto de ficheros se siguen descargando, no pintando ─────────────── */

it('ninguna otra respuesta de fichero se pinta en el navegador', function (): void {
    // La regla que el resto de la aplicación ya cumplía: `->download()` fuerza
    // `attachment`, y un fichero descargado no ejecuta nada. El logo es la
    // excepción y por eso lleva las tres capas de arriba.
    $sospechosos = [];

    foreach (glob(raizLogo().'/app/Http/Controllers/**/*.php') ?: [] as $fichero) {
        $fuente = Source::compacta($fichero);

        if (str_contains($fuente, 'Storage::disk(\'local\')->response(')) {
            $sospechosos[] = basename($fichero);
        }
    }

    expect($sospechosos)->toBe(
        [],
        'Storage::response() manda Content-Disposition: inline y deduce el tipo del fichero. '.
        "Para servir algo a un navegador hace falta comprobar los bytes y poner cabeceras, como hace BrandLogoController:\n  ".
        implode("\n  ", $sospechosos),
    );
});

/* ── Ninguna clave de diccionario lleva el separador dentro ──────────────── */

it('ninguna clave de diccionario contiene un punto', function (): void {
    // `t()` parte las claves por puntos. Una clave que lleva uno dentro no se
    // puede encontrar NUNCA: la pantalla de ajustes enseñaba
    // «SETTINGS.BRAND.TEMPLATES.TRACKING.LINK» porque el diccionario guardaba
    // `templates: { "tracking.link": … }` y la búsqueda bajaba por
    // `templates → tracking`, que no existe. Traducido a los dos idiomas y sin
    // usarse nunca.
    $malas = [];

    foreach (glob(raizLogo().'/lang/*/*.json') ?: [] as $fichero) {
        $diccionario = json_decode((string) file_get_contents($fichero), true);

        $recorrer = static function (array $nodo, string $camino) use (&$recorrer, &$malas, $fichero): void {
            foreach ($nodo as $clave => $valor) {
                $completo = $camino === '' ? (string) $clave : $camino.'.'.$clave;

                if (str_contains((string) $clave, '.')) {
                    $malas[] = basename(dirname($fichero)).'/'.basename($fichero).': '.$completo;
                }

                if (is_array($valor)) {
                    $recorrer($valor, $completo);
                }
            }
        };

        $recorrer(is_array($diccionario) ? $diccionario : [], '');
    }

    expect($malas)->toBe(
        [],
        "Estas claves llevan un punto dentro y t() no las puede encontrar; la pantalla enseñará la clave:\n  ".
        implode("\n  ", $malas),
    );
});

it('la pantalla de ajustes convierte el evento en una clave buscable', function (): void {
    $fuente = (string) file_get_contents(raizLogo().'/resources/js/pages/App/Settings/Index.tsx');

    test()->assertStringContainsString(
        'claveDeEvento(plantilla.event)',
        $fuente,
        'El evento lleva un punto: sin convertirlo, la clave no se encuentra.',
    );

    test()->assertStringContainsString(
        'evento.replace(/[._]([a-z])/g',
        $fuente,
        'La conversión tiene que cubrir el punto Y el guion bajo.',
    );
});
