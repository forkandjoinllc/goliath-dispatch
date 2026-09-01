<?php

declare(strict_types=1);

namespace App\Support\Tracking;

use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Throwable;

/**
 * El correo que lleva el enlace de rastreo al cliente.
 *
 * ## El defecto
 *
 * El sitio público lo promete en CINCO sitios, incluido el paso 4 de «cómo
 * funciona»:
 *
 * > «Una vez despachada su carga, recibirá un enlace seguro por correo
 * > electrónico — no un usuario y contraseña. Ábralo cuando quiera para ver el
 * > estado desde la recolección hasta la entrega.»
 *
 * No salía ningún correo. `public_tracking_links.recipient_email` se pedía en el
 * formulario, se guardaba y no se usaba jamás, y nada se disparaba al despachar.
 * Es un argumento de venta, dicho al cliente final, y era falso.
 *
 * ## En el idioma del que lo recibe
 *
 * El asunto y el cuerpo se resuelven con el locale del DESTINATARIO, no con el
 * de quien despacha. Un despachador que trabaja en español no puede decidir en
 * qué idioma lee su cliente. Mismo criterio que App\Support\Signatures\Mailer,
 * y por eso este fichero se parece a aquel a propósito.
 *
 * ## El enlace va en el cuerpo, y no hay más
 *
 * Nada de adjuntos ni de datos de la carga en el correo. Lo que viaja es la
 * dirección, y quien la abre ve lo que la página pública decida enseñar — que es
 * un sitio donde ya está pensado qué se enseña y qué no. Meter aquí el número de
 * carga o el nombre del transportista sería filtrar por correo lo que la página
 * controla.
 */
final class LinkMailer
{
    /**
     * Compone el mensaje. Función pura: se puede probar sin mandar nada.
     *
     * @return array{to: string, subject: string, body: string}
     */
    public static function compose(string $to, string $url, string $tenantName, string $locale): array
    {
        return [
            'to' => $to,
            'subject' => self::linea('tracking.email.subject', $locale, ['tenant' => $tenantName]),
            'body' => self::linea('tracking.email.body', $locale, [
                'tenant' => $tenantName,
                'url' => $url,
            ]),
        ];
    }

    /** @return bool si salió */
    public static function send(string $to, string $url, string $tenantName, string $locale): bool
    {
        $mensaje = self::compose($to, $url, $tenantName, $locale);

        try {
            Mail::mailer(config('mail.default'))->raw(
                $mensaje['body'],
                static function ($m) use ($mensaje): void {
                    $m->to($mensaje['to'])->subject($mensaje['subject']);
                },
            );

            return true;
        } catch (Throwable $e) {
            // Que no salga el correo NO puede tumbar el despacho. La carga sale
            // igual y el enlace queda creado: se puede reenviar desde la
            // pantalla de rastreo, que es mejor que haber impedido despachar
            // porque el servidor de correo tuvo un mal minuto.
            Log::warning('No salió el correo del enlace de rastreo', [
                'error' => $e->getMessage(),
            ]);

            return false;
        }
    }

    /** @param array<string, string> $params */
    private static function linea(string $clave, string $locale, array $params): string
    {
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
