<?php

declare(strict_types=1);

namespace App\Support;

use BackedEnum;

/**
 * El valor de algo que puede venir como enumeración o como texto.
 *
 * Existe porque los modelos castean columnas a enumeraciones (`DriverStatus`,
 * `LoadStatus`, `VerificationStatus`) pero las consultas crudas de `DB::table()`
 * devuelven el texto tal cual. El mismo campo llega de las dos formas según por
 * dónde se haya leído, y `(string) $enum` no compila en tiempo de ejecución:
 * lanza «could not be converted to string».
 *
 * Ese fallo ya apareció dos veces —una con la base de comisión de una carga y
 * otra con el estado de un conductor— y las dos veces fue un 500 en una
 * pantalla que se veía bien en desarrollo. Una función de tres líneas es más
 * barata que una tercera.
 */
final class EnumValue
{
    public static function of(mixed $value, ?string $default = null): ?string
    {
        if ($value instanceof BackedEnum) {
            return (string) $value->value;
        }

        if ($value === null || $value === '') {
            return $default;
        }

        return (string) $value;
    }
}
