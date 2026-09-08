<?php

declare(strict_types=1);

namespace App\Support\Time;

use Carbon\CarbonImmutable;

/**
 * Un instante guardado en UTC, en el huso de quien lo mira.
 *
 * ## La decisión ya estaba escrita
 *
 * `docs/mysql-port.md`, en la sección de fechas:
 *
 * > MySQL no tiene equivalente de `timestamptz`: no guarda la zona. La
 * > aplicación almacena UTC y **resuelve la zona al presentar**.
 *
 * La primera mitad se cumplía —todo está en `datetime(3)` UTC— y la segunda no
 * se hacía en ningún sitio. Sesenta y siete marcas de tiempo salían a pantalla
 * con `substr((string) $x->algo_at, 0, 16)`: en UTC, sin etiqueta y sin
 * convertir. Cuándo se mandó una factura, cuándo entró un mensaje, cuándo se
 * firmó un documento.
 *
 * Y `users.timezone` existe, se carga en el `Actor`, tiene `America/New_York`
 * por omisión… y no lo leía nadie. Encima no había pantalla donde cambiarlo,
 * así que una empresa de Texas veía todo con una hora de más sin poder
 * arreglarlo.
 *
 * ## Este NO es el reloj de las paradas
 *
 * `App\Support\Loads\StopClock` resuelve otra pregunta y por eso es otra clase:
 * la cita de una parada se enseña en el huso **del muelle**, porque una cita es
 * del muelle y no de quien la mira. Lo dice el mismo documento, en la frase
 * siguiente. Aquí se resuelve el huso **de quien mira**, que es lo correcto
 * para todo lo demás: cuándo pasó algo dentro del sistema.
 *
 * Las dos comparten la maquinaria —convertir y etiquetar— y no la regla.
 */
final class Clock
{
    /** El que se usa cuando no hay nadie de quien sacar el huso. */
    public const POR_OMISION = 'America/New_York';

    /**
     * El instante, en el huso pedido, recortado al minuto.
     *
     * Al minuto y no al segundo porque es lo que enseñaban ya las pantallas:
     * este lote cambia el RELOJ, no la precisión.
     */
    public static function at(mixed $utc, ?string $timezone): ?string
    {
        if ($utc === null) {
            return null;
        }

        return CarbonImmutable::parse((string) $utc, 'UTC')
            ->setTimezone(self::zona($timezone))
            ->format('Y-m-d H:i');
    }

    /**
     * La abreviatura que se pinta al lado: EDT, CST, MST…
     *
     * Depende de la FECHA y no solo del huso: el mismo sitio es CST en enero y
     * CDT en julio, y esa diferencia es una hora de verdad.
     */
    public static function label(?string $timezone, mixed $cuando = null): string
    {
        $momento = $cuando === null
            ? CarbonImmutable::now(self::zona($timezone))
            : CarbonImmutable::parse((string) $cuando, 'UTC')->setTimezone(self::zona($timezone));

        return $momento->format('T');
    }

    /**
     * Una hora que escribió una PERSONA, y que por eso no se convierte.
     *
     * No todo `datetime` de la base de datos es un instante en UTC. Estas se
     * guardan tal como se teclearon en un `<input type="datetime-local">` y
     * significan la hora del sitio donde ocurre la cosa, no la del servidor:
     *
     *  - `permits.issued_at` y `permits.expires_at` — las pone el estado que
     *    emite el permiso, y valen en la hora de ese estado.
     *  - `escorts.scheduled_for` — la hora a la que queda el escolta.
     *  - `load_stops.window_start` / `window_end` — la cita del muelle; esas
     *    pasan por StopClock::window(), que es esto mismo con otro nombre
     *    porque allí hay además un reloj de muelle del que hablar.
     *
     * Convertirlas sería MOVERLAS: un permiso emitido a las 08:00 pasaría a
     * decir 07:00 para quien mira desde otro huso, y no hay ningún sentido en
     * el que eso sea más cierto. Existe como método —en vez de dejar el
     * `substr` suelto— para que quede escrito que NO convertir es la decisión,
     * no el olvido, y para que el guardián pueda exigir que pase por aquí.
     */
    public static function literal(mixed $valor): ?string
    {
        return $valor === null ? null : substr((string) $valor, 0, 16);
    }

    /**
     * Un instante que se queda en UTC A PROPÓSITO, porque la superficie lo dice.
     *
     * Hoy solo hay una: el certificado de auditoría de una firma. Un
     * certificado se descarga, se archiva y se le enseña a un tercero; si la
     * hora dependiera de quién pulsó el botón, dos copias del mismo documento
     * dirían cosas distintas del mismo acto. Ahí la cabecera de la columna pone
     * «(UTC)» y el valor se queda como está.
     *
     * Quien use esto tiene que enseñar la palabra UTC en la misma pantalla. No
     * es una regla que se pueda comprobar desde el código, así que va escrita
     * aquí y el guardián exige que las llamadas sean estas y no otras.
     */
    public static function utc(mixed $utc, int $precision = 19): ?string
    {
        return $utc === null ? null : substr((string) $utc, 0, $precision);
    }

    /** Un huso utilizable, venga lo que venga. */
    public static function zona(?string $timezone): string
    {
        if ($timezone === null || trim($timezone) === '') {
            return self::POR_OMISION;
        }

        // Un huso inválido guardado en una fila no puede tumbar una pantalla.
        // Se cae al de por omisión, que es el mismo que pone el esquema en
        // `users.timezone`.
        return in_array($timezone, timezone_identifiers_list(), true)
            ? $timezone
            : self::POR_OMISION;
    }

    /** Los husos que se pueden elegir, para el desplegable. */
    public static function opciones(): array
    {
        // Los de Estados Unidos y nada más: es donde opera este producto, y una
        // lista de cuatrocientos husos en un desplegable no es una opción, es
        // un laberinto. Cuando haga falta otro, se añade aquí y la validación
        // lo acepta sola.
        return [
            'America/New_York',
            'America/Chicago',
            'America/Denver',
            'America/Phoenix',
            'America/Los_Angeles',
            'America/Anchorage',
            'Pacific/Honolulu',
            'America/Puerto_Rico',
        ];
    }
}
