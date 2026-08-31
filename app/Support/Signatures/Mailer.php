<?php

declare(strict_types=1);

namespace App\Support\Signatures;

use Illuminate\Support\Facades\App;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Throwable;

/**
 * Los dos correos de una firma: el enlace y la copia.
 *
 * POR QUÉ NO PASA POR `Notifier`. Esa clase es el único sitio que escribe en
 * `notifications`, y esa tabla tiene `user_id` NOT NULL más un índice único
 * sobre `(dedupe_key, user_id, channel)`. Toda su forma da por hecho que el
 * destinatario tiene cuenta: de ahí saca el idioma, las preferencias de canal y
 * el sitio donde deduplicar. El firmante de un acuerdo NO tiene cuenta — es la
 * premisa entera de la ceremonia. Meterlo ahí a la fuerza habría exigido un
 * usuario falso o una columna nullable que rompe el índice.
 *
 * Así que esto manda un correo y nada más. No escribe una notificación, no
 * deduplica y no consulta preferencias, porque ninguna de las tres cosas
 * significa nada para alguien que no está en la casa.
 *
 * EL IDIOMA SALE DE LA SOLICITUD, no de la petición. Quien manda el acuerdo
 * decide en qué idioma habla su transportista, y esa decisión se guardó en
 * `signature_requests.locale` al crearlo. Si el correo cogiera el idioma de la
 * petición, el que sale de un despachador trabajando en inglés llegaría en
 * inglés a alguien al que se le escribió en español.
 *
 * UN FALLO DE CORREO NO TUMBA UNA FIRMA. La solicitud ya está creada y el
 * enlace ya se enseñó en pantalla; que el servidor de correo esté caído es un
 * problema de entrega, no un motivo para deshacer nada. Se anota en el registro
 * y se sigue — mismo criterio que `Notifier`.
 */
final class Mailer
{
    /**
     * El enlace de firma.
     *
     * @return bool ¿Salió el correo?
     */
    public static function sendRequest(object $solicitud, string $url, string $tenantName, string $title): bool
    {
        $mensaje = self::composeRequest($solicitud, $url, $tenantName, $title);

        return self::enviar($mensaje['to'], $mensaje['subject'], $mensaje['body']);
    }

    /**
     * El correo del enlace, sin mandarlo.
     *
     * Se separa de `sendRequest()` porque lo que hay que poder comprobar de un
     * correo es QUÉ DICE y EN QUÉ IDIOMA, y eso se comprueba aquí — sin
     * depender de cómo el doble de pruebas de Laravel registre un envío en
     * crudo, que es un detalle del framework y no una decisión de este código.
     *
     * @return array{to: string, subject: string, body: string}
     */
    public static function composeRequest(object $solicitud, string $url, string $tenantName, string $title): array
    {
        $locale = (string) $solicitud->locale;

        $cuerpo = self::linea('signature.email.requestBody', $locale, [
            'tenant' => $tenantName,
            'title' => $title,
        ]);
        $cta = self::linea('signature.email.requestCta', $locale, []);

        return [
            'to' => (string) $solicitud->signer_email,
            'subject' => self::linea('signature.email.requestSubject', $locale, ['tenant' => $tenantName]),
            'body' => $cuerpo."\n\n".$cta.":\n".$url,
        ];
    }

    /**
     * El aviso de que la copia firmada está lista.
     *
     * NO se adjunta nada. El diccionario portado dice «adjuntamos su copia
     * firmada», y adjuntar un PDF a un correo saliente es mandar el acuerdo a
     * un buzón que no controlamos y que se reenvía tres veces. El texto que se
     * usa es el del cuerpo, sin la promesa del adjunto, y el acuerdo se
     * descarga desde la aplicación por su ruta con permiso y registro de
     * acceso. Si algún día se decide adjuntarlo, que sea una decisión, no un
     * efecto secundario de una frase del diccionario.
     */
    public static function sendSignedCopy(object $solicitud, string $tenantName): bool
    {
        $mensaje = self::composeSignedCopy($solicitud, $tenantName);

        return self::enviar($mensaje['to'], $mensaje['subject'], $mensaje['body']);
    }

    /** @return array{to: string, subject: string, body: string} */
    public static function composeSignedCopy(object $solicitud, string $tenantName): array
    {
        $locale = (string) $solicitud->locale;

        return [
            'to' => (string) $solicitud->signer_email,
            'subject' => self::linea('signature.email.signedCopySubject', $locale, ['tenant' => $tenantName]),
            'body' => self::linea('signature.email.signedCopyNotice', $locale, ['tenant' => $tenantName]),
        ];
    }

    private static function enviar(string $para, string $asunto, string $cuerpo): bool
    {
        try {
            Mail::mailer(config('mail.default'))->raw(
                $cuerpo,
                static function ($mensaje) use ($para, $asunto): void {
                    $mensaje->to($para)->subject($asunto);
                },
            );

            return true;
        } catch (Throwable $e) {
            Log::warning('No salió el correo de firma', [
                'error' => $e->getMessage(),
            ]);

            return false;
        }
    }

    /** @param array<string, string> $params */
    private static function linea(string $clave, string $locale, array $params): string
    {
        // `__()` con locale explícito: el idioma es el de la solicitud, no el
        // de quien está mirando la aplicación en este momento.
        $texto = __($clave, [], $locale);

        if (! is_string($texto)) {
            return $clave;
        }

        foreach ($params as $nombre => $valor) {
            $texto = str_replace('{'.$nombre.'}', $valor, $texto);
        }

        return $texto;
    }
}
