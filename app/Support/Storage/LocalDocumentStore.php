<?php

declare(strict_types=1);

namespace App\Support\Storage;

use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\URL;
use Illuminate\Support\Str;

/**
 * Los ficheros en el disco del servidor.
 *
 * Es el adaptador que funciona sin credenciales de nadie. Guarda en el disco
 * `local`, que en Laravel es `storage/app/private` — fuera de `public/`, así
 * que el servidor web no lo sirve por su cuenta y la única forma de llegar a un
 * fichero es por la ruta firmada.
 *
 * Sus límites, dichos claramente:
 *
 *  - Un segundo servidor no vería estos ficheros. Con una sola máquina en Forge
 *    no importa; con dos, hay que estar ya en S3.
 *  - Las copias de seguridad son las del servidor. S3 las trae de fábrica.
 *
 * El sustituto de S3 implementa esta misma interfaz y no cambia nada más.
 */
final class LocalDocumentStore implements DocumentStore
{
    private const DISK = 'local';

    public function put(string $tenantId, UploadedFile $file): string
    {
        // La empresa va delante y el nombre es aleatorio.
        //
        // El nombre original NO se usa como nombre de fichero: llega del
        // usuario, puede traer «../», caracteres que el sistema de ficheros
        // interpreta, o el nombre de otro documento. Se guarda como dato en la
        // fila, que es donde un nombre de usuario no puede hacer daño.
        $key = sprintf(
            'documents/%s/%s/%s.%s',
            $tenantId,
            now()->format('Y/m'),
            (string) Str::uuid(),
            $this->safeExtension($file),
        );

        Storage::disk(self::DISK)->putFileAs(
            dirname($key),
            $file,
            basename($key),
        );

        return $key;
    }

    public function putBytes(string $tenantId, string $bytes, string $extension, string $prefix = 'documents'): string
    {
        $key = sprintf(
            '%s/%s/%s/%s.%s',
            trim($prefix, '/'),
            $tenantId,
            now()->format('Y/m'),
            (string) Str::uuid(),
            preg_replace('/[^a-z0-9]/', '', mb_strtolower($extension)) ?: 'bin',
        );

        Storage::disk(self::DISK)->put($key, $bytes);

        return $key;
    }

    public function temporaryUrl(string $storageKey, int $minutes = 5): string
    {
        // El disco local no sabe firmar URLs —eso lo hace S3— así que se firma
        // una ruta propia de la aplicación. Cuando el adaptador sea S3, este
        // método devolverá su URL firmada y la ruta dejará de usarse.
        return URL::temporarySignedRoute(
            'documents.file',
            now()->addMinutes($minutes),
            ['key' => base64_encode($storageKey)],
        );
    }

    public function exists(string $storageKey): bool
    {
        return Storage::disk(self::DISK)->exists($storageKey);
    }

    public function size(string $storageKey): int
    {
        return (int) Storage::disk(self::DISK)->size($storageKey);
    }

    public function delete(string $storageKey): bool
    {
        // Un fichero que ya no está es el estado que quería quien llamó. Ver la
        // nota de la interfaz: distinguirlo de un fallo real haría que el
        // barrido contara como errores las repeticiones de su propio trabajo.
        if (! Storage::disk(self::DISK)->exists($storageKey)) {
            return true;
        }

        return Storage::disk(self::DISK)->delete($storageKey);
    }

    public function deleteMany(array $storageKeys): int
    {
        $idos = 0;

        foreach ($storageKeys as $clave) {
            if ($this->delete($clave)) {
                $idos++;
            }
        }

        return $idos;
    }

    /**
     * La marca de tiempo del fichero, en segundos.
     *
     * NO está en la interfaz a propósito: S3 la trae en el listado, así que un
     * adaptador de S3 no querría una llamada por fichero para obtenerla.
     * `OrphanSweep` la usa si existe y da el fichero por viejo si no — que en
     * S3 es lo correcto, porque allí el listado ya la lleva.
     */
    public function lastModified(string $storageKey): int
    {
        if (! Storage::disk(self::DISK)->exists($storageKey)) {
            return 0;
        }

        return (int) Storage::disk(self::DISK)->lastModified($storageKey);
    }

    public function keys(string $prefix = ''): iterable
    {
        // `allFiles` recorre recursivamente y devuelve rutas relativas al
        // disco, que es exactamente el formato de las claves.
        //
        // Con doscientos mil ficheros esto sí carga un array grande, y es una
        // limitación conocida del adaptador local: el de S3 pagina de verdad.
        // Se acepta porque el disco local es para una sola máquina, y una sola
        // máquina no llega a esas cifras sin haber migrado antes a S3.
        return Storage::disk(self::DISK)->allFiles($prefix);
    }

    /**
     * La extensión, de una lista blanca.
     *
     * Se toma de lo que el fichero ES, no de lo que su nombre dice. Alguien
     * sube «seguro.pdf.exe» y lo que queda en el disco es un .bin inofensivo,
     * porque el nombre no manda.
     */
    private function safeExtension(UploadedFile $file): string
    {
        $guessed = mb_strtolower((string) $file->guessExtension());

        $allowed = ['pdf', 'jpg', 'jpeg', 'png', 'webp', 'heic', 'tif', 'tiff', 'doc', 'docx'];

        return in_array($guessed, $allowed, true) ? $guessed : 'bin';
    }
}
