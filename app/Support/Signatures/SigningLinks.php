<?php

declare(strict_types=1);

namespace App\Support\Signatures;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * El enlace con el que alguien firma sin tener cuenta, y en qué estado está.
 *
 * Mismo trato que el enlace de seguimiento: SE GUARDA EL HASH, nunca el enlace.
 * `access_token_hash` es un sha256 en hexadecimal con índice único, así que
 * resolver un token es una búsqueda por igualdad y quien lea la base de datos no
 * puede firmar en nombre de nadie.
 *
 * La diferencia con el seguimiento es en qué se convierte el token: allí abre
 * una página que solo se lee, aquí abre una en la que se ESCRIBE algo que luego
 * se sella. Por eso `resolve()` devuelve el motivo exacto por el que un enlace
 * no sirve, y son seis: el diccionario portado ya tenía un texto distinto para
 * cada uno. Al firmante hay que decírselo, no protegerse de él — a diferencia
 * del rastreo público, donde los cuatro rechazos son 404 iguales porque ahí el
 * que prueba enlaces es un desconocido. Aquí el enlace se le mandó por correo a
 * una persona concreta, y saber si su documento fue anulado o si venció es
 * exactamente lo que necesita para saber a quién llamar.
 *
 * Que eso no filtre nada depende de un detalle: los seis motivos solo se
 * distinguen cuando el token ES VÁLIDO. Un token inventado da siempre
 * `not_found`, así que probar tokens al azar no dice nada de lo que existió.
 */
final class SigningLinks
{
    /**
     * Crea la solicitud y devuelve el token EN CLARO.
     *
     * @param  array<string, mixed>  $tokenValues
     * @return array{requestId: string, token: string}
     */
    public static function issue(
        string $tenantId,
        object $plantilla,
        string $subjectType,
        string $subjectId,
        ?string $carrierId,
        string $signerEmail,
        ?string $signerLegalName,
        string $locale,
        array $tokenValues,
        ?int $expiryDays,
        ?string $requestedByUserId,
    ): array {
        $plano = Str::random(48);
        $ahora = CarbonImmutable::now();
        $id = (string) Str::uuid();

        $dias = $expiryDays ?? (int) Config::get('signatures.default_expiry_days', 30);
        $tope = (int) Config::get('signatures.max_expiry_days', 365);

        // Cero o negativo significa «sin vencimiento», que el diccionario
        // portado contempla: un acuerdo de transportista se manda para que se
        // firme, no para que caduque.
        $vence = $dias <= 0 ? null : $ahora->addDays(min($dias, $tope));

        DB::table('signature_requests')->insert([
            'id' => $id,
            'tenant_id' => $tenantId,
            'template_id' => (string) $plantilla->id,
            'template_version' => (int) $plantilla->version,
            'template_content_hash' => (string) $plantilla->content_hash,
            'subject_type' => $subjectType,
            'subject_id' => $subjectId,
            'carrier_id' => $carrierId,
            'signer_email' => $signerEmail,
            'signer_legal_name' => $signerLegalName,
            'locale' => $locale,
            'status' => 'pending',
            'token_values' => json_encode($tokenValues, JSON_UNESCAPED_UNICODE),
            'access_token_hash' => hash('sha256', $plano),
            'requested_by_user_id' => $requestedByUserId,
            'requested_at' => $ahora,
            'expires_at' => $vence,
            'created_at' => $ahora,
            'updated_at' => $ahora,
        ]);

        return ['requestId' => $id, 'token' => $plano];
    }

    /**
     * Qué hay detrás de un token.
     *
     * @return array{state: string, request: object|null}
     */
    public static function resolve(string $token): array
    {
        $fila = DB::table('signature_requests')
            ->where('access_token_hash', hash('sha256', $token))
            ->whereNull('deleted_at')
            ->first();

        if ($fila === null) {
            return ['state' => 'not_found', 'request' => null];
        }

        // El vencimiento se comprueba por la fecha, no por el estado guardado:
        // nada corre a medianoche a poner `expired` en las filas, y una
        // solicitud que venció ayer tiene que dejar de abrirse hoy aunque su
        // columna `status` siga diciendo `pending`.
        if ($fila->expires_at !== null
            && CarbonImmutable::parse((string) $fila->expires_at)->isPast()
            && in_array((string) $fila->status, ['pending', 'viewed'], true)) {
            return ['state' => 'expired', 'request' => $fila];
        }

        $estado = (string) $fila->status;

        return [
            'state' => match ($estado) {
                'pending', 'viewed' => 'open',
                'signed' => 'already_signed',
                'declined' => 'declined',
                'voided' => 'voided',
                'superseded' => 'superseded',
                'expired' => 'expired',
                default => 'not_found',
            },
            'request' => $fila,
        ];
    }
}
