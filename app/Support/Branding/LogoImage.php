<?php

declare(strict_types=1);

namespace App\Support\Branding;

/**
 * Qué puede ser un logo, decidido mirando los BYTES.
 *
 * ## El defecto
 *
 * La validación de la subida aceptaba `image/svg+xml`:
 *
 *     'logo' => ['nullable', 'file', 'max:2048',
 *                'mimetypes:image/png,image/jpeg,image/webp,image/svg+xml'],
 *
 * Un SVG **no es una imagen, es un documento**: admite `<script>`, CSS y
 * `foreignObject`. Y `BrandLogoController` lo sirve en `GET /b/{tenant}/logo`,
 * que es pública sin sesión y sin firma a propósito —la página de rastreo la
 * abre un cliente desde un correo—.
 *
 * Comprobado subiendo un SVG con una etiqueta `<script>` dentro:
 *
 * ```
 * HTTP/1.1 200 OK
 * Content-Type: image/svg+xml
 * Content-Disposition: inline
 * ```
 *
 * devuelto byte a byte, sin `X-Content-Type-Options`, sin
 * `Content-Security-Policy` —no hay ninguna en toda la aplicación— y sin pasar
 * por `Scanning`. Abrir esa dirección ejecuta ese guion **en el origen de la
 * aplicación**, que es uno solo para todas las empresas: el administrador de
 * una puede dejar algo que corra en el dominio del producto para quien abra el
 * enlace, incluido un usuario de otra empresa.
 *
 * El resto de la aplicación ya lo hacía bien: la ÚNICA respuesta de fichero que
 * no usa `->download()` —que fuerza `attachment` y no ejecuta nada— es
 * precisamente esta, la pública.
 *
 * ## Por qué mirar los bytes y no el tipo declarado
 *
 * `mimetypes:` de Laravel ya mira el contenido con finfo, y eso está bien para
 * la subida. Pero al SERVIR solo hay bytes en disco: los de un logo que se
 * subió antes de este cambio, cuando el SVG estaba permitido. Comprobarlos al
 * salir es lo que protege lo que ya está guardado, sin migración y sin borrarle
 * a nadie su fichero.
 *
 * `getimagesizefromstring()` es la herramienta correcta y no una lista de
 * firmas escrita a mano: o el contenido se analiza como imagen de mapa de bits,
 * o no. Un SVG no, un HTML tampoco. Comprobado con los tres.
 */
final class LogoImage
{
    /**
     * Los tipos que un logo puede ser.
     *
     * SVG NO está, y es la decisión de este lote: un logo no necesita ser un
     * documento ejecutable. Los tres que quedan cubren cualquier logo real, y
     * el texto de la pantalla dice ahora exactamente estos tres.
     *
     * @var list<string>
     */
    public const TIPOS = ['image/png', 'image/jpeg', 'image/webp'];

    /**
     * El tipo real de estos bytes, o null si no son una imagen admitida.
     *
     * Se devuelve el tipo ANALIZADO, no el que venga en una cabecera o en el
     * nombre del fichero: es lo que después se pone en `Content-Type`, y así
     * esa cabecera no puede decir una cosa mientras el cuerpo es otra.
     */
    public static function mime(string $bytes): ?string
    {
        if ($bytes === '') {
            return null;
        }

        $info = @getimagesizefromstring($bytes);

        if ($info === false) {
            return null;
        }

        $mime = $info['mime'] ?? null;

        return is_string($mime) && in_array($mime, self::TIPOS, true) ? $mime : null;
    }

    /** Si estos bytes son un logo que se puede servir. */
    public static function valid(string $bytes): bool
    {
        return self::mime($bytes) !== null;
    }

    /**
     * Las cabeceras con las que se sirve un logo.
     *
     * Tres capas, y ninguna sobra:
     *
     *  - `nosniff` — sin ella el navegador puede decidir por su cuenta que un
     *    fichero es HTML aunque la cabecera diga otra cosa.
     *  - `Content-Security-Policy: default-src 'none'; sandbox` — deja el
     *    documento sin permiso para cargar ni ejecutar nada. Es lo que protege
     *    un SVG que ya estuviera guardado, si algún día se volviera a admitir.
     *  - `Content-Disposition: inline` con nombre fijo — la página de rastreo
     *    tiene que poder pintarlo, así que `attachment` no vale aquí; lo que se
     *    quita es que el nombre del fichero salga en la cabecera.
     *
     * @return array<string, string>
     */
    public static function headers(string $mime): array
    {
        return [
            'Content-Type' => $mime,
            'Content-Disposition' => 'inline; filename="logo"',
            'X-Content-Type-Options' => 'nosniff',
            'Content-Security-Policy' => "default-src 'none'; style-src 'unsafe-inline'; sandbox",
            // Un logo cambia como mucho una vez al año y la página pública la
            // abre gente que recarga.
            'Cache-Control' => 'public, max-age=3600',
        ];
    }
}
