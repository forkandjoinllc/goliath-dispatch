<?php

declare(strict_types=1);

namespace App\Support\Notifications;

use App\Enums\NotificationChannel;

/**
 * Por dónde sale un aviso de verdad, y por dónde no sale ninguno.
 *
 * ## El defecto
 *
 * `NotificationChannel` declara tres canales: dentro de la aplicación, correo y
 * SMS. El emisor entrega por dos. El tercero estaba escrito en el enum, en una
 * columna de `notification_preferences`, en una fecha de consentimiento de la
 * ficha del conductor, en el panel de proveedores —que lo daba por «real» en
 * cuanto hubiera un `TWILIO_SID` escrito— y, lo más caro de todo, en la
 * **política de privacidad pública**, que decía en los dos idiomas:
 *
 * > Puede retirar su consentimiento en cualquier momento respondiendo STOP a
 * > cualquier mensaje, lo que **suprime de inmediato** el envío de más SMS a
 * > ese número; responder HELP devuelve la información de contacto de soporte.
 *
 * No hay envío, no hay ruta de entrada para STOP ni para HELP, y no existe
 * proveedor atado a nada. Es una promesa sobre cómo se tratan los mensajes de
 * alguien, hecha en la página que lee quien todavía no es cliente y no tiene
 * forma de comprobarla.
 *
 * Lo llamativo: el diagnóstico YA ESTABA ESCRITO. `Notifier` decía en una línea
 * «`sms` está declarado y suprimido» —y ahí se quedó, en un comentario privado
 * de una clase interna, mientras cuatro pantallas seguían diciendo lo
 * contrario. Es la forma que se repite en este proyecto: el defecto estaba
 * diagnosticado por escrito y el diagnóstico no se aplicó en todas partes.
 *
 * ## Por qué un registro y no una lista
 *
 * Una lista de dos canales no explica por qué el tercero no está, y un hueco
 * sin motivo se lee como descuido — entonces alguien escribe la copia que cree
 * que corresponde, que es exactamente lo que pasó. Aquí el canal suprimido se
 * declara CON SU RAZÓN, y un guardián exige que la suma de entregados y
 * suprimidos sea el enum entero: un canal nuevo no puede existir sin que
 * alguien diga por cuál de los dos lados cae.
 *
 * ## Lo que este registro NO dice
 *
 * Que esté bien no mandar SMS. Puede que deba mandarse —un conductor sin correo
 * en la cabina es el caso normal, no el raro—, pero construirlo es un cambio de
 * producto con proveedor, número, coste por mensaje, manejo de STOP y HELP, y
 * una revisión legal que este fichero no sustituye ni pretende. Ver
 * `docs/sms-promise.md`.
 */
final class Channels
{
    /**
     * Canales por los que un aviso sale de verdad.
     *
     * @var list<string>
     */
    public const ENTREGADOS = ['in_app', 'email'];

    /**
     * Canales declarados que no entregan nada, con el motivo.
     *
     * @var array<string, string>
     */
    public const SUPRIMIDOS = [
        'sms' => 'No hay emisor: ninguna clase manda un mensaje de texto, no hay proveedor atado y no existe ruta de entrada para STOP ni para HELP. El enum, la columna `notification_preferences.sms` y `drivers.sms_consent_granted_at` están escritos y nadie los llena. Mientras esto siga así, ninguna pantalla puede ofrecer SMS ni prometer cómo se tratan.',
    ];

    /** Si un canal entrega de verdad. */
    public static function entrega(string $canal): bool
    {
        return in_array($canal, self::ENTREGADOS, true);
    }

    /**
     * Todos los canales del enum, entreguen o no.
     *
     * @return list<string>
     */
    public static function declarados(): array
    {
        return array_map(
            static fn (NotificationChannel $c): string => $c->value,
            NotificationChannel::cases(),
        );
    }
}
