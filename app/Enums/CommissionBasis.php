<?php

namespace App\Enums;

enum CommissionBasis: string
{
    case DispatchFeeAmount = 'dispatch_fee_amount';
    case CarrierGrossRate = 'carrier_gross_rate';
    case CommissionableBase = 'commissionable_base';
}
