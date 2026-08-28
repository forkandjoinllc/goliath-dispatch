<?php

declare(strict_types=1);

/**
 * lote19.php — La migración del lote 18, ahora reanudable.
 *
 * REQUIERE el lote 18 aplicado (sustituye su fichero de migración).
 *
 * QUÉ PASÓ
 *
 * MySQL no tiene DDL transaccional, y Laravel manda un `alter table` POR
 * COLUMNA. La migración del lote 18 añade doce. Una de esas doce órdenes murió
 * a mitad en tu servidor —o el despliegue se cortó—, y como la migración no
 * llegó a registrarse en `migrations`, el siguiente intento volvió a empezar
 * por la primera columna y se estrelló contra la que ya estaba:
 *
 *     SQLSTATE[42S21]: Duplicate column name 'twic_card'
 *
 * No sé cuál de las doce murió, y no me lo voy a inventar: el despliegue que la
 * dejó a medias no dejó rastro que yo pueda leer. Lo que sí sé es que adivinar
 * dónde se quedó es la respuesta equivocada.
 *
 * QUÉ CAMBIA
 *
 * Cada paso mira antes si ya está hecho: doce columnas, dos CHECK, tres claves
 * ajenas y un índice, cada uno con su comprobación contra information_schema.
 * Da igual en qué punto se quedara tu base de datos — la migración la termina
 * desde donde esté. Ejecutarla dos veces seguidas da el mismo resultado que
 * ejecutarla una. `down()` es igual de tolerante.
 *
 * Probado contra un MySQL 8.0.46 real con el esquema completo cargado:
 *
 *     desde cero ......................... 18 pasos
 *     otra vez ...........................  0 pasos
 *     desde tu estado (solo twic_card) ... 17 pasos
 *     resultado: 12 columnas, 6 restricciones, en los tres casos
 *
 * A partir de aquí toda migración que yo empaquete va a ser reanudable. Es la
 * segunda vez que un DDL a medias te rompe un despliegue, y las dos veces la
 * causa de fondo ha sido la misma: dar por hecho que una migración se ejecuta
 * entera o no se ejecuta.
 *
 * Cómo se ejecuta, desde la raíz del repositorio:
 *
 *     php lote19.php            # aplica
 *     php lote19.php --dry-run  # dice qué haría y no toca nada
 */

$raiz = __DIR__;
$dry = in_array('--dry-run', $argv, true);

$hechos = [];
$saltados = [];
$errores = [];

function ruta(string $rel): string
{
    global $raiz;

    return $raiz.DIRECTORY_SEPARATOR.$rel;
}

/** Escribe un fichero nuevo (o lo deja igual si ya tiene ese contenido). */
function nuevo(string $rel, string $contenido): void
{
    global $dry, $hechos, $saltados, $errores;

    $destino = ruta($rel);

    if (is_file($destino) && file_get_contents($destino) === $contenido) {
        $saltados[] = "= {$rel}";

        return;
    }

    $existia = is_file($destino);

    if ($dry) {
        $hechos[] = ($existia ? '~ ' : '+ ').$rel;

        return;
    }

    $dir = dirname($destino);

    if (! is_dir($dir) && ! mkdir($dir, 0775, true) && ! is_dir($dir)) {
        $errores[] = "no se pudo crear el directorio {$dir}";

        return;
    }

    if (file_put_contents($destino, $contenido) === false) {
        $errores[] = "no se pudo escribir {$rel}";

        return;
    }

    $hechos[] = ($existia ? '~ ' : '+ ').$rel;
}

/**
 * Aplica trozos anclados sobre un fichero existente.
 *
 * @param  list<array{0: string, 1: string}>  $pares
 */
function editar(string $rel, array $pares): void
{
    global $dry, $hechos, $saltados, $errores;

    $destino = ruta($rel);

    if (! is_file($destino)) {
        $errores[] = "falta {$rel} — ¿está en la raíz del repositorio?";

        return;
    }

    $texto = file_get_contents($destino);
    $aplicados = 0;
    $yaEstaban = 0;

    foreach ($pares as $i => [$antes, $despues]) {
        if (str_contains($texto, $despues)) {
            $yaEstaban++;

            continue;
        }

        $veces = substr_count($texto, $antes);

        if ($veces !== 1) {
            $errores[] = "{$rel}: el trozo #".($i + 1)." no encaja ({$veces} coincidencias). No se tocó el fichero.";

            return;
        }

        $texto = str_replace($antes, $despues, $texto);
        $aplicados++;
    }

    if ($aplicados === 0) {
        $saltados[] = "= {$rel} ({$yaEstaban} trozo(s) ya estaban)";

        return;
    }

    if ($dry) {
        $hechos[] = "~ {$rel} ({$aplicados} trozo(s))";

        return;
    }

    if (file_put_contents($destino, $texto) === false) {
        $errores[] = "no se pudo escribir {$rel}";

        return;
    }

    $hechos[] = "~ {$rel} ({$aplicados} trozo(s))";
}

foreach (['artisan', 'composer.json', 'app/Support/Navigation.php'] as $centinela) {
    if (! is_file(ruta($centinela))) {
        fwrite(STDERR, "Esto no parece la raíz del repositorio: falta {$centinela}.\n");
        exit(1);
    }
}

/* ── Ficheros nuevos ─────────────────────────────────────────────────── */

nuevo(
    "database/migrations/2026_08_30_100000_add_driver_qualifications.php",
    base64_decode('PD9waHAKCmRlY2xhcmUoc3RyaWN0X3R5cGVzPTEpOwoKdXNlIElsbHVtaW5hdGVcRGF0YWJhc2VcTWlncmF0aW9uc1xNaWdyYXRpb247CnVzZSBJbGx1bWluYXRlXERhdGFiYXNlXFNjaGVtYVxCbHVlcHJpbnQ7CnVzZSBJbGx1bWluYXRlXFN1cHBvcnRcRmFjYWRlc1xEQjsKdXNlIElsbHVtaW5hdGVcU3VwcG9ydFxGYWNhZGVzXFNjaGVtYTsKCi8qKgogKiBMbyBxdWUgaGFjZSBmYWx0YSBzYWJlciBkZSB1biBjb25kdWN0b3IgcGFyYSBkZWNpZGlyIHNpIHB1ZWRlIGxsZXZhciBVTkEKICogY2FyZ2EgY29uY3JldGEuCiAqCiAqIE5vIHNvbiBhdHJpYnV0b3Mgc3VlbHRvczogc29uIGxhcyByZXNwdWVzdGFzIGEgbG8gcXVlIHByZWd1bnRhbiBsYXMgY2FyZ2FzLgogKiBVbiBhbG1hY8OpbiBkZSBsYSBkZWZlbnNhIHBpZGUgVFdJQzsgdW5hIGNhcmdhIGRlIGV4cGxvc2l2b3MgcGlkZSBlbAogKiBlbmRvcnNlbWVudCBIOyB1biBjb250cmF0byBjb24gdW5hIGJhc2UgbWlsaXRhciBwdWVkZSBleGlnaXIgY2l1ZGFkYW7DrWEgcG9yCiAqIGVzY3JpdG87IHkgbXVjaG9zIGNsaWVudGVzIHBpZGVuIHVuIHLDqWNvcmQgbGltcGlvIGRlIE4gYcOxb3MuIExvcyBlbmRvcnNlbWVudHMKICogeWEgdml2w61hbiBlbiBgZHJpdmVycy5lbmRvcnNlbWVudHNgOyBsbyBkZW3DoXMgbm8gZXhpc3TDrWEuCiAqCiAqIFRSRVMgREVDSVNJT05FUyBRVUUgTk8gU09OIERFIEVTVElMTwogKgogKiAg4oCiICoqTmFkYSBkZSBlc3RvIHNlIHZlcmlmaWNhIHNvbG8uKiogTGEgcGxhdGFmb3JtYSBubyBjb25zdWx0YSBhbCBUU0EgbmkgYQogKiAgICB1biBNVlI6IGFsZ3VpZW4gbWlyYSBlbCBkb2N1bWVudG8geSBkZWphIGNvbnN0YW5jaWEgZGUgcXVlIGxvIG1pcsOzLCBjb24KICogICAgZmVjaGEgeSBjb24gc3Ugbm9tYnJlLiBQb3IgZXNvIGNhZGEgYmxvcXVlIGxsZXZhIGAuLi5fdmVyaWZpZWRfYXRgIHkKICogICAgYC4uLl92ZXJpZmllZF9ieV91c2VyX2lkYCwgeSBwb3IgZXNvIE5PIGV4aXN0ZSBuaW5ndW5hIGNvbHVtbmEgcXVlIGRpZ2EKICogICAgwqt2ZXJpZmljYWRvwrsgYSBzZWNhcy4gVmVyIGRvY3MvIOKAlCBudW5jYSBhZmlybWFtb3MgaGFiZXIgY29tcHJvYmFkbyBhbGdvCiAqICAgIHF1ZSBubyBjb21wcm9iYW1vcy4KICoKICogIOKAoiAqKmB3b3JrX2F1dGhvcml6YXRpb25gIGVzIE5VTExBQkxFIHkgc3UgdmFsb3IgcG9yIG9taXNpw7NuIGVzIMKrbm8KICogICAgY29uc3RhwrsuKiogRXMgdW4gZGF0byBzZW5zaWJsZTogc29sbyBzZSBndWFyZGEgY3VhbmRvIGFsZ3VpZW4gbG8gcmVnaXN0cmEKICogICAgYSBwcm9ww7NzaXRvLCB5IGVsIHNpc3RlbWEgbm8gbG8gaW5maWVyZSBuaSBsbyBleGlnZSBwYXJhIGRhciBkZSBhbHRhIGEKICogICAgbmFkaWUuIEZpbHRyYXIgY2FyZ2FzIHBvciBlc3RlIGNhbXBvIHNvbG8gZXMgZGVmZW5kaWJsZSBjdWFuZG8gbGEgY2FyZ2EKICogICAgZGVjbGFyYSBQT1IgRVNDUklUTyBkZSBkw7NuZGUgc2FsZSBlc2UgcmVxdWlzaXRvOyBlc28gc2UgZ3VhcmRhIGRlbCBsYWRvIGRlCiAqICAgIGxhIGNhcmdhLCBubyBhcXXDrS4gRXN0byBubyBlcyBhc2Vzb3JhbWllbnRvIGxlZ2FsLgogKgogKiAg4oCiICoqRWwgcsOpY29yZCBsaW1waW8gc2UgZ3VhcmRhIGNvbW8gwqtsaW1waW8gZW4gbG9zIMO6bHRpbW9zIE4gYcOxb3PCuyoqLCBubwogKiAgICBjb21vIHVuYSBsaXN0YSBkZSBpbmNpZGVudGVzLiBFcyBsbyBxdWUgcHJlZ3VudGFuIGxvcyBjbGllbnRlcyB5IGVzIGxvCiAqICAgIMO6bmljbyBxdWUgZWwgcXVlIG1pcmEgZWwgTVZSIHB1ZWRlIGFmaXJtYXIgc2luIGNvcGlhcnNlIGVsIGhpc3RvcmlhbAogKiAgICBlbnRlcm8gYSB1bmEgYmFzZSBkZSBkYXRvcyBxdWUgc2UgY29uc2VydmEgc2lldGUgYcOxb3MuCiAqCiAqIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgAogKiBQT1IgUVXDiSBFU1RBIE1JR1JBQ0nDk04gU0UgUFVFREUgVk9MVkVSIEEgRUpFQ1VUQVIKICoKICogTXlTUUwgbm8gdGllbmUgRERMIHRyYW5zYWNjaW9uYWwuIExhcmF2ZWwgbWFuZGEgdW4gYGFsdGVyIHRhYmxlYCBQT1IgQ09MVU1OQSwKICogYXPDrSBxdWUgdW5hIG1pZ3JhY2nDs24gcXVlIG11ZXJhIGEgbWl0YWQgZGVqYSBsYSBtaXRhZCBkZSBsYXMgY29sdW1uYXMgcHVlc3RhcwogKiB5IG5vIHNlIHJlZ2lzdHJhIGVuIGBtaWdyYXRpb25zYCDigJQgeSBhbCByZWludGVudGFybGEsIGxhIHByaW1lcmEgY29sdW1uYSBxdWUKICogeWEgZXhpc3RlIGxhIG1hdGEgY29uIHVuIDEwNjAuCiAqCiAqIEVzbyBmdWUgZXhhY3RhbWVudGUgbG8gcXVlIHBhc8OzIGVuIGVsIGRlc3BsaWVndWUgZGVsIDI4IGRlIGFnb3N0by4gTGEgc2FsaWRhCiAqIG5vIGVzIGFkaXZpbmFyIGTDs25kZSBzZSBxdWVkw7M6IGVzIHF1ZSBjYWRhIHBhc28gbWlyZSBhbnRlcyBzaSB5YSBlc3TDoSBoZWNoby4KICogRG9jZSBjb2x1bW5hcywgZG9zIENIRUNLLCB0cmVzIGNsYXZlcyBhamVuYXMgeSB1biDDrW5kaWNlLCBjYWRhIHVubyBjb24gc3UKICogY29tcHJvYmFjacOzbi4gRWplY3V0YXJsYSBkb3MgdmVjZXMgc2VndWlkYXMgZGEgZWwgbWlzbW8gcmVzdWx0YWRvIHF1ZQogKiBlamVjdXRhcmxhIHVuYS4KICog4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSACiAqLwpyZXR1cm4gbmV3IGNsYXNzIGV4dGVuZHMgTWlncmF0aW9uCnsKICAgIC8qKgogICAgICogY29sdW1uYSA9PiBkZWZpbmljacOzbiBTUUwsIGVuIGVsIG9yZGVuIGVuIHF1ZSBzZSBhw7FhZGVuLgogICAgICoKICAgICAqIEB2YXIgYXJyYXk8c3RyaW5nLCBzdHJpbmc+CiAgICAgKi8KICAgIHByaXZhdGUgYXJyYXkgJGNvbHVtbmFzID0gWwogICAgICAgICd0d2ljX2NhcmQnID0+ICJ0aW55aW50KDEpIG5vdCBudWxsIGRlZmF1bHQgJzAnIGFmdGVyIGBlbmRvcnNlbWVudHNgIiwKICAgICAgICAndHdpY19udW1iZXJfbGFzdDQnID0+ICd2YXJjaGFyKDQpIG51bGwgYWZ0ZXIgYHR3aWNfY2FyZGAnLAogICAgICAgICd0d2ljX2V4cGlyZXNfYXQnID0+ICdkYXRldGltZSgzKSBudWxsIGFmdGVyIGB0d2ljX251bWJlcl9sYXN0NGAnLAogICAgICAgICd0d2ljX3ZlcmlmaWVkX2F0JyA9PiAnZGF0ZXRpbWUoMykgbnVsbCBhZnRlciBgdHdpY19leHBpcmVzX2F0YCcsCiAgICAgICAgJ3R3aWNfdmVyaWZpZWRfYnlfdXNlcl9pZCcgPT4gJ2NoYXIoMzYpIG51bGwgYWZ0ZXIgYHR3aWNfdmVyaWZpZWRfYXRgJywKICAgICAgICAnd29ya19hdXRob3JpemF0aW9uJyA9PiAndmFyY2hhcigzMCkgbnVsbCBhZnRlciBgdHdpY192ZXJpZmllZF9ieV91c2VyX2lkYCcsCiAgICAgICAgJ3dvcmtfYXV0aG9yaXphdGlvbl92ZXJpZmllZF9hdCcgPT4gJ2RhdGV0aW1lKDMpIG51bGwgYWZ0ZXIgYHdvcmtfYXV0aG9yaXphdGlvbmAnLAogICAgICAgICd3b3JrX2F1dGhvcml6YXRpb25fdmVyaWZpZWRfYnlfdXNlcl9pZCcgPT4gJ2NoYXIoMzYpIG51bGwgYWZ0ZXIgYHdvcmtfYXV0aG9yaXphdGlvbl92ZXJpZmllZF9hdGAnLAogICAgICAgICdyZWNvcmRfY2xlYW5feWVhcnMnID0+ICd0aW55aW50IHVuc2lnbmVkIG51bGwgYWZ0ZXIgYHdvcmtfYXV0aG9yaXphdGlvbl92ZXJpZmllZF9ieV91c2VyX2lkYCcsCiAgICAgICAgJ3JlY29yZF9jaGVja2VkX2F0JyA9PiAnZGF0ZXRpbWUoMykgbnVsbCBhZnRlciBgcmVjb3JkX2NsZWFuX3llYXJzYCcsCiAgICAgICAgJ3JlY29yZF92ZXJpZmllZF9ieV91c2VyX2lkJyA9PiAnY2hhcigzNikgbnVsbCBhZnRlciBgcmVjb3JkX2NoZWNrZWRfYXRgJywKICAgICAgICAncmVjb3JkX25vdGVzJyA9PiAndGV4dCBudWxsIGFmdGVyIGByZWNvcmRfdmVyaWZpZWRfYnlfdXNlcl9pZGAnLAogICAgXTsKCiAgICBwdWJsaWMgZnVuY3Rpb24gdXAoKTogdm9pZAogICAgewogICAgICAgIGZvcmVhY2ggKCR0aGlzLT5jb2x1bW5hcyBhcyAkY29sdW1uYSA9PiAkZGVmaW5pY2lvbikgewogICAgICAgICAgICBpZiAoU2NoZW1hOjpoYXNDb2x1bW4oJ2RyaXZlcnMnLCAkY29sdW1uYSkpIHsKICAgICAgICAgICAgICAgIGNvbnRpbnVlOwogICAgICAgICAgICB9CgogICAgICAgICAgICBEQjo6c3RhdGVtZW50KCJhbHRlciB0YWJsZSBgZHJpdmVyc2AgYWRkIGB7JGNvbHVtbmF9YCB7JGRlZmluaWNpb259Iik7CiAgICAgICAgfQoKICAgICAgICBpZiAoISAkdGhpcy0+dGllbmVSZXN0cmljY2lvbignY2hrX2RyaXZlcnNfd29ya19hdXRob3JpemF0aW9uJykpIHsKICAgICAgICAgICAgREI6OnN0YXRlbWVudCgiCiAgICAgICAgICAgICAgICBhbHRlciB0YWJsZSBkcml2ZXJzCiAgICAgICAgICAgICAgICBhZGQgY29uc3RyYWludCBjaGtfZHJpdmVyc193b3JrX2F1dGhvcml6YXRpb24KICAgICAgICAgICAgICAgIGNoZWNrIChgd29ya19hdXRob3JpemF0aW9uYCBpcyBudWxsIG9yIGB3b3JrX2F1dGhvcml6YXRpb25gIGluICgKICAgICAgICAgICAgICAgICAgICAndXNfY2l0aXplbicsJ3Blcm1hbmVudF9yZXNpZGVudCcsJ2VtcGxveW1lbnRfYXV0aG9yaXphdGlvbicsJ290aGVyJwogICAgICAgICAgICAgICAgKSkKICAgICAgICAgICAgIik7CiAgICAgICAgfQoKICAgICAgICAvLyBDZXJvIGVzIMKrc2UgbWlyw7MgeSBoYXkgYWxnbyBkZW50cm8gZGVsIMO6bHRpbW8gYcOxb8K7LCBxdWUgTk8gZXMgbG8gbWlzbW8KICAgICAgICAvLyBxdWUgTlVMTCwgcXVlIGVzIMKrbm8gc2UgaGEgbWlyYWRvwrsuIFRyZWludGEgeSB1bm8gc2lnbmlmaWNhIMKrbcOhcyBkZQogICAgICAgIC8vIHRyZWludGHCuzogbGEgbGlzdGEgZGVsIGZvcm11bGFyaW8gYWNhYmEgYWjDrS4KICAgICAgICBpZiAoISAkdGhpcy0+dGllbmVSZXN0cmljY2lvbignY2hrX2RyaXZlcnNfcmVjb3JkX2NsZWFuX3llYXJzJykpIHsKICAgICAgICAgICAgREI6OnN0YXRlbWVudCgnCiAgICAgICAgICAgICAgICBhbHRlciB0YWJsZSBkcml2ZXJzCiAgICAgICAgICAgICAgICBhZGQgY29uc3RyYWludCBjaGtfZHJpdmVyc19yZWNvcmRfY2xlYW5feWVhcnMKICAgICAgICAgICAgICAgIGNoZWNrIChgcmVjb3JkX2NsZWFuX3llYXJzYCBpcyBudWxsIG9yIGByZWNvcmRfY2xlYW5feWVhcnNgIGJldHdlZW4gMCBhbmQgMzEpCiAgICAgICAgICAgICcpOwogICAgICAgIH0KCiAgICAgICAgZm9yZWFjaCAoWwogICAgICAgICAgICAndHdpY192ZXJpZmllZF9ieV91c2VyX2lkJyA9PiAnZmtfZHJpdmVyc190d2ljX3ZlcmlmaWVkX2J5X3VzZXInLAogICAgICAgICAgICAnd29ya19hdXRob3JpemF0aW9uX3ZlcmlmaWVkX2J5X3VzZXJfaWQnID0+ICdma19kcml2ZXJzX3dvcmtfYXV0aF92ZXJpZmllZF9ieV91c2VyJywKICAgICAgICAgICAgJ3JlY29yZF92ZXJpZmllZF9ieV91c2VyX2lkJyA9PiAnZmtfZHJpdmVyc19yZWNvcmRfdmVyaWZpZWRfYnlfdXNlcicsCiAgICAgICAgXSBhcyAkY29sdW1uYSA9PiAkbm9tYnJlKSB7CiAgICAgICAgICAgIGlmICgkdGhpcy0+dGllbmVSZXN0cmljY2lvbigkbm9tYnJlKSkgewogICAgICAgICAgICAgICAgY29udGludWU7CiAgICAgICAgICAgIH0KCiAgICAgICAgICAgIC8vIGBzZXQgbnVsbGAgeSBubyBgY2FzY2FkZWA6IHF1ZSB1biB1c3VhcmlvIHNlIGTDqSBkZSBiYWphIG5vIHB1ZWRlCiAgICAgICAgICAgIC8vIGJvcnJhciBhbCBjb25kdWN0b3IgY3V5byBUV0lDIHZlcmlmaWPDsy4gU2UgcGllcmRlIGVsIG5vbWJyZSwgbm8KICAgICAgICAgICAgLy8gZWwgaGVjaG8g4oCUIHkgbGEgcGlzdGEgZGUgYXVkaXRvcsOtYSBzaWd1ZSB0ZW5pw6luZG9sby4KICAgICAgICAgICAgREI6OnN0YXRlbWVudCgiCiAgICAgICAgICAgICAgICBhbHRlciB0YWJsZSBkcml2ZXJzCiAgICAgICAgICAgICAgICBhZGQgY29uc3RyYWludCB7JG5vbWJyZX0KICAgICAgICAgICAgICAgIGZvcmVpZ24ga2V5ICh7JGNvbHVtbmF9KSByZWZlcmVuY2VzIHVzZXJzIChpZCkgb24gZGVsZXRlIHNldCBudWxsCiAgICAgICAgICAgICIpOwogICAgICAgIH0KCiAgICAgICAgaWYgKCEgJHRoaXMtPnRpZW5lSW5kaWNlKCdkcml2ZXJzX3R3aWNfZXhwaXJ5X2lkeCcpKSB7CiAgICAgICAgICAgIERCOjpzdGF0ZW1lbnQoJ2NyZWF0ZSBpbmRleCBkcml2ZXJzX3R3aWNfZXhwaXJ5X2lkeCBvbiBkcml2ZXJzICh0ZW5hbnRfaWQsIHR3aWNfZXhwaXJlc19hdCknKTsKICAgICAgICB9CiAgICB9CgogICAgLyoqIENIRUNLIG8gY2xhdmUgYWplbmEsIHF1ZSBlbiBpbmZvcm1hdGlvbl9zY2hlbWEgdml2ZW4gZW4gbGEgbWlzbWEgdGFibGEuICovCiAgICBwcml2YXRlIGZ1bmN0aW9uIHRpZW5lUmVzdHJpY2Npb24oc3RyaW5nICRub21icmUpOiBib29sCiAgICB7CiAgICAgICAgcmV0dXJuIERCOjp0YWJsZSgnaW5mb3JtYXRpb25fc2NoZW1hLnRhYmxlX2NvbnN0cmFpbnRzJykKICAgICAgICAgICAgLT53aGVyZSgnY29uc3RyYWludF9zY2hlbWEnLCBEQjo6Z2V0RGF0YWJhc2VOYW1lKCkpCiAgICAgICAgICAgIC0+d2hlcmUoJ3RhYmxlX25hbWUnLCAnZHJpdmVycycpCiAgICAgICAgICAgIC0+d2hlcmUoJ2NvbnN0cmFpbnRfbmFtZScsICRub21icmUpCiAgICAgICAgICAgIC0+ZXhpc3RzKCk7CiAgICB9CgogICAgcHJpdmF0ZSBmdW5jdGlvbiB0aWVuZUluZGljZShzdHJpbmcgJG5vbWJyZSk6IGJvb2wKICAgIHsKICAgICAgICByZXR1cm4gREI6OnRhYmxlKCdpbmZvcm1hdGlvbl9zY2hlbWEuc3RhdGlzdGljcycpCiAgICAgICAgICAgIC0+d2hlcmUoJ3RhYmxlX3NjaGVtYScsIERCOjpnZXREYXRhYmFzZU5hbWUoKSkKICAgICAgICAgICAgLT53aGVyZSgndGFibGVfbmFtZScsICdkcml2ZXJzJykKICAgICAgICAgICAgLT53aGVyZSgnaW5kZXhfbmFtZScsICRub21icmUpCiAgICAgICAgICAgIC0+ZXhpc3RzKCk7CiAgICB9CgogICAgcHVibGljIGZ1bmN0aW9uIGRvd24oKTogdm9pZAogICAgewogICAgICAgIGlmICgkdGhpcy0+dGllbmVJbmRpY2UoJ2RyaXZlcnNfdHdpY19leHBpcnlfaWR4JykpIHsKICAgICAgICAgICAgREI6OnN0YXRlbWVudCgnZHJvcCBpbmRleCBkcml2ZXJzX3R3aWNfZXhwaXJ5X2lkeCBvbiBkcml2ZXJzJyk7CiAgICAgICAgfQoKICAgICAgICBmb3JlYWNoIChbCiAgICAgICAgICAgICdma19kcml2ZXJzX3R3aWNfdmVyaWZpZWRfYnlfdXNlcicsCiAgICAgICAgICAgICdma19kcml2ZXJzX3dvcmtfYXV0aF92ZXJpZmllZF9ieV91c2VyJywKICAgICAgICAgICAgJ2ZrX2RyaXZlcnNfcmVjb3JkX3ZlcmlmaWVkX2J5X3VzZXInLAogICAgICAgIF0gYXMgJG5vbWJyZSkgewogICAgICAgICAgICBpZiAoJHRoaXMtPnRpZW5lUmVzdHJpY2Npb24oJG5vbWJyZSkpIHsKICAgICAgICAgICAgICAgIERCOjpzdGF0ZW1lbnQoImFsdGVyIHRhYmxlIGRyaXZlcnMgZHJvcCBmb3JlaWduIGtleSB7JG5vbWJyZX0iKTsKICAgICAgICAgICAgfQogICAgICAgIH0KCiAgICAgICAgZm9yZWFjaCAoWydjaGtfZHJpdmVyc19yZWNvcmRfY2xlYW5feWVhcnMnLCAnY2hrX2RyaXZlcnNfd29ya19hdXRob3JpemF0aW9uJ10gYXMgJG5vbWJyZSkgewogICAgICAgICAgICBpZiAoJHRoaXMtPnRpZW5lUmVzdHJpY2Npb24oJG5vbWJyZSkpIHsKICAgICAgICAgICAgICAgIERCOjpzdGF0ZW1lbnQoImFsdGVyIHRhYmxlIGRyaXZlcnMgZHJvcCBjaGVjayB7JG5vbWJyZX0iKTsKICAgICAgICAgICAgfQogICAgICAgIH0KCiAgICAgICAgJHByZXNlbnRlcyA9IGFycmF5X3ZhbHVlcyhhcnJheV9maWx0ZXIoCiAgICAgICAgICAgIGFycmF5X2tleXMoJHRoaXMtPmNvbHVtbmFzKSwKICAgICAgICAgICAgZm4gKHN0cmluZyAkYyk6IGJvb2wgPT4gU2NoZW1hOjpoYXNDb2x1bW4oJ2RyaXZlcnMnLCAkYyksCiAgICAgICAgKSk7CgogICAgICAgIGlmICgkcHJlc2VudGVzICE9PSBbXSkgewogICAgICAgICAgICBTY2hlbWE6OnRhYmxlKCdkcml2ZXJzJywgZnVuY3Rpb24gKEJsdWVwcmludCAkdGFibGUpIHVzZSAoJHByZXNlbnRlcyk6IHZvaWQgewogICAgICAgICAgICAgICAgJHRhYmxlLT5kcm9wQ29sdW1uKCRwcmVzZW50ZXMpOwogICAgICAgICAgICB9KTsKICAgICAgICB9CiAgICB9Cn07Cg=='),
);

/* ── Parte ───────────────────────────────────────────────────────────────── */

echo $dry ? "SIMULACIÓN (no se escribió nada)\n\n" : "lote19 — migración reanudable\n\n";

foreach ($hechos as $l) {
    echo "  {$l}\n";
}

if ($saltados !== []) {
    echo "\n  ya estaba:\n";
    foreach ($saltados as $l) {
        echo "    {$l}\n";
    }
}

if ($errores !== []) {
    echo "\nERRORES:\n";
    foreach ($errores as $l) {
        echo "  ! {$l}\n";
    }
    echo "\nNada de lo que falló se escribió a medias.\n";
    exit(1);
}

if (! $dry) {
    echo <<<'TXT'

Siguiente paso:

  php artisan migrate

No hay cambios de front: no hace falta npm run build.

Si quieres ver antes en qué estado quedó la tabla:

  php artisan tinker --execute="dump(collect(DB::select('show columns from drivers'))->pluck('Field')->filter(fn(\$c) => str_contains(\$c,'twic') || str_contains(\$c,'work_auth') || str_contains(\$c,'record_'))->values()->all());"

TXT;
}

exit(0);
