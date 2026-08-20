<?php

namespace App\Enums;

enum VerificationStatus: string
{
    case NotStarted = 'not_started';
    case Pending = 'pending';
    case Verified = 'verified';
    case Mismatch = 'mismatch';
    case Failed = 'failed';
    case ManuallyOverridden = 'manually_overridden';
    case Expired = 'expired';
}
