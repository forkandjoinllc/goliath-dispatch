<?php

declare(strict_types=1);

namespace App\Support;

/**
 * La misma regla de concordancia de número que aplica el cliente.
 *
 * El diccionario es JSON compartido, y las dos mitades tienen que elegir la
 * misma clave o el mismo texto saldría en singular en pantalla y en plural en
 * un mensaje de confirmación. La regla es una sola: con `n` igual a 1 se usa la
 * clave hermana `<clave>One`; con cualquier otro número —el cero incluido— la
 * base.
 *
 * Inglés y español comparten esa partición y el cero va con el plural en los
 * dos («0 facturas», «0 invoices»). Si algún día entra un idioma con más formas,
 * este método y su gemelo en resources/js/lib/i18n.tsx son los dos sitios donde
 * se amplía. Que sean dos y no uno es el precio de servir el mismo diccionario
 * a un servidor PHP y a un cliente React.
 */
final class Plural
{
    /** Devuelve la clave que toca para esta cantidad. */
    public static function key(string $base, int|float|string $n): string
    {
        return (int) $n === 1 ? $base.'One' : $base;
    }
}
