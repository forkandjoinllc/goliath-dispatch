import type { LucideIcon } from 'lucide-react'
import {
  AlertTriangle,
  Archive,
  Ban,
  CheckCircle2,
  Clock,
  CreditCard,
  FileClock,
  FileEdit,
  FileSearch,
  FileX2,
  Loader2,
  MapPin,
  MinusCircle,
  Package,
  PackageCheck,
  PackageSearch,
  PauseCircle,
  PlayCircle,
  Receipt,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  ShieldX,
  Truck,
  Undo2,
  Wrench,
  XCircle,
} from 'lucide-react'
import type { BadgeProps } from '@/components/ui/badge'

export type BadgeTone = NonNullable<BadgeProps['tone']>

/**
 * Single source of truth mapping every domain status to a visual tone, an
 * icon and the i18n key that resolves its label. Colour never carries the
 * meaning alone — every tone pairs with a distinct icon and translated text.
 */

export type LoadStatus =
  | 'draft'
  | 'available'
  | 'assigned'
  | 'dispatched'
  | 'en_route_to_pickup'
  | 'at_pickup'
  | 'in_transit'
  | 'at_delivery'
  | 'delivered'
  | 'pod_received'
  | 'invoiced'
  | 'paid'
  | 'cancelled'

export type OnboardingStatus =
  | 'draft'
  | 'submitted'
  | 'under_review'
  | 'corrections_required'
  | 'approved'
  | 'rejected'
  | 'suspended'

export type DocumentReviewStatus = 'pending' | 'in_review' | 'approved' | 'rejected' | 'expired' | 'superseded'

export type VerificationStatus =
  | 'not_started'
  | 'pending'
  | 'verified'
  | 'mismatch'
  | 'failed'
  | 'manually_overridden'
  | 'expired'

export type InvoiceStatus = 'draft' | 'sent' | 'due' | 'paid' | 'overdue' | 'disputed' | 'voided' | 'uncollectable'

export type PaymentStatus =
  | 'pending'
  | 'processing'
  | 'succeeded'
  | 'failed'
  | 'refunded'
  | 'partially_refunded'
  | 'disputed'
  | 'cancelled'

export type EquipmentStatus = 'pending_verification' | 'active' | 'out_of_service' | 'archived'

export type DriverStatus = 'available' | 'on_load' | 'off_duty' | 'inactive'

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'dead_letter' | 'cancelled'

export interface StatusValueMap {
  load: LoadStatus
  onboarding: OnboardingStatus
  documentReview: DocumentReviewStatus
  verification: VerificationStatus
  invoice: InvoiceStatus
  payment: PaymentStatus
  equipment: EquipmentStatus
  driver: DriverStatus
  job: JobStatus
}

export type StatusKind = keyof StatusValueMap

export interface StatusConfigEntry {
  tone: BadgeTone
  icon: LucideIcon
  /** Dotted i18n key. Document review reuses the existing `document.reviewStatus.*` keys. */
  i18nKey: string
}

type StatusRegistry = { [K in StatusKind]: Record<StatusValueMap[K], StatusConfigEntry> }

export const STATUS_REGISTRY: StatusRegistry = {
  load: {
    draft: { tone: 'neutral', icon: FileEdit, i18nKey: 'nav.status.load.draft' },
    available: { tone: 'info', icon: PackageSearch, i18nKey: 'nav.status.load.available' },
    assigned: { tone: 'navy', icon: Truck, i18nKey: 'nav.status.load.assigned' },
    dispatched: { tone: 'navy', icon: PlayCircle, i18nKey: 'nav.status.load.dispatched' },
    en_route_to_pickup: { tone: 'navy', icon: Truck, i18nKey: 'nav.status.load.enRouteToPickup' },
    at_pickup: { tone: 'warning', icon: MapPin, i18nKey: 'nav.status.load.atPickup' },
    in_transit: { tone: 'navy', icon: Truck, i18nKey: 'nav.status.load.inTransit' },
    at_delivery: { tone: 'warning', icon: MapPin, i18nKey: 'nav.status.load.atDelivery' },
    delivered: { tone: 'success', icon: PackageCheck, i18nKey: 'nav.status.load.delivered' },
    pod_received: { tone: 'success', icon: CheckCircle2, i18nKey: 'nav.status.load.podReceived' },
    invoiced: { tone: 'info', icon: Receipt, i18nKey: 'nav.status.load.invoiced' },
    paid: { tone: 'success', icon: CreditCard, i18nKey: 'nav.status.load.paid' },
    cancelled: { tone: 'danger', icon: Ban, i18nKey: 'nav.status.load.cancelled' },
  },
  onboarding: {
    draft: { tone: 'neutral', icon: FileEdit, i18nKey: 'nav.status.onboarding.draft' },
    submitted: { tone: 'info', icon: FileSearch, i18nKey: 'nav.status.onboarding.submitted' },
    under_review: { tone: 'warning', icon: FileClock, i18nKey: 'nav.status.onboarding.underReview' },
    corrections_required: {
      tone: 'danger',
      icon: AlertTriangle,
      i18nKey: 'nav.status.onboarding.correctionsRequired',
    },
    approved: { tone: 'success', icon: CheckCircle2, i18nKey: 'nav.status.onboarding.approved' },
    rejected: { tone: 'danger', icon: XCircle, i18nKey: 'nav.status.onboarding.rejected' },
    suspended: { tone: 'danger', icon: PauseCircle, i18nKey: 'nav.status.onboarding.suspended' },
  },
  documentReview: {
    pending: { tone: 'neutral', icon: Clock, i18nKey: 'document.reviewStatus.pending' },
    in_review: { tone: 'warning', icon: FileSearch, i18nKey: 'document.reviewStatus.in_review' },
    approved: { tone: 'success', icon: CheckCircle2, i18nKey: 'document.reviewStatus.approved' },
    rejected: { tone: 'danger', icon: FileX2, i18nKey: 'document.reviewStatus.rejected' },
    expired: { tone: 'danger', icon: AlertTriangle, i18nKey: 'document.reviewStatus.expired' },
    superseded: { tone: 'neutral', icon: RefreshCw, i18nKey: 'document.reviewStatus.superseded' },
  },
  verification: {
    not_started: { tone: 'neutral', icon: MinusCircle, i18nKey: 'nav.status.verification.notStarted' },
    pending: { tone: 'warning', icon: Clock, i18nKey: 'nav.status.verification.pending' },
    verified: { tone: 'success', icon: ShieldCheck, i18nKey: 'nav.status.verification.verified' },
    mismatch: { tone: 'danger', icon: ShieldAlert, i18nKey: 'nav.status.verification.mismatch' },
    failed: { tone: 'danger', icon: ShieldX, i18nKey: 'nav.status.verification.failed' },
    manually_overridden: {
      tone: 'warning',
      icon: ShieldQuestion,
      i18nKey: 'nav.status.verification.manuallyOverridden',
    },
    expired: { tone: 'danger', icon: AlertTriangle, i18nKey: 'nav.status.verification.expired' },
  },
  invoice: {
    draft: { tone: 'neutral', icon: FileEdit, i18nKey: 'nav.status.invoice.draft' },
    sent: { tone: 'info', icon: Receipt, i18nKey: 'nav.status.invoice.sent' },
    due: { tone: 'warning', icon: Clock, i18nKey: 'nav.status.invoice.due' },
    paid: { tone: 'success', icon: CheckCircle2, i18nKey: 'nav.status.invoice.paid' },
    overdue: { tone: 'danger', icon: AlertTriangle, i18nKey: 'nav.status.invoice.overdue' },
    disputed: { tone: 'danger', icon: ShieldAlert, i18nKey: 'nav.status.invoice.disputed' },
    voided: { tone: 'neutral', icon: Ban, i18nKey: 'nav.status.invoice.voided' },
    uncollectable: { tone: 'danger', icon: XCircle, i18nKey: 'nav.status.invoice.uncollectable' },
  },
  payment: {
    pending: { tone: 'neutral', icon: Clock, i18nKey: 'nav.status.payment.pending' },
    processing: { tone: 'info', icon: Loader2, i18nKey: 'nav.status.payment.processing' },
    succeeded: { tone: 'success', icon: CheckCircle2, i18nKey: 'nav.status.payment.succeeded' },
    failed: { tone: 'danger', icon: XCircle, i18nKey: 'nav.status.payment.failed' },
    refunded: { tone: 'neutral', icon: Undo2, i18nKey: 'nav.status.payment.refunded' },
    partially_refunded: { tone: 'warning', icon: Undo2, i18nKey: 'nav.status.payment.partiallyRefunded' },
    disputed: { tone: 'danger', icon: ShieldAlert, i18nKey: 'nav.status.payment.disputed' },
    cancelled: { tone: 'neutral', icon: Ban, i18nKey: 'nav.status.payment.cancelled' },
  },
  equipment: {
    pending_verification: {
      tone: 'warning',
      icon: FileSearch,
      i18nKey: 'nav.status.equipment.pendingVerification',
    },
    active: { tone: 'success', icon: CheckCircle2, i18nKey: 'nav.status.equipment.active' },
    out_of_service: { tone: 'danger', icon: Wrench, i18nKey: 'nav.status.equipment.outOfService' },
    archived: { tone: 'neutral', icon: Archive, i18nKey: 'nav.status.equipment.archived' },
  },
  driver: {
    available: { tone: 'success', icon: CheckCircle2, i18nKey: 'nav.status.driver.available' },
    on_load: { tone: 'navy', icon: Truck, i18nKey: 'nav.status.driver.onLoad' },
    off_duty: { tone: 'neutral', icon: PauseCircle, i18nKey: 'nav.status.driver.offDuty' },
    inactive: { tone: 'danger', icon: MinusCircle, i18nKey: 'nav.status.driver.inactive' },
  },
  job: {
    queued: { tone: 'neutral', icon: Clock, i18nKey: 'nav.status.job.queued' },
    running: { tone: 'info', icon: Loader2, i18nKey: 'nav.status.job.running' },
    succeeded: { tone: 'success', icon: CheckCircle2, i18nKey: 'nav.status.job.succeeded' },
    failed: { tone: 'danger', icon: XCircle, i18nKey: 'nav.status.job.failed' },
    dead_letter: { tone: 'danger', icon: Package, i18nKey: 'nav.status.job.deadLetter' },
    cancelled: { tone: 'neutral', icon: Ban, i18nKey: 'nav.status.job.cancelled' },
  },
}

export function getStatusConfig<K extends StatusKind>(kind: K, value: StatusValueMap[K]): StatusConfigEntry {
  return STATUS_REGISTRY[kind][value]
}
