<?php

namespace App\Enums;

enum Role: string
{
    case PlatformSuperAdmin = 'platform_super_admin';
    case Admin = 'admin';
    case Accounting = 'accounting';
    case Dispatcher = 'dispatcher';
    case Carrier = 'carrier';
    case Driver = 'driver';
}
