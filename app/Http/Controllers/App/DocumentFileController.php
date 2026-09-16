<?php

declare(strict_types=1);

namespace App\Http\Controllers\App;

use App\Support\Storage\DocumentStore;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Sirve el fichero de un documento, y solo con una firma válida.
 *
 * No comprueba permisos: la firma los sustituye, porque ya se comprobaron al
 * generarla y porque el enlace tiene que funcionar en contextos donde no hay
 * sesión —el visor de PDF del navegador, el móvil del conductor—. Por eso la
 * firma caduca en minutos.
 *
 * Se transmite (`streamDownload`) en vez de leerse a memoria: un escaneo de un
 * certificado son varios megabytes, y cargarlo entero por cada descarga pone al
 * servidor de rodillas con veinte usuarios.
 */
final class DocumentFileController
{
    public function __invoke(Request $request, string $key, DocumentStore $store): StreamedResponse
    {
        $storageKey = base64_decode($key, true);

        // La clave viaja dentro de la firma, así que no puede haberse
        // manipulado; se comprueba igualmente que no salga del directorio de
        // documentos. Defensa en profundidad: si mañana alguien genera esta URL
        // sin firmar, esto sigue en pie.
        abort_if($storageKey === false || ! str_starts_with($storageKey, 'documents/'), 404);
        abort_if(str_contains($storageKey, '..'), 404);
        abort_unless($store->exists($storageKey), 404);

        return Storage::disk('local')->download(
            $storageKey,
            self::nombre($request, $storageKey),
            $request->query('inline') === '1'
                ? ['Content-Disposition' => 'inline; filename="'.self::nombre($request, $storageKey).'"']
                : [],
        );
    }

    /**
     * Con qué nombre se entrega el fichero.
     *
     * ## El defecto
     *
     * Esto no existía: se servía la clave de almacenamiento, que es un UUID.
     * Quien se bajaba un comprobante se encontraba `b29a564e-73e0-….pdf` en su
     * carpeta de descargas, y quien se bajaba tres no podía distinguirlos. El
     * nombre de verdad llevaba guardado desde siempre —`message_attachments.
     * filename`, `document_versions.original_filename`— con un comentario que
     * decía, textualmente, «el nombre original es un DATO, no un nombre de
     * fichero». Lo era. Y al devolverlo, tampoco se usaba como dato.
     *
     * ## Por qué se saca de la firma y no de la base de datos
     *
     * Porque aquí no hay sesión ni permisos —la firma los sustituye— y
     * consultar la fila obligaría a saber de qué tabla viene la clave. El
     * nombre lo pone quien genera el enlace, que sí lo sabe, y viaja DENTRO de
     * la firma: nadie puede cambiar con qué nombre se sirve un fichero ajeno.
     *
     * Se recorta a lo que puede ser un nombre de fichero. No por el navegador
     * —`download()` ya escapa la cabecera— sino porque el nombre lo escribió
     * una persona al subir el fichero y las barras y los puntos suspensivos no
     * pintan nada en una carpeta de descargas.
     */
    private static function nombre(Request $request, string $storageKey): string
    {
        $crudo = $request->query('name');

        if (! is_string($crudo) || $crudo === '') {
            return basename($storageKey);
        }

        $nombre = base64_decode($crudo, true);

        if ($nombre === false || trim($nombre) === '') {
            return basename($storageKey);
        }

        $nombre = str_replace(['/', '\\', "\0", '"'], '', $nombre);
        $nombre = trim(preg_replace('/\.{2,}/', '.', $nombre) ?? '');

        return $nombre === '' ? basename($storageKey) : mb_substr($nombre, 0, 200);
    }
}
