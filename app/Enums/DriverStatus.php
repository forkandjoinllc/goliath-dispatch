<?php

namespace App\Enums;

enum DriverStatus: string
{
    case Available = 'available';
    case OnLoad = 'on_load';
    case OffDuty = 'off_duty';
    case Inactive = 'inactive';
}
