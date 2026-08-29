<?php

namespace App\Enums;

enum PaymentMethod: string
{
    case Card = 'card';
    case Ach = 'ach';
    case Check = 'check';
    case Wire = 'wire';
    case Cash = 'cash';
    case Offset = 'offset';
    case Other = 'other';

    /** @return list<string> */
    public static function values(): array
    {
        return array_map(static fn (self $m): string => $m->value, self::cases());
    }
}
