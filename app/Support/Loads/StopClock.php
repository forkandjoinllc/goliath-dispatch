<?php

declare(strict_types=1);

namespace App\Support\Loads;

use App\Support\Time\Clock;

/**
 * En qué reloj está cada hora de una parada, y cómo se enseña.
 *
 * ## El defecto
 *
 * En la misma lista, una al lado de la otra y sin etiqueta, se pintaban dos
 * horas que NO estaban en el mismo reloj:
 *
 *  - `window_start` / `window_end` los escribe el despachador en un
 *    `datetime-local` y se guardan tal cual: son la hora **del muelle**.
 *  - `actual_arrival_at` / `actual_departure_at` los escribe `StopProgress` con
 *    `CarbonImmutable::now()`, y `config('app.timezone')` es `UTC`.
 *
 * Comprobado anotando una llegada de verdad sobre una parada de
 * `America/New_York`: ventana 08:00, hora local 09:04 —dentro de la ventana— y
 * se guardó 13:04. En pantalla eso se lee como cinco horas tarde. Y se leía así
 * en la página PÚBLICA de rastreo, que es la que abre el cliente sin cuenta.
 *
 * Cuatro horas de error en verano; cinco para una parada de Chicago en
 * invierno.
 *
 * ## Por qué NO se ha migrado la ventana a UTC
 *
 * Era la otra salida: guardar las dos en UTC y convertir las dos al pintar.
 * Habría que reinterpretar cada `window_start` que ya existe como si estuviera
 * en el huso de su parada y reescribirlo — y si el huso de alguna fila está mal,
 * eso mueve una cita de verdad sin forma de saber cuál se movió.
 *
 * Se hace lo contrario: la ventana SIGUE siendo hora del muelle, que es lo que
 * significa `load_stops.timezone` y lo que dice `docs/customer-places.md` —«una
 * cita puede pactarse en otro huso… es una decisión de esa carga»—, y lo que se
 * convierte al enseñarlo es el instante, que es el que sí está en UTC.
 *
 * ## Y las dos se etiquetan
 *
 * Convertir sin decir en qué reloj está lo que se enseña deja el mismo problema
 * a medias: quien lee «8:00» sigue sin saber si es su hora o la del muelle. Va
 * la abreviatura del huso al lado.
 */
final class StopClock
{
    /** El que se usa cuando la parada no trae huso. */
    public const POR_OMISION = 'America/Chicago';

    /**
     * La ventana, que YA está en la hora del muelle.
     *
     * No se convierte: se recorta. Existe como método —en vez de dejar el
     * `substr` suelto por ahí— para que quede escrito que esta hora no se toca
     * a propósito, y para que el guardián pueda exigir que pase por aquí.
     */
    public static function window(mixed $valor): ?string
    {
        return $valor === null ? null : substr((string) $valor, 0, 16);
    }

    /**
     * Un instante guardado en UTC, en la hora del muelle.
     */
    public static function moment(mixed $utc, ?string $timezone): ?string
    {
        // La maquinaria es la misma que la del reloj general; lo que cambia es
        // DE QUIÉN sale el huso. Aquí, del muelle.
        return Clock::at($utc, self::zona($timezone));
    }

    /**
     * La abreviatura que se pinta al lado: CDT, EST, MST…
     *
     * Depende de la FECHA, no solo del huso: la misma parada de Chicago es CST
     * en enero y CDT en julio. Por eso se pide el instante y no solo la zona.
     */
    public static function label(?string $timezone, mixed $cuando = null): string
    {
        return Clock::label(self::zona($timezone), $cuando);
    }

    /** Un huso utilizable, venga lo que venga de la fila. */
    private static function zona(?string $timezone): string
    {
        // Ojo con el POR OMISIÓN: el de las paradas es America/Chicago, que es
        // lo que pone el formulario al crear una, y el del reloj general es
        // America/New_York, que es lo que pone el esquema en `users.timezone`.
        // Son dos valores distintos a propósito y por eso esta comprobación no
        // se delega en Clock::zona().
        if ($timezone === null || trim($timezone) === '') {
            return self::POR_OMISION;
        }

        // Un huso inválido en la fila no puede tumbar la pantalla de rastreo
        // que está mirando un cliente.
        return in_array($timezone, timezone_identifiers_list(), true)
            ? $timezone
            : self::POR_OMISION;
    }
}
