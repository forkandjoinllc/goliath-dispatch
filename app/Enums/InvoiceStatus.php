<?php

namespace App\Enums;

enum InvoiceStatus: string
{
    case Draft = 'draft';
    case Sent = 'sent';
    case Due = 'due';
    case Paid = 'paid';
    case Overdue = 'overdue';
    case Disputed = 'disputed';
    case Voided = 'voided';
    case Uncollectable = 'uncollectable';
}
