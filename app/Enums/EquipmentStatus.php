<?php

namespace App\Enums;

enum EquipmentStatus: string
{
    case PendingVerification = 'pending_verification';
    case Active = 'active';
    case OutOfService = 'out_of_service';
    case Archived = 'archived';
}
