<?php

namespace App\Enums;

enum ConsentType: string
{
    case PrivacyPolicy = 'privacy_policy';
    case TermsAndConditions = 'terms_and_conditions';
    case ElectronicSignature = 'electronic_signature';
    case Sms = 'sms';
    case TrackingLocation = 'tracking_location';
}
