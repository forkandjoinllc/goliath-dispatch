<?php

declare(strict_types=1);

namespace App\Enums;

/**
 * Lo que una carga puede exigir de quien la lleva.
 *
 * Cuatro tipos, y cada uno se contesta con un dato que ya vive en la ficha del
 * conductor (lote 18). Si algún día hace falta un quinto, va aquí, en el CHECK
 * de la tabla y en DriverEligibility — los tres a la vez, o el requisito se
 * podrá guardar y nadie sabrá evaluarlo.
 */
enum LoadRequirementType: string
{
    /** Tarjeta TWIC vigente. Puertos y varias instalaciones federales. */
    case Twic = 'twic';

    /** Un endorsement concreto de la CDL: H, N, T, P, X, S. El valor lo dice. */
    case Endorsement = 'endorsement';

    /**
     * Un estatus de autorización de trabajo concreto.
     *
     * El requisito OBLIGA a decir de dónde sale. Ver la migración
     * 2026_08_31_100000 y App\Enums\WorkAuthorization.
     */
    case WorkAuthorization = 'work_authorization';

    /** Récord limpio de N años. El valor es N. */
    case CleanRecord = 'clean_record';

    /** @return list<string> */
    public static function values(): array
    {
        return array_map(static fn (self $c): string => $c->value, self::cases());
    }
}
