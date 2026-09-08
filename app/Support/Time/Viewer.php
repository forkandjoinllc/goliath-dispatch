<?php

declare(strict_types=1);

namespace App\Support\Time;

use App\Authorization\CurrentActor;

/**
 * El reloj de quien está mirando ESTA petición.
 *
 * `Clock` no sabe de nadie: recibe un huso y convierte. Quién es «quien mira»
 * —y de dónde sale su huso— se resuelve aquí, una sola vez, y por eso esta
 * clase existe aparte en vez de meterle el `Actor` a `Clock`: así `Clock` se
 * puede probar con un huso literal, sin sesión y sin contenedor.
 *
 * Hay dos puertas a esto y no una porque hay dos formas de llamada en el
 * código:
 *
 *  - `PresentsTime`, el trait, para los controladores. Ahí el reemplazo es
 *    `$this->hora($x)` y se lee al lado de las otras claves del array.
 *  - Esta clase, estática, para las ayudas que no son objetos con `$this`:
 *    `Inbox::messages()`, `Readiness`, `TrackingLinks`. Un trait no les sirve
 *    porque sus métodos son estáticos.
 *
 * Las dos resuelven el huso con el mismo código. Si mañana el huso sale de otro
 * sitio —de la empresa activa, de una cabecera— se cambia `zone()` y cambia en
 * todas partes.
 */
final class Viewer
{
    /** El huso de quien mira; el de por omisión si no hay sesión. */
    public static function zone(): string
    {
        $actor = app(CurrentActor::class)->get();

        // Sin lanzar cuando no hay actor, a propósito: una pantalla PÚBLICA que
        // llame a esto por error tiene que enseñar una hora en el huso por
        // omisión, no un error 500 a un cliente que no tiene cuenta.
        return Clock::zona($actor?->timezone);
    }

    /** El instante, en el huso de quien mira, al minuto. */
    public static function at(mixed $utc): ?string
    {
        return Clock::at($utc, self::zone());
    }

    /** La abreviatura del huso de quien mira para ese instante: EDT, CST… */
    public static function label(mixed $cuando = null): string
    {
        return Clock::label(self::zone(), $cuando);
    }
}
