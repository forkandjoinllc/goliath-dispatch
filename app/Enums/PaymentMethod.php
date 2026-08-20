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
}
