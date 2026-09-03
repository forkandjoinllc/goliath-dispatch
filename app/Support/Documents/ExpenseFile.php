<?php

declare(strict_types=1);

namespace App\Support\Documents;

use App\Authorization\Actor;
use App\Models\Document;
use App\Support\Storage\DocumentStore;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;

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
 * `owner_type = 'expense'`. Así el recibo hereda todo lo que ya está resuelto
 * —el almacenamiento, la retención, el barrido de huérfanos, el enlace firmado
 * para verlo— sin una sola línea nueva en ninguno de los cuatro.
 *
 * La escritura común vive en `Attachment` desde el lote 67, cuando los permisos
 * la iban a necesitar por tercera vez. Aquí solo queda lo que es del gasto: qué
 * columna apunta al documento y que solo puede haber uno.
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
        $anterior = DB::table('expenses')->where('id', $expenseId)->value('receipt_document_id');

        $document = Attachment::store($actor, 'expense', $expenseId, self::TIPO, $file, $store);

        DB::table('expenses')->where('id', $expenseId)->update([
            'receipt_document_id' => $document->id,
            'updated_at' => now(),
        ]);

        if ($anterior !== null) {
            Attachment::retire($actor, (string) $anterior);
        }

        return $document;
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

            Attachment::retire($actor, (string) $documentId);
        });

        return true;
    }

}
