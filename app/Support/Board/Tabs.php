<?php

declare(strict_types=1);

namespace App\Support\Board;

use App\Enums\LoadStatus;

/**
 * Las tres pestañas del tablero, y qué carga cae en cada una.
 *
 * ## Por qué una clase y no tres `whereIn` sueltos
 *
 * Porque las tres pestañas tienen que repartirse TODAS las cargas vivas y no
 * repetir ninguna: una carga que cayera en dos se contaría dos veces, y una que
 * no cayera en ninguna desaparecería del tablero sin que nadie la echara de
 * menos. La partición se escribe una vez y una prueba comprueba que sigue
 * siendo una partición.
 *
 * ## Dónde está la frontera
 *
 * **Sin asignar** no es un estado de la carga: es la ausencia de conductor en
 * `load_assignments`. Una carga puede estar en `dispatched` y haber perdido a
 * su conductor porque alguien lo sacó; sigue sin asignar, y es justo la que hay
 * que ver primero.
 *
 * **Completadas** empieza en `delivered`. Para quien despacha, la carga se
 * acabó cuando se entregó: lo que viene después —el comprobante, la factura, el
 * cobro— lo mira finanzas en su pantalla, no el tablero. Por eso esta lista no
 * es la de `OpenWork::CARGAS_CERRADAS`, que responde otra pregunta («¿se puede
 * borrar este cliente?») y por eso solo cierra en `paid` y `cancelled`.
 */
final class Tabs
{
    public const SIN_ASIGNAR = 'unassigned';

    public const ASIGNADAS = 'assigned';

    public const COMPLETADAS = 'done';

    /** @var list<string> */
    public const TODAS = [self::SIN_ASIGNAR, self::ASIGNADAS, self::COMPLETADAS];

    /**
     * Los estados que el tablero da por terminados.
     *
     * @return list<string>
     */
    public static function terminados(): array
    {
        return [
            LoadStatus::Delivered->value,
            LoadStatus::PodReceived->value,
            LoadStatus::Invoiced->value,
            LoadStatus::Paid->value,
        ];
    }

    /**
     * Los estados que el tablero no enseña en ninguna pestaña.
     *
     * Una carga cancelada no está sin asignar ni está completada: no está. Y un
     * borrador todavía no es una carga que despachar — quien lo está
     * escribiendo lo tiene abierto en su pantalla.
     *
     * @return list<string>
     */
    public static function fuera(): array
    {
        return [LoadStatus::Cancelled->value, LoadStatus::Draft->value];
    }

    /** ¿Es una de las tres? */
    public static function valida(string $tab): bool
    {
        return in_array($tab, self::TODAS, true);
    }
}
