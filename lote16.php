<?php

declare(strict_types=1);

/**
 * lote16.php — Arregla la migración del lote 15, que reventó al desplegar.
 *
 * REQUIERE el lote 15 aplicado (este solo reemplaza su migración).
 *
 * QUÉ PASÓ
 *
 * `php artisan migrate` murió con:
 *
 *   SQLSTATE[HY000]: General error: 1215 Cannot add foreign key constraint
 *
 * al añadir `fk_carrier_contacts_carrier_xt`. La causa no es el índice ni la
 * colación: es una restricción de MySQL que dice
 *
 *   «A foreign key constraint on the base column of a STORED generated column
 *    cannot use CASCADE as ON UPDATE or ON DELETE referential action.»
 *
 * La columna generada `live_primary_key` —la que garantiza un solo contacto
 * principal vivo— se calculaba a partir de `carrier_id`, y `carrier_id` es
 * también columna de la clave ajena con ON DELETE CASCADE. Las dos cosas a la
 * vez no se pueden.
 *
 * QUÉ CAMBIA
 *
 *   • La columna generada pasa a ser una BANDERA que solo mira `deleted_at` e
 *     `is_primary`. `carrier_id` se va al ÍNDICE único, que no está sujeto a esa
 *     restricción. El invariante garantizado es idéntico: un principal vivo por
 *     transportista, y lo sigue garantizando la base de datos.
 *   • La migración empieza tirando la tabla huérfana. MySQL no tiene DDL
 *     transaccional, así que el intento fallido dejó `carrier_contacts` creada a
 *     medias y SIN registrar en `migrations`. Ese `dropIfExists` solo puede
 *     ejecutarse sobre restos: una migración ya registrada no vuelve a llamar a
 *     up().
 *
 * Nada más del lote 15 cambia. No hace falta volver a compilar el front.
 *
 * Cómo se ejecuta, desde la raíz del repositorio:
 *
 *     php lote16.php            # aplica
 *     php lote16.php --dry-run  # dice qué haría y no toca nada
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
 * Para cada par: si el resultado YA está, se salta; si el texto de partida está
 * una sola vez, se sustituye; en cualquier otro caso, se aborta el fichero
 * entero sin escribir. Un anclaje que no encaja significa que el fichero no es
 * el que este guion vio, y adivinar ahí es peor que parar.
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

// Comprobación mínima de que estamos donde toca.
foreach (['artisan', 'composer.json', 'app/Support/Navigation.php'] as $centinela) {
    if (! is_file(ruta($centinela))) {
        fwrite(STDERR, "Esto no parece la raíz del repositorio: falta {$centinela}.\n");
        exit(1);
    }
}

/* ── Ficheros nuevos ─────────────────────────────────────────────────── */

nuevo(
    "database/migrations/2026_08_28_100000_create_carrier_contacts.php",
    base64_decode('PD9waHAKCmRlY2xhcmUoc3RyaWN0X3R5cGVzPTEpOwoKdXNlIElsbHVtaW5hdGVcRGF0YWJhc2VcTWlncmF0aW9uc1xNaWdyYXRpb247CnVzZSBJbGx1bWluYXRlXERhdGFiYXNlXFNjaGVtYVxCbHVlcHJpbnQ7CnVzZSBJbGx1bWluYXRlXFN1cHBvcnRcRmFjYWRlc1xEQjsKdXNlIElsbHVtaW5hdGVcU3VwcG9ydFxGYWNhZGVzXFNjaGVtYTsKdXNlIElsbHVtaW5hdGVcU3VwcG9ydFxTdHI7CgovKioKICogVW4gdHJhbnNwb3J0aXN0YSB0aWVuZSBtw6FzIGRlIHVuYSBwZXJzb25hIGEgbGEgcXVlIGxsYW1hci4KICoKICogYGNhcnJpZXJzYCB0cmHDrWEgVU5BIGVuIGN1YXRybyBjb2x1bW5hcyBzdWVsdGFzIOKAlGBjb250YWN0X2ZpcnN0X25hbWVgLAogKiBgY29udGFjdF9sYXN0X25hbWVgLCBgZW1haWxgLCBgcGhvbmVg4oCUIHkgZXNvIG5vIGFndWFudGEgZWwgdXNvIHJlYWw6IGVsIHF1ZQogKiBmaXJtYSBlbCBjb250cmF0byBubyBlcyBlbCBxdWUgY29udGVzdGEgYSBsYXMgdHJlcyBkZSBsYSBtYcOxYW5hIGN1YW5kbyB1bgogKiBjYW1pw7NuIHNlIHBhcmEgZW4gbGEgSS0zNS4KICoKICogTGFzIGN1YXRybyBjb2x1bW5hcyB2aWVqYXMgTk8gc2UgYm9ycmFuLCB5IG5vIGVzIHBlcmV6YS4gU29uIE5PVCBOVUxMLCBtZWRpbwogKiBzaXN0ZW1hIGxhcyBsZWUg4oCUZWwgbGlzdGFkbywgbGFzIGZhY3R1cmFzLCBsb3MgY29ycmVvcyBkZSBpbmNvcnBvcmFjacOzbuKAlCB5CiAqIEZNQ1NBIGVzY3JpYmUgZW4gZWxsYXMgYWwgZGFyIGRlIGFsdGEuIExvIHF1ZSBzZSBoYWNlIGVzIGNvbnZlcnRpcmxhcyBlbiBlbAogKiBFU1BFSk8gZGVsIGNvbnRhY3RvIHByaW5jaXBhbDogbGEgdGFibGEgbWFuZGEsIHkgcXVpZW4gZ3VhcmRhIGNvcGlhIGVsCiAqIHByaW5jaXBhbCBhaMOtLiBBc8OtIG5hZGEgZGUgbG8gcXVlIHlhIGZ1bmNpb25hIHNlIGVudGVyYSBkZWwgY2FtYmlvLgogKgogKiBFbCByZXRyb2xsZW5hZG8gZGUgYWJham8gY3JlYSBlbCBjb250YWN0byBwcmluY2lwYWwgZGUgY2FkYSB0cmFuc3BvcnRpc3RhIHF1ZQogKiB5YSBleGlzdGUuIFNpbiDDqWwsIGFicmlyIHVuYSBmaWNoYSB2aWVqYSBlbnNlw7FhcsOtYSB1bmEgbGlzdGEgZGUgY29udGFjdG9zCiAqIHZhY8OtYSBqdW50byBhIHVuIGNvbnRhY3RvIHF1ZSBzw60gZXN0w6EgZW4gbGEgY2FiZWNlcmEg4oCUIHkgcXVpZW4gbG8gdmllcmEKICogcGVuc2Fyw61hLCBjb24gcmF6w7NuLCBxdWUgc2UgaGEgcGVyZGlkbyB1biBkYXRvLgogKgogKiDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIAKICogUE9SIFFVw4kgRUwgwqtVTiBTT0xPIFBSSU5DSVBBTMK7IE5PIFNFIEFQT1lBIEVOIFVOQSBDT0xVTU5BIEdFTkVSQURBIFNPQlJFCiAqIGBjYXJyaWVyX2lkYAogKgogKiBMYSBwcmltZXJhIHZlcnNpw7NuIGRlIGVzdGEgbWlncmFjacOzbiBjYWxjdWxhYmEgYGxpdmVfcHJpbWFyeV9rZXlgIGEgcGFydGlyIGRlCiAqIGBjYXJyaWVyX2lkYCwgY29tbyBoYWNlIGVsIHJlc3RvIGRlbCBlc3F1ZW1hIGNvbiBzdXMgw61uZGljZXMgw7puaWNvcyBwYXJjaWFsZXMuCiAqIE15U1FMIGxhIHJlY2hhesOzIGNvbiBlbCBlcnJvciAxMjE1IGFsIGHDsWFkaXIgbGEgY2xhdmUgYWplbmEsIHkgdGVuw61hIHJhesOzbjoKICoKICogICDCq0EgZm9yZWlnbiBrZXkgY29uc3RyYWludCBvbiB0aGUgYmFzZSBjb2x1bW4gb2YgYSBTVE9SRUQgZ2VuZXJhdGVkIGNvbHVtbgogKiAgICBjYW5ub3QgdXNlIENBU0NBREUgYXMgT04gVVBEQVRFIG9yIE9OIERFTEVURSByZWZlcmVudGlhbCBhY3Rpb24uwrsKICoKICogYGNhcnJpZXJfaWRgIGVzIGNvbHVtbmEgYmFzZSBkZSBsYSBnZW5lcmFkYSB5IGNvbHVtbmEgZGUgdW5hIGFqZW5hIGNvbgogKiBPTiBERUxFVEUgQ0FTQ0FERS4gTGFzIGRvcyBjb3NhcyBhIGxhIHZleiBubyBzZSBwdWVkZW4uCiAqCiAqIExhIHNhbGlkYSBlcyBxdWUgbGEgY29sdW1uYSBnZW5lcmFkYSBOTyBkZXBlbmRhIGRlIGBjYXJyaWVyX2lkYDogZXMgdW5hCiAqIGJhbmRlcmEgcXVlIHNvbG8gbWlyYSBgZGVsZXRlZF9hdGAgZSBgaXNfcHJpbWFyeWAsIHkgYGNhcnJpZXJfaWRgIGVudHJhIGVuIGVsCiAqIMONTkRJQ0UsIHF1ZSBubyBlc3TDoSBzdWpldG8gYSBlc2EgcmVzdHJpY2Npw7NuLiBFbCBpbnZhcmlhbnRlIHF1ZSBzZSBnYXJhbnRpemEKICogZXMgZXhhY3RhbWVudGUgZWwgbWlzbW8g4oCUIHVuIHByaW5jaXBhbCB2aXZvIHBvciB0cmFuc3BvcnRpc3RhIOKAlCB5IGxvIHNpZ3VlCiAqIGdhcmFudGl6YW5kbyBsYSBiYXNlIGRlIGRhdG9zLCBubyBlbCBidWVuIGNvbXBvcnRhbWllbnRvIGRlbCBjb250cm9sYWRvci4KICog4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSACiAqLwpyZXR1cm4gbmV3IGNsYXNzIGV4dGVuZHMgTWlncmF0aW9uCnsKICAgIHB1YmxpYyBmdW5jdGlvbiB1cCgpOiB2b2lkCiAgICB7CiAgICAgICAgLy8gTXlTUUwgbm8gdGllbmUgRERMIHRyYW5zYWNjaW9uYWw6IGxhIHZlcnNpw7NuIGFudGVyaW9yIGRlIGVzdGEKICAgICAgICAvLyBtaWdyYWNpw7NuIGNyZcOzIGxhIHRhYmxhIHkgbXVyacOzIGFsIGHDsWFkaXIgbGEgY2xhdmUgYWplbmEsIGRlasOhbmRvbGEgYQogICAgICAgIC8vIG1lZGlhcyB5IFNJTiByZWdpc3RyYXJzZSBlbiBgbWlncmF0aW9uc2AuIFNpIGVzYSB0YWJsYSBodcOpcmZhbmEgc2lndWUKICAgICAgICAvLyBhaMOtLCBzZSB0aXJhIGFudGVzIGRlIGVtcGV6YXIuCiAgICAgICAgLy8KICAgICAgICAvLyBFc3RvIHNvbG8gcHVlZGUgZWplY3V0YXJzZSBzb2JyZSByZXN0b3M6IHVuYSBtaWdyYWNpw7NuIHlhIHJlZ2lzdHJhZGEKICAgICAgICAvLyBubyB2dWVsdmUgYSBsbGFtYXIgYSB1cCgpLgogICAgICAgIFNjaGVtYTo6ZHJvcElmRXhpc3RzKCdjYXJyaWVyX2NvbnRhY3RzJyk7CgogICAgICAgIFNjaGVtYTo6Y3JlYXRlKCdjYXJyaWVyX2NvbnRhY3RzJywgZnVuY3Rpb24gKEJsdWVwcmludCAkdGFibGUpOiB2b2lkIHsKICAgICAgICAgICAgJHRhYmxlLT5jaGFyKCdpZCcsIDM2KS0+cHJpbWFyeSgpOwogICAgICAgICAgICAkdGFibGUtPmNoYXIoJ3RlbmFudF9pZCcsIDM2KTsKICAgICAgICAgICAgJHRhYmxlLT5jaGFyKCdjYXJyaWVyX2lkJywgMzYpOwoKICAgICAgICAgICAgJHRhYmxlLT5zdHJpbmcoJ2ZpcnN0X25hbWUnLCAxMDApOwogICAgICAgICAgICAkdGFibGUtPnN0cmluZygnbGFzdF9uYW1lJywgMTAwKTsKICAgICAgICAgICAgJHRhYmxlLT5zdHJpbmcoJ2VtYWlsJywgMjU1KS0+bnVsbGFibGUoKTsKICAgICAgICAgICAgJHRhYmxlLT5zdHJpbmcoJ3Bob25lJywgMzIpLT5udWxsYWJsZSgpOwoKICAgICAgICAgICAgLy8gRWwgcHJpbmNpcGFsIGVzIGVsIHF1ZSBzZSBjb3BpYSBhIGxhcyBjb2x1bW5hcyBkZSBgY2FycmllcnNgLiBIYXkKICAgICAgICAgICAgLy8gZXhhY3RhbWVudGUgdW5vIHBvciB0cmFuc3BvcnRpc3RhLCB5IGxvIGdhcmFudGl6YSBlbCDDrW5kaWNlIGRlCiAgICAgICAgICAgIC8vIGFiYWpvLCBubyBlbCBidWVuIGNvbXBvcnRhbWllbnRvIGRlbCBjb250cm9sYWRvci4KICAgICAgICAgICAgJHRhYmxlLT5ib29sZWFuKCdpc19wcmltYXJ5JyktPmRlZmF1bHQoZmFsc2UpOwoKICAgICAgICAgICAgJHRhYmxlLT50ZXh0KCdub3RlcycpLT5udWxsYWJsZSgpOwoKICAgICAgICAgICAgJHRhYmxlLT5kYXRlVGltZSgnY3JlYXRlZF9hdCcsIDMpLT51c2VDdXJyZW50KCk7CiAgICAgICAgICAgICR0YWJsZS0+ZGF0ZVRpbWUoJ3VwZGF0ZWRfYXQnLCAzKS0+dXNlQ3VycmVudCgpLT51c2VDdXJyZW50T25VcGRhdGUoKTsKICAgICAgICAgICAgJHRhYmxlLT5kYXRlVGltZSgnZGVsZXRlZF9hdCcsIDMpLT5udWxsYWJsZSgpOwogICAgICAgICAgICAkdGFibGUtPmNoYXIoJ2RlbGV0ZWRfYnknLCAzNiktPm51bGxhYmxlKCk7CiAgICAgICAgICAgICR0YWJsZS0+dGV4dCgnZGVsZXRpb25fcmVhc29uJyktPm51bGxhYmxlKCk7CgogICAgICAgICAgICAkdGFibGUtPnVuaXF1ZShbJ3RlbmFudF9pZCcsICdpZCddLCAnY2Fycmllcl9jb250YWN0c190ZW5hbnRfaWRfdXEnKTsKICAgICAgICAgICAgJHRhYmxlLT5pbmRleChbJ3RlbmFudF9pZCcsICdjYXJyaWVyX2lkJ10sICdjYXJyaWVyX2NvbnRhY3RzX2NhcnJpZXJfaWR4Jyk7CiAgICAgICAgfSk7CgogICAgICAgIC8vIFVuIHNvbG8gcHJpbmNpcGFsIHZpdm8gcG9yIHRyYW5zcG9ydGlzdGEuIEVtdWxhY2nDs24gZGUgw61uZGljZSBwYXJjaWFsLAogICAgICAgIC8vIGlndWFsIHF1ZSBlbiBlbCByZXN0byBkZWwgZXNxdWVtYTogbGEgYmFuZGVyYSB2YWxlIE5VTEwgc2Fsdm8gcGFyYSBlbAogICAgICAgIC8vIHByaW5jaXBhbCB2aXZvLCB5IE15U1FMIGlnbm9yYSBsb3MgTlVMTCBlbiB1biDDrW5kaWNlIMO6bmljby4KICAgICAgICAvLwogICAgICAgIC8vIExhIGJhbmRlcmEgTk8gbWlyYSBgY2Fycmllcl9pZGAg4oCUIHZlciBsYSBjYWJlY2VyYS4gYGNhcnJpZXJfaWRgIHZhIGVuCiAgICAgICAgLy8gZWwgw61uZGljZSwgcXVlIGVzIGRvbmRlIG5vIGVzdG9yYmEuCiAgICAgICAgREI6OnN0YXRlbWVudCgnCiAgICAgICAgICAgIGFsdGVyIHRhYmxlIGNhcnJpZXJfY29udGFjdHMKICAgICAgICAgICAgYWRkIGNvbHVtbiBgbGl2ZV9wcmltYXJ5X2ZsYWdgIHRpbnlpbnQoMSkKICAgICAgICAgICAgZ2VuZXJhdGVkIGFsd2F5cyBhcyAoCiAgICAgICAgICAgICAgICBjYXNlIHdoZW4gYGRlbGV0ZWRfYXRgIGlzIG51bGwgYW5kIGBpc19wcmltYXJ5YCA9IDEgdGhlbiAxIGVuZAogICAgICAgICAgICApIHN0b3JlZAogICAgICAgICcpOwoKICAgICAgICBEQjo6c3RhdGVtZW50KCcKICAgICAgICAgICAgYWx0ZXIgdGFibGUgY2Fycmllcl9jb250YWN0cwogICAgICAgICAgICBhZGQgdW5pcXVlIGtleSBgY2Fycmllcl9jb250YWN0c19wcmltYXJ5X3VxYAogICAgICAgICAgICAoYHRlbmFudF9pZGAsIGBjYXJyaWVyX2lkYCwgYGxpdmVfcHJpbWFyeV9mbGFnYCkKICAgICAgICAnKTsKCiAgICAgICAgLy8gQWlzbGFtaWVudG8gZW50cmUgZW1wcmVzYXMgcG9yIGNsYXZlIGNvbXB1ZXN0YSwgaWd1YWwgcXVlIGVsIHJlc3RvIGRlbAogICAgICAgIC8vIGVzcXVlbWE6IHVuIGNvbnRhY3RvIG5vIHB1ZWRlIGNvbGdhciBkZSB1biB0cmFuc3BvcnRpc3RhIGRlIE9UUkEKICAgICAgICAvLyBlbXByZXNhIGNsaWVudGUgYXVucXVlIGFsZ3VpZW4gZmFicmlxdWUgZWwgaWRlbnRpZmljYWRvciBhIG1hbm8uCiAgICAgICAgREI6OnN0YXRlbWVudCgnCiAgICAgICAgICAgIGFsdGVyIHRhYmxlIGNhcnJpZXJfY29udGFjdHMKICAgICAgICAgICAgYWRkIGNvbnN0cmFpbnQgZmtfY2Fycmllcl9jb250YWN0c19jYXJyaWVyX3h0CiAgICAgICAgICAgIGZvcmVpZ24ga2V5ICh0ZW5hbnRfaWQsIGNhcnJpZXJfaWQpCiAgICAgICAgICAgIHJlZmVyZW5jZXMgY2FycmllcnMgKHRlbmFudF9pZCwgaWQpCiAgICAgICAgICAgIG9uIGRlbGV0ZSBjYXNjYWRlCiAgICAgICAgJyk7CgogICAgICAgIERCOjpzdGF0ZW1lbnQoJwogICAgICAgICAgICBhbHRlciB0YWJsZSBjYXJyaWVyX2NvbnRhY3RzCiAgICAgICAgICAgIGFkZCBjb25zdHJhaW50IGZrX2NhcnJpZXJfY29udGFjdHNfdGVuYW50CiAgICAgICAgICAgIGZvcmVpZ24ga2V5ICh0ZW5hbnRfaWQpIHJlZmVyZW5jZXMgdGVuYW50cyAoaWQpIG9uIGRlbGV0ZSBjYXNjYWRlCiAgICAgICAgJyk7CgogICAgICAgICR0aGlzLT5yZXRyb2xsZW5hcigpOwogICAgfQoKICAgIHB1YmxpYyBmdW5jdGlvbiBkb3duKCk6IHZvaWQKICAgIHsKICAgICAgICBTY2hlbWE6OmRyb3BJZkV4aXN0cygnY2Fycmllcl9jb250YWN0cycpOwogICAgfQoKICAgIC8qKgogICAgICogRWwgY29udGFjdG8gcHJpbmNpcGFsIGRlIGNhZGEgdHJhbnNwb3J0aXN0YSBxdWUgeWEgZXhpc3TDrWEuCiAgICAgKi8KICAgIHByaXZhdGUgZnVuY3Rpb24gcmV0cm9sbGVuYXIoKTogdm9pZAogICAgewogICAgICAgIERCOjp0YWJsZSgnY2FycmllcnMnKQogICAgICAgICAgICAtPndoZXJlTnVsbCgnZGVsZXRlZF9hdCcpCiAgICAgICAgICAgIC0+b3JkZXJCeSgnaWQnKQogICAgICAgICAgICAtPmNodW5rQnlJZCg1MDAsIGZ1bmN0aW9uICgkZmlsYXMpOiB2b2lkIHsKICAgICAgICAgICAgICAgICRhaG9yYSA9IG5vdygpOwogICAgICAgICAgICAgICAgJGxvdGUgPSBbXTsKCiAgICAgICAgICAgICAgICBmb3JlYWNoICgkZmlsYXMgYXMgJGMpIHsKICAgICAgICAgICAgICAgICAgICAkbG90ZVtdID0gWwogICAgICAgICAgICAgICAgICAgICAgICAnaWQnID0+IChzdHJpbmcpIFN0cjo6dXVpZCgpLAogICAgICAgICAgICAgICAgICAgICAgICAndGVuYW50X2lkJyA9PiAkYy0+dGVuYW50X2lkLAogICAgICAgICAgICAgICAgICAgICAgICAnY2Fycmllcl9pZCcgPT4gJGMtPmlkLAogICAgICAgICAgICAgICAgICAgICAgICAnZmlyc3RfbmFtZScgPT4gJGMtPmNvbnRhY3RfZmlyc3RfbmFtZSwKICAgICAgICAgICAgICAgICAgICAgICAgJ2xhc3RfbmFtZScgPT4gJGMtPmNvbnRhY3RfbGFzdF9uYW1lLAogICAgICAgICAgICAgICAgICAgICAgICAnZW1haWwnID0+ICRjLT5lbWFpbCwKICAgICAgICAgICAgICAgICAgICAgICAgJ3Bob25lJyA9PiAkYy0+cGhvbmUsCiAgICAgICAgICAgICAgICAgICAgICAgICdpc19wcmltYXJ5JyA9PiB0cnVlLAogICAgICAgICAgICAgICAgICAgICAgICAnY3JlYXRlZF9hdCcgPT4gJGFob3JhLAogICAgICAgICAgICAgICAgICAgICAgICAndXBkYXRlZF9hdCcgPT4gJGFob3JhLAogICAgICAgICAgICAgICAgICAgIF07CiAgICAgICAgICAgICAgICB9CgogICAgICAgICAgICAgICAgaWYgKCRsb3RlICE9PSBbXSkgewogICAgICAgICAgICAgICAgICAgIERCOjp0YWJsZSgnY2Fycmllcl9jb250YWN0cycpLT5pbnNlcnQoJGxvdGUpOwogICAgICAgICAgICAgICAgfQogICAgICAgICAgICB9KTsKICAgIH0KfTsK'),
);


/* ── Ficheros que se modifican ───────────────────────────────────────── */

/* ── Parte ───────────────────────────────────────────────────────────────── */

echo $dry ? "SIMULACIÓN (no se escribió nada)\n\n" : "lote16 — arreglo de la migración de contactos\n\n";

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
  ./vendor/bin/pest

Y vuelve a desplegar. El front no cambió: no hace falta npm run build.

TXT;
}

exit(0);
