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
 *
 * Antes tampoco borraba, y el motivo escrito aquí era este: «los documentos se
 * retienen por política —siete años— y el borrado lo decide el trabajo de
 * retención, no una pantalla». La decisión era correcta y la consecuencia se
 * quedó a medias: **ese trabajo se construyó en el lote 52 y borraba la FILA,
 * dejando el fichero.** El sistema decía «purgado» y el PDF seguía en el disco.
 *
 * Así que borrar entra ahora, con el mismo criterio de entonces: lo llama el
 * trabajo de retención, nunca una pantalla. No hay controlador que lo invoque.
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
     * Guarda bytes que ha generado la aplicación, no un fichero subido.
     *
     * Existe aparte de `put()` porque un PDF firmado o la imagen de una firma
     * no vienen de un formulario y no tienen `UploadedFile` que envolver.
     * Envolverlos en uno artificial obligaría a escribirlos primero en un
     * fichero temporal solo para volver a leerlos, y a heredar de paso la
     * comprobación de extensión, que aquí no aplica: quien llama sabe
     * exactamente qué generó.
     */
    public function putBytes(string $tenantId, string $bytes, string $extension, string $prefix = 'documents'): string;

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

    /**
     * Borra un fichero. Permanente.
     *
     * Devuelve `true` también cuando el fichero YA NO ESTABA, y no es
     * indulgencia: quien llama a esto está terminando de borrar algo, y un
     * fichero que falta es el estado que quería. Devolver `false` obligaría a
     * cada llamador a distinguir «no pude» de «ya estaba hecho», y el barrido
     * nocturno acabaría contando como fallos las repeticiones de su propio
     * trabajo.
     *
     * `false` queda para lo que sí es un problema: permisos, disco de solo
     * lectura, S3 que contesta un error.
     */
    public function delete(string $storageKey): bool;

    /**
     * Borra varios. Devuelve cuántos se fueron.
     *
     * Existe aparte porque S3 borra hasta mil claves en una llamada y hacerlo
     * de una en una sobre diez mil ficheros son diez mil viajes de red. El
     * adaptador local no gana nada, pero la interfaz tiene que dejar que el que
     * sí gana lo aproveche.
     *
     * @param  list<string>  $storageKeys
     */
    public function deleteMany(array $storageKeys): int;

    /**
     * Todas las claves que hay guardadas, para poder buscar huérfanos.
     *
     * Devuelve un iterador y no un array: un almacén con doscientos mil
     * ficheros no cabe en memoria de golpe, y el barrido los procesa por lotes.
     *
     * @return iterable<string>
     */
    public function keys(string $prefix = ''): iterable;
}
