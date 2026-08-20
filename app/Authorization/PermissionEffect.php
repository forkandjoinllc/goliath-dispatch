<?php

declare(strict_types=1);

namespace App\Authorization;

enum PermissionEffect: string
{
    case Grant = 'grant';
    case Deny = 'deny';
}
