# El logo que podía traer un script

## El defecto

La validación de la subida del logo aceptaba `image/svg+xml`:

```php
'logo' => ['nullable', 'file', 'max:2048',
           'mimetypes:image/png,image/jpeg,image/webp,image/svg+xml'],
```

**Un SVG no es una imagen, es un documento.** Admite `<script>`, CSS y
`foreignObject`. Y ese fichero se sirve en `GET /b/{tenant}/logo`, que es
pública, sin sesión y sin firma —a propósito, y el docblock de la ruta explica
bien por qué: la página de rastreo la abre un cliente desde un correo, días
después—.

Medido subiendo un SVG con una etiqueta `<script>` dentro:

```
HTTP/1.1 200 OK
Content-Type: image/svg+xml
Content-Disposition: inline
Cache-Control: max-age=3600, public
```

Devuelto **byte a byte**. Sin `X-Content-Type-Options`. Sin
`Content-Security-Policy` — no hay ninguna en toda la aplicación. Sin pasar por
`Scanning`, que sí corre para cualquier documento que se sube a un
transportista.

Abrir esa dirección renderiza el SVG como un documento **en el origen de la
aplicación**, y ese origen es uno solo para todas las empresas. El administrador
de una podía dejar algo que corre en el dominio del producto para quien abra el
enlace, incluido un usuario de otra empresa.

## Lo que hace peor el hallazgo

El resto de la aplicación ya lo hacía bien. La **única** respuesta de fichero
que no usa `->download()` —que fuerza `Content-Disposition: attachment`, y un
fichero descargado no ejecuta nada— era precisamente esta, la pública. Mismo
patrón que los dos lotes anteriores: una regla que el código cumple en todas
partes menos en una, y la excepción es la que más expuesta está.

## Tres capas, y ninguna sobra

| Capa | Qué hace |
|---|---|
| **No se acepta** | `LogoImage::TIPOS` son PNG, JPEG y WEBP. SVG fuera: un logo no necesita ser un documento ejecutable. |
| **No se sirve** | La misma comprobación corre **al salir**. En disco puede haber logos de antes del cambio; así quedan cubiertos sin migración y sin borrarle a nadie su fichero: dejan de servirse, con el mismo 404 que no tener ninguno. |
| **Y si algo se colara** | `X-Content-Type-Options: nosniff` y `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox` en esa respuesta. |

**`getimagesizefromstring()` y no una lista de firmas escrita a mano.** O el
contenido se analiza como imagen de mapa de bits, o no. Comprobado con los tres
casos: un SVG no, un HTML tampoco, un PNG sí. Y el `Content-Type` que sale es el
**analizado**, no uno que venga del nombre del fichero: así la cabecera no puede
decir una cosa mientras el cuerpo es otra.

Después:

```
Content-Type: image/png
Content-Disposition: inline; filename="logo"
X-Content-Type-Options: nosniff
Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox
```

`inline` sigue haciendo falta —la página de rastreo tiene que pintarlo— pero el
nombre del fichero en disco ya no sale en la cabecera.

## Lo que apareció de paso

Mirando esa misma pantalla en el navegador salió esto, en los dos idiomas:

```
SETTINGS.BRAND.TEMPLATES.TRACKING.LINK
SETTINGS.BRAND.TEMPLATES.INVOICE.SENT
```

`t()` parte las claves por puntos. El diccionario guardaba
`templates: { "tracking.link": … }` —una clave **con el separador dentro**— así
que la búsqueda bajaba por `settings → brand → templates → tracking`, que no
existe, y `t()` devolvía la clave. La traducción estaba escrita en los dos
idiomas y no se había enseñado nunca.

Cinco claves así en total; dos se pintaban y tres estaban sin usar. Todas
renombradas a camelCase, y la pantalla convierte el evento con la misma forma
que ya usa `nav.status`. El guardián exige ahora que **ninguna clave de
diccionario contenga un punto**.

## El guardián

`tests/Unit/Suite/LogoSafetyTest.php` — 12 comprobaciones, **15 sabotajes**:

1. La validación no vuelve a admitir SVG, y su lista sale del catálogo en vez de
   estar escrita aparte —si se separaran, la regla de entrada y la de salida
   dejarían de coincidir—.
2. La pieza distingue una imagen de un documento: SVG, HTML y vacío se rechazan.
3. La ruta pública comprueba los bytes y se niega, y ya no delega en
   `Storage::response()`.
4. Las tres cabeceras siguen ahí, con `sandbox` dentro de la política.
5. **Ninguna otra respuesta de fichero se pinta en el navegador** — la regla que
   el resto de la aplicación ya cumplía, ahora exigida.
6. Ninguna clave de diccionario lleva un punto dentro.

`tests/Feature/Branding/LogoSafetyTest.php` — 7 pruebas que hacen la petición:
un SVG se rechaza, un SVG con nombre de PNG también, un PNG pasa, las cabeceras
salen, un logo guardado de antes que no sea imagen deja de servirse, y la ruta
sigue siendo pública sin sesión —que es la razón por la que las tres capas
tienen que estar—.

## Deuda con nombre

**No hay `Content-Security-Policy` en la aplicación.** Este lote pone una en la
respuesta del logo, que es donde el riesgo estaba medido. Una política global
para toda la aplicación es otra cosa: hay que inventariar lo que carga cada
página —Vite mete guiones en línea en desarrollo— y una CSP mal puesta rompe la
aplicación entera en silencio. No cabe aquí y no debería quedar sin hacer.

**La firma dibujada también puede llegar como SVG.** `Signatures\Signing`
guarda la marca con extensión `.svg` si la URL de datos lo dice, y quien firma
no tiene cuenta. No hay ninguna ruta que sirva ese fichero —solo se incrusta en
el PDF del certificado— así que no es la misma exposición; pero es el mismo
formato entrando por una puerta menos vigilada, y quien añada una pantalla que
lo enseñe tiene que leer esto antes.
