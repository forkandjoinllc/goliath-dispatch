<?php

namespace App\Enums;

enum DocumentType: string
{
    // Carrier onboarding
    case CertificateOfAuthority = 'certificate_of_authority';
    case CertificateOfInsurance = 'certificate_of_insurance';
    case W9 = 'w9';
    case NoticeOfAssignment = 'notice_of_assignment';
    case ChangeOfPayee = 'change_of_payee';
    case CarrierAgreement = 'carrier_agreement';
    case OtherOnboarding = 'other_onboarding';

    // Equipment
    case TruckRegistration = 'truck_registration';
    case TrailerRegistration = 'trailer_registration';
    case AnnualInspection = 'annual_inspection';
    case EquipmentPhoto = 'equipment_photo';
    case EquipmentVideo = 'equipment_video';

    // Driver
    case CdlFront = 'cdl_front';
    case CdlBack = 'cdl_back';
    case MedicalCard = 'medical_card';
    case DriverOther = 'driver_other';

    // Load
    case Bol = 'bol';
    case Pod = 'pod';
    case RateConfirmation = 'rate_confirmation';
    case Permit = 'permit';
    case EscortDocument = 'escort_document';
    case RouteSurvey = 'route_survey';
    case Receipt = 'receipt';
    case Invoice = 'invoice';
    case LumperReceipt = 'lumper_receipt';
    case ScaleTicket = 'scale_ticket';
    case Other = 'other';
}
