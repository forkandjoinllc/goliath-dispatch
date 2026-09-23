<?php

namespace App\Enums;

/**
 * De quién es la unidad.
 *
 * Tres, y las tres se escriben desde el formulario: no hay aquí ningún valor
 * que el producto no sepa producir.
 */
enum EquipmentOwnership: string
{
    /** De la empresa transportista. */
    case Owned = 'owned';

    /** Arrendada: se devuelve al final del contrato. */
    case Leased = 'leased';

    /** Arrendamiento con opción a compra: al final se queda. */
    case LeaseToOwn = 'lease_to_own';

    /** @return list<string> */
    public static function values(): array
    {
        return array_map(static fn (self $c): string => $c->value, self::cases());
    }
}
