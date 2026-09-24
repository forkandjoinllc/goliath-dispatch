<?php

namespace App\Enums;

enum DriverStatus: string
{
    case Available = 'available';
    case OnLoad = 'on_load';
    case OffDuty = 'off_duty';
    case Inactive = 'inactive';

    /** Parado temporalmente: vuelve. */
    case OnHold = 'on_hold';

    /** Dado de baja: no vuelve, salvo que se le vuelva a contratar. */
    case Terminated = 'terminated';

    /** @return list<string> */
    public static function values(): array
    {
        return array_map(static fn (self $c): string => $c->value, self::cases());
    }
}
