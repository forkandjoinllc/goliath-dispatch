<?php

declare(strict_types=1);

namespace App\Support\Time;

/**
 * Las columnas que son un DÍA y no un instante.
 *
 * ## El defecto
 *
 * `drivers.license_expires_at` la teclea una persona en un `<input type="date">`.
 * Lo que escribe es «1 de junio de 2026» — un día del calendario, sin hora y sin
 * huso. Se guarda como `2026-06-01 00:00:00`, el servidor la manda con
 * `toIso8601String()` —`2026-06-01T00:00:00+00:00`— y la pantalla hace
 * `new Date(eso)`, que el navegador convierte a SU huso.
 *
 * Con el reloj en Chicago:
 *
 * ```
 * /drivers                       31 may 2026
 * /drivers/{id}/edit             2026-06-01
 * ```
 *
 * Dos pantallas del mismo conductor, un día de diferencia, sobre el papel que
 * permite que un camión salga a la carretera. Y la insignia «Vence pronto» la
 * calcula el servidor sobre la fecha de verdad, así que puede salir pegada a una
 * fecha que ya pasó.
 *
 * ## Por qué `Clock` no lo cubría
 *
 * `Clock` tiene tres formas y las tres son correctas para lo que son:
 *
 *  - `at()` — un instante en el huso de quien mira. Cuándo pasó algo.
 *  - `literal()` — una hora de pared que escribió una persona. Convertirla la
 *    movería: un permiso emitido a las 08:00 no son las 07:00 para nadie.
 *  - `utc()` — lo que se queda en UTC porque la pantalla pone «UTC» al lado.
 *
 * Faltaba la cuarta, que es la más simple: un día **no tiene hora que
 * convertir**. `literal()` casi valdría —también es «no lo muevas»— pero
 * devuelve dieciséis caracteres, o sea arrastra un `00:00` que no significa
 * nada y que invita a volver a tratarlo como una hora.
 *
 * ## Y por qué el registro de deuda no lo cazó
 *
 * `Time\Pending::SIN_CONVERTIR` cuenta los sitios que sacan una hora **en
 * crudo**, con `substr(…, 0, 16)`. Estas columnas no están ahí porque no fallan
 * de esa forma: salen perfectamente formateadas en ISO 8601, con su huso y todo.
 * Estar mal en otra forma fue lo que las dejó fuera de la lista que existe
 * justo para que no se olvide nada.
 *
 * Por eso esto es un registro y no un `if`: lo que hace falta es la lista de
 * QUÉ columnas son días, escrita en un sitio, con un guardián que impida que
 * salgan de otra manera.
 */
final class CalendarDates
{
    /**
     * Columna => por qué es un día y no un instante.
     *
     * El criterio es uno y se comprueba mirando el formulario: si la escribe un
     * `<input type="date">`, es un día. Nadie teclea la hora a la que caduca una
     * licencia porque no la tiene.
     *
     * @var array<string, string>
     */
    public const SON_DIAS = [
        'license_expires_at' => 'La caducidad de la CDL. La imprime el estado en el plástico, sin hora.',
        'medical_card_expires_at' => 'La caducidad del certificado médico. Igual: es una fecha impresa en un papel.',
        'twic_expires_at' => 'La caducidad de la credencial TWIC, que se imprime en la tarjeta sin hora.',
        'hazmat_expires_at' => 'La caducidad del endoso de materiales peligrosos, impresa en la licencia.',
        'record_checked_at' => 'El día en que se revisó el historial de conducción. Se apunta a mano, después.',
        'registration_expires_at' => 'La matrícula del vehículo vence un día, no a una hora.',
        'last_inspection_at' => 'El día de la última inspección anual.',
        'next_inspection_due_at' => 'El día en que toca la siguiente.',
        'last_maintenance_at' => 'El día del último mantenimiento.',
        'next_maintenance_due_at' => 'El día en que toca el siguiente.',
        'expiration_date' => 'La caducidad de un documento subido. El propio nombre de la columna dice «date».',
    ];

    /** ¿Esta columna es un día del calendario? */
    public static function esDia(string $columna): bool
    {
        return array_key_exists($columna, self::SON_DIAS);
    }

    /**
     * El día, tal cual, sin tocar la hora ni el huso.
     *
     * Diez caracteres: `2026-06-01`. La pantalla lo pinta con
     * `formatDay()`, que le pega `T00:00:00` para que el navegador lo lea como
     * medianoche LOCAL y no como medianoche UTC. Las dos mitades tienen que ir
     * juntas, y hay un guardián que lo exige.
     */
    public static function dia(mixed $valor): ?string
    {
        if ($valor === null) {
            return null;
        }

        if ($valor instanceof \DateTimeInterface) {
            return $valor->format('Y-m-d');
        }

        $texto = trim((string) $valor);

        return $texto === '' ? null : substr($texto, 0, 10);
    }
}
