import { sql } from 'drizzle-orm'
import { bigint, boolean, jsonb, pgEnum, text, timestamp, uuid } from 'drizzle-orm/pg-core'

/* ────────────────────────────────────────────────────────────────────────────
 * Column helpers
 * Every tenant-owned table MUST spread `tenantScoped` so tenant isolation is
 * structurally guaranteed at the schema level, and `auditable` so retention
 * and soft-deletion behave uniformly.
 * ──────────────────────────────────────────────────────────────────────────── */

export const primaryId = () => uuid('id').primaryKey().defaultRandom()

export const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}

export const softDelete = {
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  deletedBy: uuid('deleted_by'),
  deletionReason: text('deletion_reason'),
}

export const retention = {
  /** Set when the record moves out of the active operational window. */
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  /** Earliest moment the record may be permanently destroyed. */
  purgeEligibleAt: timestamp('purge_eligible_at', { withTimezone: true }),
  /** True while any LegalHold covers this record; blocks archival + purge. */
  legalHold: boolean('legal_hold').notNull().default(false),
}

export const auditable = { ...timestamps, ...softDelete }

/** Money is ALWAYS integer cents. Never a float, never a numeric string in app logic. */
export const cents = (name: string) => bigint(name, { mode: 'number' })

export const metadata = () => jsonb('metadata').$type<Record<string, unknown>>()

/* ────────────────────────────────────────────────────────────────────────────
 * Enums
 * ──────────────────────────────────────────────────────────────────────────── */

export const localeEnum = pgEnum('locale', ['en', 'es'])

export const roleEnum = pgEnum('role', [
  'platform_super_admin',
  'admin',
  'accounting',
  'dispatcher',
  'carrier',
  'driver',
])

export const userStatusEnum = pgEnum('user_status', [
  'invited',
  'pending_verification',
  'active',
  'suspended',
  'deactivated',
])

export const tenantStatusEnum = pgEnum('tenant_status', [
  'provisioning',
  'trialing',
  'active',
  'past_due',
  'suspended',
  'cancelled',
])

export const subscriptionStatusEnum = pgEnum('subscription_status', [
  'trialing',
  'active',
  'past_due',
  'suspended',
  'cancelled',
  'incomplete',
])

export const consentTypeEnum = pgEnum('consent_type', [
  'privacy_policy',
  'terms_and_conditions',
  'electronic_signature',
  'sms',
  'tracking_location',
])

export const onboardingStatusEnum = pgEnum('onboarding_status', [
  'draft',
  'submitted',
  'under_review',
  'corrections_required',
  'approved',
  'rejected',
  'suspended',
])

export const documentTypeEnum = pgEnum('document_type', [
  // Carrier onboarding
  'certificate_of_authority',
  'certificate_of_insurance',
  'w9',
  'notice_of_assignment',
  'change_of_payee',
  'carrier_agreement',
  'other_onboarding',
  // Equipment
  'truck_registration',
  'trailer_registration',
  'annual_inspection',
  'equipment_photo',
  'equipment_video',
  // Driver
  'cdl_front',
  'cdl_back',
  'medical_card',
  'driver_other',
  // Load
  'bol',
  'pod',
  'rate_confirmation',
  'permit',
  'escort_document',
  'route_survey',
  'receipt',
  'invoice',
  'lumper_receipt',
  'scale_ticket',
  'other',
])

export const documentReviewStatusEnum = pgEnum('document_review_status', [
  'pending',
  'in_review',
  'approved',
  'rejected',
  'expired',
  'superseded',
])

export const verificationStatusEnum = pgEnum('verification_status', [
  'not_started',
  'pending',
  'verified',
  'mismatch',
  'failed',
  'manually_overridden',
  'expired',
])

export const equipmentStatusEnum = pgEnum('equipment_status', [
  'pending_verification',
  'active',
  'out_of_service',
  'archived',
])

export const driverStatusEnum = pgEnum('driver_status', [
  'available',
  'on_load',
  'off_duty',
  'inactive',
])

export const loadStatusEnum = pgEnum('load_status', [
  'draft',
  'available',
  'assigned',
  'dispatched',
  'en_route_to_pickup',
  'at_pickup',
  'in_transit',
  'at_delivery',
  'delivered',
  'pod_received',
  'invoiced',
  'paid',
  'cancelled',
])

export const stopTypeEnum = pgEnum('stop_type', ['pickup', 'delivery'])

export const appointmentTypeEnum = pgEnum('appointment_type', ['exact', 'window', 'fcfs', 'open'])

export const invoiceStatusEnum = pgEnum('invoice_status', [
  'draft',
  'sent',
  'due',
  'paid',
  'overdue',
  'disputed',
  'voided',
  'uncollectable',
])

export const paymentMethodEnum = pgEnum('payment_method', [
  'card',
  'ach',
  'check',
  'wire',
  'cash',
  'offset',
  'other',
])

export const paymentStatusEnum = pgEnum('payment_status', [
  'pending',
  'processing',
  'succeeded',
  'failed',
  'refunded',
  'partially_refunded',
  'disputed',
  'cancelled',
])

export const expenseStatusEnum = pgEnum('expense_status', [
  'submitted',
  'approved',
  'rejected',
  'reimbursed',
])

export const expenseTreatmentEnum = pgEnum('expense_treatment', [
  /** Removed from the commissionable base before the dispatch fee is applied. */
  'excluded_from_commission',
  /** Added back to the carrier's settlement. */
  'reimbursable_to_carrier',
  /** Absorbed by the dispatch company; reduces gross margin. */
  'tenant_absorbed',
  /** Deducted from the carrier's settlement. */
  'carrier_deduction',
])

export const commissionBasisEnum = pgEnum('commission_basis', [
  'dispatch_fee_amount',
  'carrier_gross_rate',
  'commissionable_base',
])

export const signatureStatusEnum = pgEnum('signature_status', [
  'pending',
  'viewed',
  'signed',
  'declined',
  'expired',
  'voided',
  'superseded',
])

export const signatureMethodEnum = pgEnum('signature_method', ['drawn', 'typed'])

export const trackingProviderEnum = pgEnum('tracking_provider', [
  'mock',
  'trucker_tools',
  'macropoint',
  'highway',
  'manual',
])

export const trackingEventTypeEnum = pgEnum('tracking_event_type', [
  'session_started',
  'consent_granted',
  'consent_revoked',
  'location_update',
  'geofence_enter',
  'geofence_exit',
  'arrived_pickup',
  'departed_pickup',
  'arrived_delivery',
  'departed_delivery',
  'stopped',
  'session_ended',
  'error',
])

export const notificationChannelEnum = pgEnum('notification_channel', ['in_app', 'email', 'sms'])

export const notificationStatusEnum = pgEnum('notification_status', [
  'queued',
  'sent',
  'delivered',
  'failed',
  'read',
  'suppressed',
])

export const jobStatusEnum = pgEnum('job_status', [
  'queued',
  'running',
  'succeeded',
  'failed',
  'dead_letter',
  'cancelled',
])

export const auditActionEnum = pgEnum('audit_action', [
  'auth.login',
  'auth.login_failed',
  'auth.logout',
  'auth.password_reset_requested',
  'auth.password_reset_completed',
  'auth.email_verified',
  'auth.mfa_enrolled',
  'auth.mfa_challenge_failed',
  'auth.session_revoked',
  'auth.account_locked',
  'impersonation.started',
  'impersonation.ended',
  'permission.changed',
  'role.changed',
  'tenant.created',
  'tenant.updated',
  'tenant.suspended',
  'tenant.reactivated',
  'tenant.accessed',
  'document.viewed',
  'document.downloaded',
  'document.uploaded',
  'document.approved',
  'document.rejected',
  'document.deleted',
  'verification.override',
  'onboarding.status_changed',
  'load.created',
  'load.status_changed',
  'load.assignment_changed',
  'load.cancelled',
  'load.duplicated',
  'financial.changed',
  'expense.approved',
  'expense.rejected',
  'invoice.created',
  'invoice.sent',
  'invoice.status_changed',
  'payment.recorded',
  'payment.failed',
  'payment.refunded',
  'signature.requested',
  'signature.viewed',
  'signature.signed',
  'signature.declined',
  'signature.voided',
  'export.created',
  'export.downloaded',
  'retention.archived',
  'retention.purged',
  'legal_hold.applied',
  'legal_hold.released',
  'settings.updated',
  'integration.updated',
  'tracking.consent_changed',
  'security.rate_limited',
])

export const stateCodeEnum = pgEnum('us_state', [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME',
  'MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA',
  'RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC','PR',
])

/* ────────────────────────────────────────────────────────────────────────────
 * Reusable shapes
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Column names are written out explicitly on each table rather than generated
 * from a prefix helper: Drizzle infers its row types from literal object keys,
 * and computed keys would erase that inference. The cost is verbosity; the
 * benefit is that every column is statically typed end to end.
 */

export const nowSql = sql`now()`
