<?php

declare(strict_types=1);

namespace App\Support\Signatures;

use App\Support\Notifications\Notifier;

/**
 * Contarle a la casa cómo acabó una firma.
 *
 * ## El defecto
 *
 * La página que ve quien acaba de RECHAZAR firmar decía, palabra por palabra:
 *
 * > You have declined to sign this document. The sender has been notified.
 *
 * No le habían avisado. `Public\SignatureController::decline()` escribía la
 * fila, grababa el suceso de ceremonia, y no llamaba a nadie. La frase no era
 * una promesa vaga sobre el futuro: era una **afirmación de hecho sobre lo que
 * otra persona ya sabe**, dicha a un tercero de fuera de la casa. Y era falsa.
 *
 * El camino de vuelta estaba mudo en los DOS sentidos, además. `Mailer` manda
 * la solicitud al firmante y le manda la copia firmada **al firmante otra vez**
 * — a la casa, nada. En el catálogo de sucesos de la pantalla de avisos no
 * había ni un solo `signature.*`.
 *
 * Quien firma o rechaza es casi siempre alguien de fuera: un transportista, un
 * cliente. Cierra el navegador y se acabó. Si la casa no se entera, la única
 * forma de saberlo es que a alguien se le ocurra abrir la lista de solicitudes
 * — y una firma que falta es justo lo que impide que una carga se mueva.
 *
 * ## Los avisos van DESPUÉS del sello
 *
 * `sign()` ya sella la firma dentro de una transacción antes de llegar aquí, y
 * el aviso se manda fuera. Si el aviso fallara dentro, se llevaría por delante
 * una firma que ya se capturó legítimamente — y una firma perdida hay que
 * volver a pedírsela a una persona.
 *
 * ## Lo que NO se afirma
 *
 * Que el aviso salga por correo depende de que la instalación tenga
 * credenciales de envío. Lo que esta clase garantiza es la campana dentro de la
 * aplicación, para quien tenga `signature:request:read` en esa empresa.
 */
final class Outcome
{
    public const FIRMADA = 'signature.signed';

    public const RECHAZADA = 'signature.declined';

    /** Quién se entera: el mismo permiso que abre la lista de solicitudes. */
    public const PERMISO = 'signature:request:read';

    /** @return int cuántos avisos se escribieron */
    public static function signed(object $solicitud, ?string $titulo = null): int
    {
        return self::avisar($solicitud, self::FIRMADA, $titulo, []);
    }

    /** @return int cuántos avisos se escribieron */
    public static function declined(object $solicitud, string $motivo, ?string $titulo = null): int
    {
        // El motivo entra en el aviso RECORTADO. Va a parar al asunto de un
        // correo y al cuerpo de una campana, y el campo admite dos mil
        // caracteres: pegarlo entero convertiría el aviso en un muro. Completo
        // está en la fila y en la pantalla de la solicitud, que es adonde
        // lleva el enlace.
        return self::avisar($solicitud, self::RECHAZADA, $titulo, [
            'reason' => mb_strimwidth(trim($motivo), 0, 160, '…'),
        ]);
    }

    /** @param  array<string, string>  $extra */
    private static function avisar(object $solicitud, string $suceso, ?string $titulo, array $extra): int
    {
        $tenantId = (string) $solicitud->tenant_id;

        if ($tenantId === '') {
            return 0;
        }

        $firmante = trim((string) ($solicitud->signer_legal_name ?? ''));

        return Notifier::toPermissionHolders(
            tenantId: $tenantId,
            permission: self::PERMISO,
            eventKey: $suceso,
            // Una vez por solicitud y por desenlace. Una solicitud solo acaba
            // una vez, así que esto es un cinturón: si alguna vez se llamara
            // dos veces, no suena dos veces.
            dedupeKey: $suceso.':'.$solicitud->id,
            params: [
                'signer' => $firmante !== '' ? $firmante : (string) $solicitud->signer_email,
                'document' => $titulo !== null && trim($titulo) !== '' ? trim($titulo) : '—',
            ] + $extra,
            actionUrl: '/signatures/'.$solicitud->id,
            subjectType: 'signature_request',
            subjectId: (string) $solicitud->id,
        );
    }
}
