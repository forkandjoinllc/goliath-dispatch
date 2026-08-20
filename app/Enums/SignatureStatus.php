<?php

namespace App\Enums;

enum SignatureStatus: string
{
    case Pending = 'pending';
    case Viewed = 'viewed';
    case Signed = 'signed';
    case Declined = 'declined';
    case Expired = 'expired';
    case Voided = 'voided';
    case Superseded = 'superseded';
}
