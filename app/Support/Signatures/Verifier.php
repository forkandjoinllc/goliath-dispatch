<?php

declare(strict_types=1);

namespace App\Support\Signatures;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

/**
 * Vuelve a comprobar, en el momento en que alguien mira, que una firma sigue
 * siendo la que se hizo.
 *
 * No lee ninguna bandera. Las tres comprobaciones se RECALCULAN a partir de lo
 * que hay guardado, porque una bandera «verificado = sí» se puede poner con el
 * mismo `update` que rompió lo que decía proteger. El diccionario portado ya lo
 * decía en la pantalla, y es la promesa que hay que cumplir: «recalculada a
 * partir del registro y del documento almacenados».
 *
 * Las tres son independientes y responden preguntas distintas:
 *
 *  - **El sello** responde «¿los datos de esta fila son los que se sellaron?».
 *    Lleva clave, así que quien edite la fila no puede volver a sellarla.
 *  - **El hash del documento** responde «¿el fichero guardado sigue siendo el
 *    que se firmó?». Se lee el fichero entero y se le saca el sha256.
 *  - **La cadena** responde «¿la bitácora de la ceremonia está entera y en
 *    orden?».
 *
 * Un caso que merece nombre propio: si el fichero firmado NO ESTÁ, eso no es
 * «documento alterado», es «no se puede comprobar». Decir que algo falló cuando
 * lo que pasa es que no se pudo mirar hace que la pantalla mienta en la
 * dirección más cara.
 */
final class Verifier
{
    /**
     * @return array{
     *     seal: bool,
     *     sealDerivedKey: bool,
     *     document: 'valid'|'invalid'|'unavailable',
     *     chain: bool,
     *     chainBrokenAt: string|null,
     * }
     */
    public static function verify(object $registro): array
    {
        $solicitud = DB::table('signature_requests')
            ->where('id', $registro->request_id)
            ->first(['template_content_hash']);

        $sello = false;

        if ($solicitud !== null) {
            $esperado = Seal::compute(Seal::components(
                templateContentHash: (string) $solicitud->template_content_hash,
                documentSha256: (string) $registro->document_sha256,
                signatureSha256: (string) $registro->signature_sha256,
                signerLegalName: (string) $registro->signer_legal_name,
                signerEmail: (string) $registro->signer_email,
                signedAt: (string) $registro->signed_at,
            ));

            // hash_equals y no ===: comparar cadenas secretas byte a byte con
            // salida temprana filtra por dónde deja de coincidir.
            $sello = hash_equals($esperado, (string) $registro->integrity_seal);
        }

        $rotoEn = Ceremony::verifyChain((string) $registro->request_id);

        return [
            'seal' => $sello,
            'sealDerivedKey' => Seal::usingDerivedKey(),
            'document' => self::verifyDocument($registro),
            'chain' => $rotoEn === null,
            'chainBrokenAt' => $rotoEn,
        ];
    }

    /** @return 'valid'|'invalid'|'unavailable' */
    private static function verifyDocument(object $registro): string
    {
        $documentoId = $registro->signed_document_id ?? null;

        if ($documentoId === null) {
            return 'unavailable';
        }

        $clave = DB::table('documents as d')
            ->join('document_versions as v', 'v.id', '=', 'd.current_version_id')
            ->where('d.id', $documentoId)
            ->value('v.storage_key');

        if (! is_string($clave) || ! Storage::disk('local')->exists($clave)) {
            return 'unavailable';
        }

        $bytes = Storage::disk('local')->get($clave);

        if ($bytes === null) {
            return 'unavailable';
        }

        return hash_equals((string) $registro->document_sha256, hash('sha256', $bytes))
            ? 'valid'
            : 'invalid';
    }
}
