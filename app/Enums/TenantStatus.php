<?php

namespace App\Enums;

enum TenantStatus: string
{
    case Provisioning = 'provisioning';
    case Trialing = 'trialing';
    case Active = 'active';
    case PastDue = 'past_due';
    case Suspended = 'suspended';
    case Cancelled = 'cancelled';
}
