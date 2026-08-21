<?php

declare(strict_types=1);

namespace App\Support\Storage;

use Illuminate\Http\UploadedFile;

/**
 * Dónde viven los ficheros de los documentos.
 *
 * Es una interfaz y no una llamada directa a Storage porque el destino va a
 * cambiar: hoy es el disco del servidor, mañana S3. Con las llamadas
 * repartidas por los controladores, ese cambio sería una cacería; con esto es
 * una línea de configuración.
 *
 * Es también lo que pedía la especificación original —«interfaces de proveedor
 * y adaptadores simulados cuando no haya credenciales»— y lo mismo que se hizo
 * con la verificación de FMCSA.
 *
 * Lo que NO hace esta interfaz, deliberadamente:
 *
 *  - Devolver el contenido del fichero. Un documento se descarga por una URL
 *    firmada y temporal, no leyéndolo a memoria para reenviarlo: un
 *    certificado de seguro escaneado son varios megabytes y una lista de
 *    veinte los pondría todos en la memoria del servidor.
 *  - Borrar. Los documentos se retienen por política —siete años— y el borrado
 *    lo decide el trabajo de retención, no una pantalla.
 */
interface DocumentStore
{
    /**
     * Guarda el fichero y devuelve su clave de almacenamiento.
     *
     * La clave lleva la empresa delante para que un despiste al construirla no
     * pueda cruzar datos entre empresas, y un componente aleatorio para que no
     * se pueda adivinar la de otro documento a partir de la propia.
     */
    public function put(string $tenantId, UploadedFile $file): string;

    /**
     * Una URL temporal para descargar el fichero.
     *
     * Temporal y no permanente: un enlace que no caduca acaba pegado en un
     * correo, reenviado tres veces y abierto por alguien que ya no trabaja
     * allí.
     */
    public function temporaryUrl(string $storageKey, int $minutes = 5): string;

    public function exists(string $storageKey): bool;

    /** Bytes del fichero. Solo para trabajos en segundo plano, nunca para servirlo. */
    public function size(string $storageKey): int;
}
