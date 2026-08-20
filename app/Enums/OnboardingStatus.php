<?php

namespace App\Enums;

enum OnboardingStatus: string
{
    case Draft = 'draft';
    case Submitted = 'submitted';
    case UnderReview = 'under_review';
    case CorrectionsRequired = 'corrections_required';
    case Approved = 'approved';
    case Rejected = 'rejected';
    case Suspended = 'suspended';
}
