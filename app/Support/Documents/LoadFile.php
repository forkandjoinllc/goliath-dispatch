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
 * Los papeles de una carga: colgarlos, listarlos y descolgarlos.
 *
 * `load_documents` existía en el esquema desde el principio —con su `stop_id`
 * para decir de QUÉ parada es cada comprobante— y hasta este lote la escribía
 * únicamente el sembrador de demostración. Ninguna pantalla ofrecía subir nada,
 * y la única consulta que la leía —la puerta de `pod_received`— preguntaba por
 * un tipo que el CHECK no admite. Una tabla que nadie escribe leída por una
 * comprobación que nunca es cierta: el estado con el que se factura una carga
 * llevaba meses siendo inalcanzable.
 *
 * Por qué DOS filas y no una. Un papel de carga es un `documents` como
 * cualquier otro —tiene versiones, revisión, hash del contenido— y además un
 * ENLACE a la carga que dice de qué parada es. Meterlo todo en `documents`
 * obligaría a añadirle un `stop_id` que no significa nada para el certificado
 * de seguro de un transportista; meterlo todo en `load_documents` dejaría los
 * papeles de carga sin versiones ni revisión. El esquema ya tenía la respuesta
 * y era la de dos filas.
 *
 * El `document_type` se guarda en las dos, duplicado a propósito: el índice
 * `load_documents_load_type_idx (load_id, document_type)` es lo que hace barata
 * la pregunta «¿tiene comprobante esta carga?», y con el tipo solo en
 * `documents` habría que unir las dos tablas para contestarla. Es la única
 * desnormalización de aquí, y `attach()` es el único sitio que escribe las dos.
 */
final class LoadFile
{
    /**
     * Cuelga un fichero de una carga.
     *
     * Todo en una transacción: un `documents` sin su enlace es un papel que no
     * sale en ninguna lista, y un enlace sin su `documents` revienta cualquier
     * consulta que haga el JOIN. Ni la mitad de esto sirve de nada sola.
     */
    public static function attach(
        Actor $actor,
        string $loadId,
        string $documentType,
        UploadedFile $file,
        DocumentStore $store,
        ?string $stopId = null,
        ?string $title = null,
    ): Document {
        // La escritura común —documento, versión, puntero y bitácora— vive en
        // `Attachment` desde el lote 67. Aquí queda lo que es de la carga: la
        // fila de `load_documents`, que es la que le da tipo dentro del viaje y
        // la que puede apuntar a una parada concreta.
        $document = Attachment::store($actor, 'load', $loadId, $documentType, $file, $store, $title);

        DB::table('load_documents')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $document->tenant_id,
            'load_id' => $loadId,
            'document_id' => $document->id,
            'document_type' => $documentType,
            'stop_id' => $stopId,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return $document;
    }

    /**
     * Los papeles colgados de una carga, con su parada si la tienen.
     *
     * @return list<array<string, mixed>>
     */
    public static function forLoad(string $loadId): array
    {
        $rows = DB::table('load_documents as ld')
            ->join('documents as d', 'd.id', '=', 'ld.document_id')
            ->leftJoin('document_versions as v', 'v.id', '=', 'd.current_version_id')
            ->leftJoin('load_stops as s', 's.id', '=', 'ld.stop_id')
            // La dirección de una parada suele vivir en la ubicación del
            // cliente, no en la fila de la parada. Sin este JOIN la ficha del
            // papel decía «Parada 2 · » con el sitio en blanco. Ver la nota de
            // LoadDocumentController::stops().
            ->leftJoin('customer_locations as cl', 'cl.id', '=', 's.customer_location_id')
            ->where('ld.load_id', $loadId)
            ->whereNull('ld.deleted_at')
            ->whereNull('d.deleted_at')
            ->orderBy('ld.created_at')
            ->get([
                'ld.id as link_id',
                'ld.document_type',
                'ld.stop_id',
                'ld.created_at as attached_at',
                'd.id as document_id',
                'd.title',
                'd.review_status',
                'v.original_filename',
                'v.byte_size',
                'v.content_type',
                'v.malware_scan_status',
                's.stop_type',
                's.sequence as stop_sequence',
                's.facility_name',
                's.city',
                's.state',
                'cl.name as location_name',
                'cl.city as location_city',
                'cl.state as location_state',
            ]);

        return $rows->map(static fn ($r): array => [
            'linkId' => (string) $r->link_id,
            'documentId' => (string) $r->document_id,
            'type' => (string) $r->document_type,
            'title' => (string) ($r->title ?? $r->original_filename ?? ''),
            'reviewStatus' => (string) $r->review_status,
            'filename' => $r->original_filename === null ? null : (string) $r->original_filename,
            'byteSize' => $r->byte_size === null ? null : (int) $r->byte_size,
            'contentType' => $r->content_type === null ? null : (string) $r->content_type,
            'malwareScanStatus' => $r->malware_scan_status === null ? null : (string) $r->malware_scan_status,
            'attachedAt' => (string) $r->attached_at,
            'stop' => $r->stop_id === null ? null : [
                'id' => (string) $r->stop_id,
                'type' => (string) $r->stop_type,
                'sequence' => (int) $r->stop_sequence,
                'name' => (string) ($r->location_name ?? $r->facility_name ?? ''),
                'city' => (string) ($r->location_city ?? $r->city ?? ''),
                'state' => (string) ($r->location_state ?? $r->state ?? ''),
            ],
        ])->all();
    }

    /**
     * Descuelga un papel de una carga.
     *
     * Borra el ENLACE, no el documento. Son cosas distintas y confundirlas
     * borraría historia: el papel se subió, alguien lo miró, quedó en la
     * bitácora. Lo que se deshace aquí es «este papel pertenece a esta carga»
     * —que puede haberse colgado de la carga equivocada—, y el documento sigue
     * existiendo con sus versiones y su revisión.
     *
     * Y borrado suave, como todo lo demás: `deleted_at` con quién y por qué.
     */
    public static function detach(Actor $actor, string $loadId, string $linkId, ?string $reason = null): bool
    {
        $link = DB::table('load_documents')
            ->where('id', $linkId)
            ->where('load_id', $loadId)
            ->whereNull('deleted_at')
            ->first(['id', 'document_id', 'document_type']);

        if ($link === null) {
            return false;
        }

        DB::table('load_documents')->where('id', $linkId)->update([
            'deleted_at' => now(),
            'deleted_by' => $actor->auditUserId(),
            'deletion_reason' => $reason,
            'updated_at' => now(),
        ]);

        Audit::record(
            actor: $actor,
            action: AuditAction::DocumentDeleted,
            entityType: 'load_document',
            entityId: $linkId,
            entityLabel: (string) $link->document_type,
            before: ['loadId' => $loadId, 'documentId' => (string) $link->document_id],
        );

        return true;
    }
}
