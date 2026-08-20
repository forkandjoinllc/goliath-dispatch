<?php

namespace App\Enums;

enum UserStatus: string
{
    case Invited = 'invited';
    case PendingVerification = 'pending_verification';
    case Active = 'active';
    case Suspended = 'suspended';
    case Deactivated = 'deactivated';
}
