<?php

namespace App\Enums;

enum AuditAction: string
{
    case AuthLogin = 'auth.login';
    case AuthLoginFailed = 'auth.login_failed';
    case AuthLogout = 'auth.logout';
    case AuthPasswordResetRequested = 'auth.password_reset_requested';
    case AuthPasswordResetCompleted = 'auth.password_reset_completed';
    case AuthEmailVerified = 'auth.email_verified';
    case AuthMfaEnrolled = 'auth.mfa_enrolled';
    case AuthMfaChallengeFailed = 'auth.mfa_challenge_failed';
    case AuthSessionRevoked = 'auth.session_revoked';
    case AuthAccountLocked = 'auth.account_locked';
    case ImpersonationStarted = 'impersonation.started';
    case ImpersonationEnded = 'impersonation.ended';
    case PermissionChanged = 'permission.changed';
    case RoleChanged = 'role.changed';
    case TenantCreated = 'tenant.created';
    case TenantUpdated = 'tenant.updated';
    case TenantSuspended = 'tenant.suspended';
    case TenantReactivated = 'tenant.reactivated';
    case TenantAccessed = 'tenant.accessed';
    case DocumentViewed = 'document.viewed';
    case DocumentDownloaded = 'document.downloaded';
    case DocumentUploaded = 'document.uploaded';
    case DocumentApproved = 'document.approved';
    case DocumentRejected = 'document.rejected';
    case DocumentDeleted = 'document.deleted';
    case VerificationOverride = 'verification.override';

    /** Alguien confirmó que el VIN de la unidad está en la póliza. */
    case EquipmentVerified = 'equipment.verified';
    /** Revisión de la licencia de un conductor. Añadido, no portado — ver la migración. */
    case DriverVerified = 'driver.verified';
    case OnboardingStatusChanged = 'onboarding.status_changed';
    case LoadCreated = 'load.created';
    case LoadStatusChanged = 'load.status_changed';
    case LoadAssignmentChanged = 'load.assignment_changed';
    case LoadCancelled = 'load.cancelled';
    case LoadDuplicated = 'load.duplicated';
    case FinancialChanged = 'financial.changed';
    case ExpenseApproved = 'expense.approved';
    case ExpenseRejected = 'expense.rejected';
    case InvoiceCreated = 'invoice.created';
    case InvoiceSent = 'invoice.sent';
    case InvoiceStatusChanged = 'invoice.status_changed';
    case PaymentRecorded = 'payment.recorded';
    case PaymentFailed = 'payment.failed';
    case PaymentRefunded = 'payment.refunded';
    case SignatureRequested = 'signature.requested';
    case SignatureViewed = 'signature.viewed';
    case SignatureSigned = 'signature.signed';
    case SignatureDeclined = 'signature.declined';
    case SignatureVoided = 'signature.voided';
    case MessageParticipantAdded = 'message.participant_added';
    case MessageParticipantRemoved = 'message.participant_removed';
    case ExportCreated = 'export.created';
    case ExportDownloaded = 'export.downloaded';
    case RetentionArchived = 'retention.archived';
    case RetentionPurged = 'retention.purged';
    case LegalHoldApplied = 'legal_hold.applied';
    case LegalHoldReleased = 'legal_hold.released';
    case SettingsUpdated = 'settings.updated';
    case IntegrationUpdated = 'integration.updated';
    case TrackingConsentChanged = 'tracking.consent_changed';
    case SecurityRateLimited = 'security.rate_limited';

    /**
     * Trabajo comercial sobre un prospecto. Añadidos, no portados — ver la
     * migración que amplía el vocabulario.
     */
    case LeadStatusChanged = 'lead.status_changed';
    case LeadAssigned = 'lead.assigned';
}
