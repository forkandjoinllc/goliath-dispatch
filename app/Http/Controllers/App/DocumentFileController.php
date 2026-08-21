<?php

declare(strict_types=1);

namespace App\Http\Controllers\App;

use App\Support\Storage\DocumentStore;
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
    public function __invoke(string $key, DocumentStore $store): StreamedResponse
    {
        $storageKey = base64_decode($key, true);

        // La clave viaja dentro de la firma, así que no puede haberse
        // manipulado; se comprueba igualmente que no salga del directorio de
        // documentos. Defensa en profundidad: si mañana alguien genera esta URL
        // sin firmar, esto sigue en pie.
        abort_if($storageKey === false || ! str_starts_with($storageKey, 'documents/'), 404);
        abort_if(str_contains($storageKey, '..'), 404);
        abort_unless($store->exists($storageKey), 404);

        return Storage::disk('local')->download($storageKey);
    }
}
