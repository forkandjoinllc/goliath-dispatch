import 'server-only'
import {
  auditEvents,
  carrierOnboardings,
  carrierSettlements,
  carriers,
  consentRecords,
  conversations,
  customers,
  dispatcherCommissions,
  documentVersions,
  documents,
  drivers,
  equipmentMedia,
  escorts,
  expenses,
  exportJobs,
  factoringAssignments,
  financialSnapshots,
  invoices,
  leads,
  loads,
  messageAttachments,
  messages,
  notifications,
  payments,
  permits,
  quoteRequests,
  rateConfirmationAcceptances,
  signatureAuditEvents,
  signatureRecords,
  signatureRequests,
  signatureTemplates,
  trackingEvents,
  trackingSessions,
  trailers,
  trucks,
} from '@/db/schema'
import type { PgTable } from 'drizzle-orm/pg-core'

/**
 * The retention rulebook, as data.
 *
 * `docs/architecture.md` §9:
 *  - Operational records: 24 months active, then archived, purgeable 5 years
 *    after archival.
 *  - Financial records (invoices, payments, settlements, financial
 *    snapshots, signature records and certificates, consent records, audit
 *    events): retained at least 7 years and never purged early, regardless
 *    of the operational window.
 *
 * `classifyEntity()` is the one function the retention job handler (under
 * `src/jobs/**`, owned by another agent) and this module's own UI must both
 * call — a table's classification cannot drift between "what the job purges"
 * and "what the admin screen displays" because both read this map.
 */

export type RetentionClassification = 'operational' | 'financial'

/**
 * How a purge-eligible row is actually made to disappear.
 *
 *  - `'delete'` (the default) — a real `DELETE`, via `TenantDb.purge()`.
 *  - `'anonymize'` — the row is soft-deleted (`deletedAt` set, which is what
 *    every ordinary tenant-scoped query already filters out) and its
 *    free-text, potentially-identifying columns are redacted, but the row
 *    itself is kept. This is the answer for `loads`: `load_status_history`
 *    and `financial_snapshots` are append-only children `drizzle/custom/
 *    0001_audit_immutability.sql` structurally forbids ever deleting — by
 *    design, so a bug or a compromised application role cannot rewrite a
 *    settled load's history — and both cascade-reference `loads.id`, so a
 *    real `DELETE FROM loads` can never succeed for any load that has gone
 *    through a status transition. Rather than weaken that guarantee (adding
 *    a delete bypass to an audit-immutability trigger is exactly the kind
 *    of "trust the application" hole the trigger exists to remove), a load
 *    past its purge-eligible date is anonymized instead: it drops out of
 *    every operational view via the ordinary soft-delete predicate, while
 *    its immutable status history and financial snapshots remain — which is
 *    also the financially-honest choice, since `financial_snapshots` is
 *    independently classified `'financial'` below (never purged before 7
 *    years) and a load's own math should not disappear out from under a
 *    settlement or invoice that still references it.
 *
 * `signature_records` (and `signature_audit_events`) are deliberately
 * *not* given an anonymize strategy: they are executed legal instruments
 * with a hash chain and integrity seal whose evidentiary value must never
 * expire, so `signature_records_guard` forbids their deletion unconditionally
 * and no purge path — delete or anonymize — is implemented for them here.
 * See `docs/architecture.md` §9 for the retention rule this codifies.
 */
export type PurgeStrategy = 'delete' | 'anonymize'

export interface EntityRetentionInfo {
  /** The schema table this entity type is stored in. */
  table: PgTable
  classification: RetentionClassification
  /** Whether the table carries the `legal_hold` boolean column (`...retention` spread). */
  hasLegalHoldColumn: boolean
  /** Whether the table participates in soft-delete / archival at all. */
  supportsArchival: boolean
  /** How `retention-purge.ts` disposes of a row once it is purge-eligible. Omitted means `'delete'`. */
  purgeStrategy?: PurgeStrategy
}

const registry: Record<string, EntityRetentionInfo> = {
  // ── Financial: retained >= 7 years, never purged early ──────────────────
  invoices: { table: invoices, classification: 'financial', hasLegalHoldColumn: true, supportsArchival: true },
  payments: { table: payments, classification: 'financial', hasLegalHoldColumn: true, supportsArchival: true },
  carrierSettlements: {
    table: carrierSettlements,
    classification: 'financial',
    hasLegalHoldColumn: true,
    supportsArchival: true,
  },
  // financial_snapshots is append-only (drizzle/custom/0001_audit_immutability.sql
  // rejects UPDATE and DELETE outright) — its `legal_hold` column exists on the
  // table but can never be flipped by an application UPDATE, and it cannot be
  // archived independently; its lifecycle is tied to its parent load's cascade.
  financialSnapshots: {
    table: financialSnapshots,
    classification: 'financial',
    hasLegalHoldColumn: true,
    supportsArchival: false,
  },
  signatureRecords: {
    table: signatureRecords,
    classification: 'financial',
    hasLegalHoldColumn: true,
    supportsArchival: true,
  },
  signatureAuditEvents: {
    table: signatureAuditEvents,
    classification: 'financial',
    hasLegalHoldColumn: true,
    supportsArchival: false,
  },
  consentRecords: {
    table: consentRecords,
    classification: 'financial',
    hasLegalHoldColumn: false,
    supportsArchival: false,
  },
  auditEvents: {
    table: auditEvents,
    classification: 'financial',
    hasLegalHoldColumn: false,
    supportsArchival: false,
  },

  // ── Operational: 24 months active, then archive, purge 5y after ─────────
  customers: { table: customers, classification: 'operational', hasLegalHoldColumn: true, supportsArchival: true },
  carriers: { table: carriers, classification: 'operational', hasLegalHoldColumn: true, supportsArchival: true },
  carrierOnboardings: {
    table: carrierOnboardings,
    classification: 'operational',
    hasLegalHoldColumn: true,
    supportsArchival: true,
  },
  documents: { table: documents, classification: 'operational', hasLegalHoldColumn: true, supportsArchival: true },
  documentVersions: {
    table: documentVersions,
    classification: 'operational',
    hasLegalHoldColumn: true,
    supportsArchival: true,
  },
  drivers: { table: drivers, classification: 'operational', hasLegalHoldColumn: true, supportsArchival: true },
  trucks: { table: trucks, classification: 'operational', hasLegalHoldColumn: true, supportsArchival: true },
  trailers: { table: trailers, classification: 'operational', hasLegalHoldColumn: true, supportsArchival: true },
  equipmentMedia: {
    table: equipmentMedia,
    classification: 'operational',
    hasLegalHoldColumn: true,
    supportsArchival: true,
  },
  // `purgeStrategy: 'anonymize'` — see the `PurgeStrategy` doc comment above
  // for why loads are never hard-deleted.
  loads: {
    table: loads,
    classification: 'operational',
    hasLegalHoldColumn: true,
    supportsArchival: true,
    purgeStrategy: 'anonymize',
  },
  rateConfirmationAcceptances: {
    table: rateConfirmationAcceptances,
    classification: 'operational',
    hasLegalHoldColumn: true,
    supportsArchival: true,
  },
  permits: { table: permits, classification: 'operational', hasLegalHoldColumn: true, supportsArchival: true },
  escorts: { table: escorts, classification: 'operational', hasLegalHoldColumn: true, supportsArchival: true },
  dispatcherCommissions: {
    table: dispatcherCommissions,
    classification: 'operational',
    hasLegalHoldColumn: true,
    supportsArchival: true,
  },
  expenses: { table: expenses, classification: 'operational', hasLegalHoldColumn: true, supportsArchival: true },
  factoringAssignments: {
    table: factoringAssignments,
    classification: 'operational',
    hasLegalHoldColumn: true,
    supportsArchival: true,
  },
  leads: { table: leads, classification: 'operational', hasLegalHoldColumn: true, supportsArchival: true },
  quoteRequests: {
    table: quoteRequests,
    classification: 'operational',
    hasLegalHoldColumn: true,
    supportsArchival: true,
  },
  exportJobs: { table: exportJobs, classification: 'operational', hasLegalHoldColumn: true, supportsArchival: true },
  conversations: {
    table: conversations,
    classification: 'operational',
    hasLegalHoldColumn: true,
    supportsArchival: true,
  },
  messages: { table: messages, classification: 'operational', hasLegalHoldColumn: true, supportsArchival: true },
  messageAttachments: {
    table: messageAttachments,
    classification: 'operational',
    hasLegalHoldColumn: true,
    supportsArchival: true,
  },
  notifications: {
    table: notifications,
    classification: 'operational',
    hasLegalHoldColumn: true,
    supportsArchival: true,
  },
  trackingSessions: {
    table: trackingSessions,
    classification: 'operational',
    hasLegalHoldColumn: true,
    supportsArchival: true,
  },
  trackingEvents: {
    table: trackingEvents,
    classification: 'operational',
    hasLegalHoldColumn: true,
    supportsArchival: true,
  },
  signatureTemplates: {
    table: signatureTemplates,
    classification: 'operational',
    hasLegalHoldColumn: true,
    supportsArchival: true,
  },
  signatureRequests: {
    table: signatureRequests,
    classification: 'operational',
    hasLegalHoldColumn: true,
    supportsArchival: true,
  },
}

export const RETENTION_ENTITY_TYPES = Object.keys(registry)

/** The one function every retention consumer (job handler + this UI) must share. */
export function classifyEntity(entityType: string): EntityRetentionInfo | null {
  return registry[entityType] ?? null
}

export interface RetentionWindow {
  activeMonths: number
  purgeYearsAfterArchive: number
  financialRetentionYears: number
}

export const DEFAULT_RETENTION_WINDOW: RetentionWindow = {
  activeMonths: 24,
  purgeYearsAfterArchive: 5,
  financialRetentionYears: 7,
}

/** The date at which an operational record created on `createdAt` becomes eligible for archival. */
export function archiveEligibleAt(createdAt: Date, window: RetentionWindow = DEFAULT_RETENTION_WINDOW): Date {
  return addMonths(createdAt, window.activeMonths)
}

/** The date at which an archived operational record becomes eligible for permanent purge. */
export function purgeEligibleAt(archivedAt: Date, window: RetentionWindow = DEFAULT_RETENTION_WINDOW): Date {
  return addMonths(archivedAt, window.purgeYearsAfterArchive * 12)
}

/** The earliest a financial-class record may ever be purged, regardless of archival state. */
export function financialPurgeEligibleAt(createdAt: Date, window: RetentionWindow = DEFAULT_RETENTION_WINDOW): Date {
  return addMonths(createdAt, window.financialRetentionYears * 12)
}

export function isPurgeable(
  entityType: string,
  createdAt: Date,
  archivedAt: Date | null,
  now: Date = new Date(),
  window: RetentionWindow = DEFAULT_RETENTION_WINDOW,
): boolean {
  const info = classifyEntity(entityType)
  if (!info) return false

  if (info.classification === 'financial') {
    return now.getTime() >= financialPurgeEligibleAt(createdAt, window).getTime()
  }

  if (!archivedAt) return false
  return now.getTime() >= purgeEligibleAt(archivedAt, window).getTime()
}

function addMonths(date: Date, months: number): Date {
  const result = new Date(date.getTime())
  result.setMonth(result.getMonth() + months)
  return result
}
