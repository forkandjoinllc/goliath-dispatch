<?php

namespace App\Enums;

enum ExpenseTreatment: string
{
    /** Removed from the commissionable base before the dispatch fee is applied. */
    case ExcludedFromCommission = 'excluded_from_commission';
    /** Added back to the carrier's settlement. */
    case ReimbursableToCarrier = 'reimbursable_to_carrier';
    /** Absorbed by the dispatch company; reduces gross margin. */
    case TenantAbsorbed = 'tenant_absorbed';
    /** Deducted from the carrier's settlement. */
    case CarrierDeduction = 'carrier_deduction';
}
