<?php

declare(strict_types=1);

namespace App\Support\Signatures;

use App\Support\Storage\DocumentStore;
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use RuntimeException;

/**
 * El momento de firmar: captura, genera, guarda y sella.
 *
 * Todo ocurre dentro de una transacción salvo la escritura de los ficheros, que
 * no puede estar en una. El orden importa y es el que sigue:
 *
 *  1. Se comprueba que no falte ninguna variable obligatoria. Un documento con
 *     un `{{carrierLegalName}}` literal en medio no es un acuerdo.
 *  2. Se guarda la marca de la firma y se le saca el sha256.
 *  3. Se genera el PDF del acuerdo con la firma dentro, se guarda, y su
 *     sha256 se calcula sobre LOS BYTES REALES del fichero — no sobre el texto
 *     que lo originó. Es lo que permite que el verificador vuelva a leer el
 *     fichero años después y decir si es el mismo.
 *  4. Se escribe el registro y se sella.
 *  5. Se genera el certificado de auditoría, que necesita la cronología ya
 *     escrita y por eso va el último.
 *
 * Si algo falla a mitad, la transacción deshace las filas y quedan ficheros
 * huérfanos en el disco. Se prefiere eso al revés: un fichero sin fila es
 * basura que un trabajo de limpieza recoge, mientras que una fila sin fichero
 * es un acuerdo firmado que no se puede enseñar.
 */
final class Signing
{
    /** @return array{recordId: string, documentId: string} */
    public static function sign(
        object $solicitud,
        object $plantilla,
        string $signerLegalName,
        ?string $signerTitle,
        string $method,
        ?string $drawnDataUrl,
        ?string $typedName,
        Request $request,
        DocumentStore $store,
    ): array {
        $tenantId = (string) $solicitud->tenant_id;
        $locale = (string) $solicitud->locale;
        $ahora = CarbonImmutable::now();

        /** @var array<string, mixed> $valores */
        $valores = json_decode((string) $solicitud->token_values, true, 512, JSON_THROW_ON_ERROR) ?: [];
        /** @var list<string> $requeridas */
        $requeridas = json_decode((string) $plantilla->required_tokens, true, 512, JSON_THROW_ON_ERROR) ?: [];

        $faltan = TemplateBody::missingTokens($requeridas, $valores);

        if ($faltan !== []) {
            throw new RuntimeException('missing_token:'.$faltan[0]);
        }

        // ── 2. La marca ──────────────────────────────────────────────────────
        $marca = $method === 'drawn'
            ? (string) $drawnDataUrl
            : Renderer::typedMark((string) $typedName);

        $bytesMarca = self::dataUrlBytes($marca);
        $claveMarca = $store->putBytes($tenantId, $bytesMarca, self::dataUrlExtension($marca), 'signatures');
        $shaMarca = hash('sha256', $bytesMarca);

        Ceremony::record(
            tenantId: $tenantId,
            requestId: (string) $solicitud->id,
            eventType: Ceremony::SIGNATURE_CAPTURED,
            actorEmail: (string) $solicitud->signer_email,
            request: $request,
            detail: ['method' => $method],
        );

        // ── 3. El acuerdo ────────────────────────────────────────────────────
        $titulo = $locale === 'es' ? (string) $plantilla->title_es : (string) $plantilla->title_en;
        $cuerpo = $locale === 'es' ? (string) $plantilla->body_es : (string) $plantilla->body_en;
        $consentimiento = $locale === 'es'
            ? (string) $plantilla->consent_copy_es
            : (string) $plantilla->consent_copy_en;

        $pdf = Renderer::signedDocument(
            titulo: $titulo,
            cuerpo: $cuerpo,
            tokenValues: $valores,
            textoConsentimiento: $consentimiento,
            firmanteNombre: $signerLegalName,
            firmanteCargo: $signerTitle,
            firmanteCorreo: (string) $solicitud->signer_email,
            firmaDataUrl: $marca,
            firmadoEl: $ahora,
            locale: $locale,
        );

        $clavePdf = $store->putBytes($tenantId, $pdf, 'pdf');
        $shaPdf = hash('sha256', $pdf);

        $documentoId = self::createDocument(
            tenantId: $tenantId,
            tipo: self::documentType((string) $plantilla->template_key),
            ownerType: (string) $solicitud->subject_type,
            ownerId: (string) $solicitud->subject_id,
            titulo: $titulo,
            storageKey: $clavePdf,
            sha256: $shaPdf,
            bytes: strlen($pdf),
            nombre: Str::slug($titulo).'.pdf',
        );

        Ceremony::record(
            tenantId: $tenantId,
            requestId: (string) $solicitud->id,
            eventType: Ceremony::DOCUMENT_GENERATED,
            actorEmail: (string) $solicitud->signer_email,
            request: $request,
            detail: ['documentSha256' => $shaPdf],
        );

        // ── 4. El registro y su sello ────────────────────────────────────────
        $registroId = (string) Str::uuid();
        $firmadoEn = $ahora->format('Y-m-d H:i:s.v');

        $sello = Seal::compute(Seal::components(
            templateContentHash: (string) $solicitud->template_content_hash,
            documentSha256: $shaPdf,
            signatureSha256: $shaMarca,
            signerLegalName: $signerLegalName,
            signerEmail: (string) $solicitud->signer_email,
            signedAt: $firmadoEn,
        ));

        DB::table('signature_records')->insert([
            'id' => $registroId,
            'tenant_id' => $tenantId,
            'request_id' => (string) $solicitud->id,
            'signer_user_id' => $solicitud->signer_user_id,
            'signer_legal_name' => $signerLegalName,
            'signer_email' => (string) $solicitud->signer_email,
            'signer_title' => $signerTitle,
            'method' => $method,
            'signature_storage_key' => $claveMarca,
            'signature_sha256' => $shaMarca,
            'typed_name_value' => $method === 'typed' ? $typedName : null,
            'consent_accepted' => 1,
            'consent_copy_hash' => hash('sha256', $consentimiento),
            'document_sha256' => $shaPdf,
            'signed_document_id' => $documentoId,
            'integrity_seal' => $sello,
            'seal_algorithm' => Seal::ALGORITHM,
            // La IP y el navegador NO son opcionales en esta tabla, y con razón:
            // son la mitad de lo que hace comprobable una firma electrónica.
            'ip_address' => (string) ($request->ip() ?? '0.0.0.0'),
            'user_agent' => (string) ($request->userAgent() ?? ''),
            'locale' => $locale,
            'signed_at' => $firmadoEn,
            'created_at' => $ahora,
            'updated_at' => $ahora,
        ]);

        DB::table('signature_requests')
            ->where('id', $solicitud->id)
            ->update([
                'status' => 'signed',
                'signer_legal_name' => $signerLegalName,
                'completed_at' => $ahora,
                // El token SIGUE VIVO, y no por descuido. Lo que muere es la
                // capacidad de firmar, que la decide el ESTADO: `resolve()`
                // devuelve `already_signed` y la página lo dice con su texto.
                // Si se borrara el token, quien acaba de firmar volvería a su
                // propio enlace y leería «enlace no encontrado» — que es
                // exactamente lo que pasaba antes de mirarlo en un navegador.
                'updated_at' => $ahora,
            ]);

        Ceremony::record(
            tenantId: $tenantId,
            requestId: (string) $solicitud->id,
            eventType: Ceremony::SEALED,
            recordId: $registroId,
            actorEmail: (string) $solicitud->signer_email,
            request: $request,
            detail: ['sealAlgorithm' => Seal::ALGORITHM],
        );

        // ── 5. El certificado ────────────────────────────────────────────────
        $certificadoId = self::buildCertificate(
            solicitud: $solicitud,
            titulo: $titulo,
            firmanteNombre: $signerLegalName,
            registroId: $registroId,
            huellas: [
                'template_content_hash' => (string) $solicitud->template_content_hash,
                'document_sha256' => $shaPdf,
                'signature_sha256' => $shaMarca,
                'consent_copy_hash' => hash('sha256', $consentimiento),
                'integrity_seal' => $sello,
            ],
            store: $store,
        );

        // Actualizar el certificado NO rompe el disparador de MySQL: solo
        // rechaza cambios en sello, huellas, nombre y fecha.
        DB::table('signature_records')
            ->where('id', $registroId)
            ->update(['audit_certificate_document_id' => $certificadoId, 'updated_at' => $ahora]);

        self::linkFactoring($solicitud, (string) $plantilla->template_key, $documentoId);

        return ['recordId' => $registroId, 'documentId' => $documentoId];
    }

    /**
     * Cuelga el documento firmado de la asignación de factoring que lo pedía.
     *
     * `factoring_assignments` tiene dos columnas —`notice_of_assignment_document_id`
     * y `change_of_payee_document_id`— que llevaban vacías desde el principio
     * porque no había forma de producir esos papeles. Ahora la hay, y el
     * expediente de factoring apunta al documento firmado en vez de a nada.
     *
     * No falla si no hay asignación: se puede mandar a firmar un aviso de
     * cesión antes de registrar el factoring, y ese orden es asunto de la casa.
     */
    private static function linkFactoring(object $solicitud, string $templateKey, string $documentoId): void
    {
        $columna = match ($templateKey) {
            'notice_of_assignment' => 'notice_of_assignment_document_id',
            'change_of_payee' => 'change_of_payee_document_id',
            default => null,
        };

        if ($columna === null || $solicitud->carrier_id === null) {
            return;
        }

        DB::table('factoring_assignments')
            ->where('tenant_id', $solicitud->tenant_id)
            ->where('carrier_id', $solicitud->carrier_id)
            ->whereNull('deleted_at')
            ->whereNull($columna)
            ->orderByDesc('effective_from')
            ->limit(1)
            ->update([$columna => $documentoId, 'updated_at' => CarbonImmutable::now()]);
    }

    /** @param array<string, string> $huellas */
    private static function buildCertificate(
        object $solicitud,
        string $titulo,
        string $firmanteNombre,
        string $registroId,
        array $huellas,
        DocumentStore $store,
    ): string {
        $tenantId = (string) $solicitud->tenant_id;

        $eventos = DB::table('signature_audit_events')
            ->where('request_id', $solicitud->id)
            ->orderBy('occurred_at')
            ->orderBy('id')
            ->get(['event_type', 'occurred_at', 'ip_address', 'actor_email'])
            ->map(static fn (object $e): array => [
                'type' => (string) $e->event_type,
                'at' => substr((string) $e->occurred_at, 0, 19),
                'ip' => $e->ip_address,
                'actor' => $e->actor_email,
            ])
            ->all();

        $pdf = Renderer::auditCertificate(
            titulo: $titulo,
            solicitudId: (string) $solicitud->id,
            firmanteNombre: $firmanteNombre,
            firmanteCorreo: (string) $solicitud->signer_email,
            eventos: $eventos,
            huellas: $huellas,
            locale: (string) $solicitud->locale,
        );

        $clave = $store->putBytes($tenantId, $pdf, 'pdf');

        return self::createDocument(
            tenantId: $tenantId,
            // No hay tipo «certificado de auditoría» en el catálogo de
            // documentos y no se inventa uno: añadir un valor al CHECK de
            // `documents.document_type` es una migración, y este certificado no
            // participa en ninguna compuerta de cumplimiento. `other` dice la
            // verdad; el título lo identifica.
            tipo: 'other',
            ownerType: (string) $solicitud->subject_type,
            ownerId: (string) $solicitud->subject_id,
            titulo: $titulo.' — '.($solicitud->locale === 'es' ? 'certificado de auditoría' : 'audit certificate'),
            storageKey: $clave,
            sha256: hash('sha256', $pdf),
            bytes: strlen($pdf),
            nombre: Str::slug($titulo).'-audit-certificate.pdf',
        );
    }

    private static function createDocument(
        string $tenantId,
        string $tipo,
        string $ownerType,
        string $ownerId,
        string $titulo,
        string $storageKey,
        string $sha256,
        int $bytes,
        string $nombre,
    ): string {
        $documentoId = (string) Str::uuid();
        $versionId = (string) Str::uuid();
        $ahora = CarbonImmutable::now();

        DB::table('documents')->insert([
            'id' => $documentoId,
            'tenant_id' => $tenantId,
            'document_type' => $tipo,
            'owner_type' => $ownerType,
            'owner_id' => $ownerId,
            'title' => mb_substr($titulo, 0, 200),
            // Aprobado y no pendiente: lo generó la aplicación a partir de una
            // plantilla que la casa ya publicó. Mandarlo a la cola de revisión
            // haría que alguien tuviera que aprobar el documento que su propia
            // empresa acaba de emitir.
            'review_status' => 'approved',
            'current_version_id' => $versionId,
            'created_at' => $ahora,
            'updated_at' => $ahora,
        ]);

        DB::table('document_versions')->insert([
            'id' => $versionId,
            'tenant_id' => $tenantId,
            'document_id' => $documentoId,
            'version_number' => 1,
            'storage_key' => $storageKey,
            'original_filename' => mb_substr($nombre, 0, 255),
            'content_type' => 'application/pdf',
            'byte_size' => $bytes,
            'sha256' => $sha256,
            // Lo generó la propia aplicación: no hay nada que escanear.
            'malware_scan_status' => 'not_scanned',
            'created_at' => $ahora,
            'updated_at' => $ahora,
        ]);

        return $documentoId;
    }

    /** La clave de plantilla que coincide con un tipo de documento del catálogo. */
    private static function documentType(string $templateKey): string
    {
        return in_array($templateKey, ['carrier_agreement', 'notice_of_assignment', 'change_of_payee'], true)
            ? $templateKey
            : 'other';
    }

    private static function dataUrlBytes(string $dataUrl): string
    {
        if (! str_starts_with($dataUrl, 'data:')) {
            throw new RuntimeException('signature_not_a_data_url');
        }

        $coma = strpos($dataUrl, ',');

        if ($coma === false) {
            throw new RuntimeException('signature_not_a_data_url');
        }

        $bytes = base64_decode(substr($dataUrl, $coma + 1), true);

        if ($bytes === false || $bytes === '') {
            throw new RuntimeException('signature_not_a_data_url');
        }

        return $bytes;
    }

    private static function dataUrlExtension(string $dataUrl): string
    {
        return match (true) {
            str_starts_with($dataUrl, 'data:image/svg+xml') => 'svg',
            str_starts_with($dataUrl, 'data:image/jpeg') => 'jpg',
            default => 'png',
        };
    }
}
