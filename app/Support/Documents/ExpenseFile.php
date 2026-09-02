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
 * El recibo de un gasto.
 *
 * ## El defecto
 *
 * `expenses.receipt_document_id` existe desde el primer día y no la escribía
 * nadie: no había forma de adjuntar un recibo a un gasto. Y
 * `expense_categories.requires_receipt` está sembrada con valores de verdad
 * —el combustible y las reparaciones lo exigen, los peajes no—, se consultaba
 * en la pantalla de alta y se tiraba antes de mandarla al navegador.
 *
 * El diccionario portado describía el circuito entero, incluida la frase que
 * importa: «el revisor no puede aprobar un gasto al que le falte un recibo
 * obligatorio». No había ni recibo ni puerta.
 *
 * Y esto es dinero. Un gasto aprobado se rebota al cliente en la factura o se
 * descuenta de la liquidación del transportista, así que un gasto sin recibo es
 * un agujero que alguien firma — y el que lo firma se entera cuando se lo
 * discuten, meses después.
 *
 * ## Un documento como los demás
 *
 * No se inventa un almacén aparte: se escribe una fila en `documents` con
 * `owner_type = 'expense'`, exactamente igual que hace `LoadFile` con las
 * cargas. Así el recibo hereda todo lo que ya está resuelto — el
 * almacenamiento, la retención, el barrido de huérfanos, el enlace firmado para
 * verlo— sin una sola línea nueva en ninguno de los cuatro.
 *
 * `documents.owner_type` es un `varchar(20)` sin restricción, así que 'expense'
 * cabe sin migración. Que quepa no es lo mismo que estar previsto: lo que lo
 * hace correcto es que el resto de la maquinaria trata a `documents` por su
 * dueño y no por una lista cerrada.
 */
final class ExpenseFile
{
    /** El tipo de documento de un recibo de gasto. Ya estaba en el catálogo. */
    public const TIPO = 'receipt';

    /**
     * Cuelga un recibo de un gasto y lo deja apuntado en la columna.
     *
     * Sustituye al anterior si lo había: un gasto tiene UN recibo. El viejo se
     * borra en suave —queda en `documents` con su fecha— porque un recibo que
     * alguien vio antes de aprobar tiene que poder seguir viéndose después.
     */
    public static function attach(
        Actor $actor,
        string $expenseId,
        UploadedFile $file,
        DocumentStore $store,
    ): Document {
        // Fuera de la transacción a propósito: subir el fichero puede tardar, y
        // una transacción abierta mientras tanto bloquea filas de `documents`
        // para todos los demás. Mismo criterio que LoadFile.
        $storageKey = $store->put((string) $actor->tenantId, $file);

        return DB::transaction(function () use ($actor, $expenseId, $file, $storageKey): Document {
            $anterior = DB::table('expenses')->where('id', $expenseId)->value('receipt_document_id');

            $document = new Document;
            $document->document_type = self::TIPO;
            $document->owner_type = 'expense';
            $document->owner_id = $expenseId;
            $document->title = $file->getClientOriginalName();
            // `is_required` alimenta la puerta de cumplimiento del
            // TRANSPORTISTA —«¿qué papeles le faltan para poder llevar carga?»—
            // y un recibo no es eso: lo exige la categoría de este gasto, no el
            // expediente de nadie. La puerta del recibo vive en el controlador
            // del gasto y mira `expense_categories.requires_receipt`.
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
                // Sin antivirus configurado no se miente diciendo que está
                // limpio: queda pendiente. Igual que en LoadFile.
                'malware_scan_status' => 'pending',
                'uploaded_by_user_id' => $actor->auditUserId(),
                'created_at' => now(),
                'updated_at' => now(),
            ]);

            $document->current_version_id = $versionId;
            $document->save();

            DB::table('expenses')->where('id', $expenseId)->update([
                'receipt_document_id' => $document->id,
                'updated_at' => now(),
            ]);

            if ($anterior !== null) {
                self::retirar((string) $anterior, $actor);
            }

            Audit::record(
                actor: $actor,
                action: AuditAction::DocumentUploaded,
                entityType: 'document',
                entityId: $document->id,
                entityLabel: (string) $document->title,
                after: ['expenseId' => $expenseId, 'type' => self::TIPO],
            );

            return $document;
        });
    }

    /**
     * Quitar el recibo de un gasto.
     *
     * Deja la columna en nulo y borra el documento en suave. Con la puerta
     * puesta, quitarle el recibo a un gasto que ya está aprobado no lo
     * desaprueba —eso sería reescribir una decisión que alguien tomó— pero sí
     * deja de haber papel, y por eso la pantalla lo enseña.
     */
    public static function detach(Actor $actor, string $expenseId): bool
    {
        $documentId = DB::table('expenses')
            ->where('tenant_id', $actor->tenantId)
            ->where('id', $expenseId)
            ->value('receipt_document_id');

        if ($documentId === null) {
            return false;
        }

        DB::transaction(function () use ($actor, $expenseId, $documentId): void {
            DB::table('expenses')->where('id', $expenseId)->update([
                'receipt_document_id' => null,
                'updated_at' => now(),
            ]);

            self::retirar((string) $documentId, $actor);
        });

        return true;
    }

    /** Borrado en suave del documento, con su rastro. */
    private static function retirar(string $documentId, Actor $actor): void
    {
        DB::table('documents')->where('id', $documentId)->whereNull('deleted_at')->update([
            'deleted_at' => now(),
            'deleted_by' => $actor->auditUserId(),
            'updated_at' => now(),
        ]);
    }
}
