<?php

declare(strict_types=1);

namespace App\Support\Documents;

use App\Authorization\Actor;
use App\Enums\AuditAction;
use App\Models\Document;
use App\Support\Audit;
use App\Support\Storage\DocumentStore;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Guardar un fichero y dejarlo colgado de algo.
 *
 * ## Por qué existe
 *
 * Porque es la TERCERA vez que hacía falta. `LoadFile` lo escribía para las
 * cargas, `ExpenseFile` lo copió para los recibos, y los permisos y las
 * escoltas iban a ser la tercera copia de la misma escritura: fila en
 * `documents`, fila en `document_versions`, el puntero a la versión actual y la
 * anotación en la bitácora.
 *
 * La regla de la casa —escrita en docs/testing.md después de un lote en el que
 * casi se duplica un método— dice que antes de copiar una escritura por tercera
 * vez hay que comparar las dos que existen. Comparadas, la parte común es
 * exactamente esto y la parte distinta es a QUÉ se cuelga: la carga añade una
 * fila en `load_documents` con su parada, el gasto y el permiso escriben una
 * columna en su propia tabla.
 *
 * Así que aquí vive lo común, y cada dueño hace lo suyo alrededor.
 *
 * ## Lo que NO decide esta clase
 *
 * Ni los permisos, ni qué tipos de fichero se aceptan, ni si el que sube puede
 * subir. Eso lo decide cada controlador, que es quien sabe de qué está
 * hablando: un recibo lo puede adjuntar quien presenta el gasto, y el papel de
 * un permiso de sobredimensión no.
 */
final class Attachment
{
    /**
     * Sube el fichero y escribe el documento con su primera versión.
     *
     * @param  string  $ownerType  'load', 'expense', 'permit', 'escort'…
     */
    public static function store(
        Actor $actor,
        string $ownerType,
        string $ownerId,
        string $documentType,
        UploadedFile $file,
        DocumentStore $store,
        ?string $title = null,
    ): Document {
        // ANTES de guardar, no después. Si el veredicto rechaza, `put()` no
        // llega a llamarse: el fichero no entra en el almacén, y no hay que
        // confiar en que un borrado posterior funcione para que no esté ahí.
        $veredicto = Scanning::revisar($file, $actor);

        // FUERA de la transacción a propósito: subir el fichero al
        // almacenamiento puede tardar, y una transacción abierta mientras tanto
        // mantiene bloqueadas filas de `documents` para todos los demás.
        $storageKey = $store->put((string) $actor->tenantId, $file);

        return DB::transaction(function () use (
            $actor, $ownerType, $ownerId, $documentType, $file, $storageKey, $title, $veredicto,
        ): Document {
            $document = new Document;
            $document->document_type = $documentType;
            $document->owner_type = $ownerType;
            $document->owner_id = $ownerId;
            $document->title = $title ?? $file->getClientOriginalName();
            // `is_required` alimenta la puerta de cumplimiento del
            // TRANSPORTISTA —«¿qué papeles le faltan para llevar carga?»— y
            // ninguno de estos es eso. Quien exige el papel es la puerta de su
            // propio dominio.
            $document->is_required = false;
            $document->review_status = 'pending';
            $document->uploaded_by_user_id = $actor->auditUserId();
            $document->save();

            $versionId = (string) Str::uuid();

            DB::table('document_versions')->insert([
                'id' => $versionId,
                'tenant_id' => $document->tenant_id,
                'document_id' => $document->id,
                'version_number' => 1,
                'storage_key' => $storageKey,
                'original_filename' => mb_substr((string) $file->getClientOriginalName(), 0, 255),
                'content_type' => (string) $file->getMimeType(),
                'byte_size' => (int) $file->getSize(),
                'sha256' => hash_file('sha256', (string) $file->getRealPath()),
                // Lo que dijo el analizador. Sin antivirus configurado eso es
                // `unavailable`, y NO `clean`: decir «limpio» sin haber mirado
                // sería un visto bueno de seguridad que nadie ha dado.
                ...Scanning::columnas($veredicto),
                'uploaded_by_user_id' => $actor->auditUserId(),
                'created_at' => now(),
                'updated_at' => now(),
            ]);

            $document->current_version_id = $versionId;
            $document->save();

            Audit::record(
                actor: $actor,
                action: AuditAction::DocumentUploaded,
                entityType: 'document',
                entityId: $document->id,
                entityLabel: (string) $document->title,
                after: ['ownerType' => $ownerType, 'ownerId' => $ownerId, 'type' => $documentType],
            );

            return $document;
        });
    }

    /**
     * Retira un documento: borrado en suave, nunca duro.
     *
     * Un papel que alguien miró antes de tomar una decisión tiene que poder
     * seguir viéndose después. Lo que cambia es que ya no está colgado de nada.
     */
    public static function retire(Actor $actor, string $documentId): void
    {
        DB::table('documents')
            ->where('id', $documentId)
            ->whereNull('deleted_at')
            ->update([
                'deleted_at' => now(),
                'deleted_by' => $actor->auditUserId(),
                'updated_at' => now(),
            ]);
    }

    /**
     * La clave de almacenamiento de la versión vigente de un documento.
     *
     * Devuelve null si el documento no existe, no es de esta empresa o no tiene
     * versión — los tres casos se tratan igual desde fuera: no hay fichero que
     * enseñar.
     */
    public static function storageKey(string $tenantId, string $documentId): ?string
    {
        $clave = DB::table('documents as d')
            ->join('document_versions as v', 'v.id', '=', 'd.current_version_id')
            ->where('d.tenant_id', $tenantId)
            ->where('d.id', $documentId)
            ->whereNull('d.deleted_at')
            ->value('v.storage_key');

        return $clave === null ? null : (string) $clave;
    }
}
