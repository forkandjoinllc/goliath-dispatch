import 'server-only'
import { and, asc, eq, gte, lte } from 'drizzle-orm'
import type { TenantDb } from '@/db/tenant-db'
import {
  carrierSettlementLines,
  carrierSettlements,
  carriers,
  financialSnapshots,
  loads,
  type Carrier,
  type CarrierSettlement,
  type FinancialSnapshot,
} from '@/db/schema'
import { sum } from '@/lib/money'
import { conflict, notFound, validationFailed } from '@/lib/errors'
import type { Actor } from '@/lib/permissions'
import type { Locale } from '@/i18n/config'
import type { TranslateFn } from '@/i18n/translate'
import { renderSettlementPdf } from '@/lib/pdf/settlement-pdf'
import { uploadDocument } from '@/server/documents/service'
import { nextSettlementNumber } from './numbering'

export type CarrierSettlementLine = typeof carrierSettlementLines.$inferSelect
export type SettlementStatus = 'draft' | 'issued' | 'paid' | 'voided'

/**
 * Carrier settlements — the statement of what a carrier is owed for a batch
 * of loads over a period, distinct from `invoices` (which is Goliath
 * Dispatch invoicing the CARRIER for its own dispatch fee). A settlement
 * line always links back to the `financial_snapshots` row it was built
 * from, so the statement can be reproduced exactly even if fee percentages
 * change afterward.
 */

/* ── Generation ───────────────────────────────────────────────────────────── */

export interface GenerateSettlementInput {
  carrierId: string
  periodStart: Date
  periodEnd: Date
  notes?: string | null
  factoringCompanyId?: string | null
}

export interface GenerateSettlementResult {
  settlement: CarrierSettlement
  lines: CarrierSettlementLine[]
}

/**
 * Builds a settlement from every load belonging to the carrier whose latest
 * financial snapshot was computed inside `[periodStart, periodEnd]`. A load
 * already covered by an earlier settlement line (of any status) is never
 * included twice.
 */
export async function generateSettlementForPeriod(
  db: TenantDb,
  input: GenerateSettlementInput,
): Promise<GenerateSettlementResult> {
  if (input.periodEnd.getTime() <= input.periodStart.getTime()) {
    throw validationFailed('finance.validation.endAfterStart')
  }

  return db.transaction(async (tx) => {
    await tx.requireById(carriers, input.carrierId, 'carrier')

    const candidateSnapshots = await tx.findMany(financialSnapshots, {
      where: and(gte(financialSnapshots.computedAt, input.periodStart), lte(financialSnapshots.computedAt, input.periodEnd)),
    })

    const carrierLoadIds = new Set(
      (
        await tx.findMany(loads, { where: eq(loads.carrierId, input.carrierId) })
      ).map((load) => load.id),
    )

    // Latest-in-period snapshot per load.
    const latestPerLoad = new Map<string, FinancialSnapshot>()
    for (const snapshot of candidateSnapshots) {
      if (!carrierLoadIds.has(snapshot.loadId)) continue
      const current = latestPerLoad.get(snapshot.loadId)
      if (!current || snapshot.version > current.version) latestPerLoad.set(snapshot.loadId, snapshot)
    }

    const alreadySettledLoadIds = new Set(
      (await tx.findMany(carrierSettlementLines, {})).map((line) => line.loadId).filter((id): id is string => Boolean(id)),
    )

    const eligible = [...latestPerLoad.values()].filter((snapshot) => !alreadySettledLoadIds.has(snapshot.loadId))
    if (eligible.length === 0) {
      throw validationFailed('finance.validation.noLoadsInPeriod')
    }

    const loadsById = new Map((await tx.findMany(loads, {})).map((load) => [load.id, load]))

    const settlementNumber = await nextSettlementNumber(tx)

    const totals = {
      grossRateCents: sum(...eligible.map((s) => s.carrierGrossRateCents)),
      reimbursementsCents: sum(...eligible.map((s) => s.approvedReimbursableExpensesCents)),
      dispatchFeesCents: sum(...eligible.map((s) => s.dispatchFeeAmountCents)),
      deductionsCents: sum(...eligible.map((s) => s.carrierDeductionsCents)),
      netAmountCents: sum(...eligible.map((s) => s.netCarrierSettlementCents)),
    }

    const settlement = await tx.insert(carrierSettlements, {
      carrierId: input.carrierId,
      settlementNumber,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      grossRateCents: totals.grossRateCents,
      reimbursementsCents: totals.reimbursementsCents,
      dispatchFeesCents: totals.dispatchFeesCents,
      deductionsCents: totals.deductionsCents,
      netAmountCents: totals.netAmountCents,
      status: 'draft',
      factoringCompanyId: input.factoringCompanyId ?? null,
      notes: input.notes ?? null,
    })

    const lines = await tx.insertMany(
      carrierSettlementLines,
      eligible.map((snapshot) => {
        const load = loadsById.get(snapshot.loadId)
        return {
          settlementId: settlement.id,
          loadId: snapshot.loadId,
          financialSnapshotId: snapshot.id,
          descriptionEn: `Load ${load?.loadNumber ?? snapshot.loadId}`,
          descriptionEs: `Carga ${load?.loadNumber ?? snapshot.loadId}`,
          grossRateCents: snapshot.carrierGrossRateCents,
          reimbursementsCents: snapshot.approvedReimbursableExpensesCents,
          dispatchFeeCents: snapshot.dispatchFeeAmountCents,
          deductionsCents: snapshot.carrierDeductionsCents,
          netCents: snapshot.netCarrierSettlementCents,
        }
      }),
    )

    return { settlement, lines }
  })
}

/* ── Lifecycle ────────────────────────────────────────────────────────────── */

const SETTLEMENT_TRANSITIONS: Record<SettlementStatus, SettlementStatus[]> = {
  draft: ['issued', 'voided'],
  issued: ['paid', 'voided'],
  paid: [],
  voided: [],
}

export function canTransitionSettlement(from: string, to: SettlementStatus): boolean {
  return (SETTLEMENT_TRANSITIONS[from as SettlementStatus] ?? []).includes(to)
}

export interface IssueSettlementBrandContext {
  tenantName: string
  tenantAddressLines: string[]
  timezone: string
  logoPngBytes?: Uint8Array | null
}

/** Renders and stores the settlement PDF, then moves the settlement to `issued`. */
export async function issueSettlement(
  db: TenantDb,
  actor: Actor,
  settlementId: string,
  brand: IssueSettlementBrandContext,
  locale: Locale,
  t: TranslateFn,
): Promise<CarrierSettlement> {
  return db.transaction(async (tx) => {
    const settlement = await tx.requireById(carrierSettlements, settlementId, 'settlement')
    if (!canTransitionSettlement(settlement.status, 'issued')) {
      throw conflict('finance.errors.invalidSettlementTransition', { from: settlement.status, to: 'issued' })
    }

    const carrier = await tx.requireById(carriers, settlement.carrierId, 'carrier')
    const lines = await tx.findMany(carrierSettlementLines, {
      where: eq(carrierSettlementLines.settlementId, settlement.id),
      orderBy: asc(carrierSettlementLines.createdAt),
    })

    const issuedAt = new Date()
    const pdfBytes = await renderSettlementPdf(
      {
        tenantName: brand.tenantName,
        tenantAddressLines: brand.tenantAddressLines,
        logoPngBytes: brand.logoPngBytes,
        timezone: brand.timezone,
        settlementNumber: settlement.settlementNumber,
        carrierName: carrier.legalName,
        carrierDotNumber: carrier.dotNumber,
        periodStart: settlement.periodStart,
        periodEnd: settlement.periodEnd,
        issuedAt,
        lines: lines.map((line) => ({
          loadNumber: (locale === 'es' ? line.descriptionEs : line.descriptionEn) ?? line.descriptionEn,
          description: '',
          grossRateCents: line.grossRateCents,
          reimbursementsCents: line.reimbursementsCents,
          dispatchFeeCents: line.dispatchFeeCents,
          deductionsCents: line.deductionsCents,
          netCents: line.netCents,
        })),
        totals: {
          grossRateCents: settlement.grossRateCents,
          reimbursementsCents: settlement.reimbursementsCents,
          dispatchFeesCents: settlement.dispatchFeesCents,
          deductionsCents: settlement.deductionsCents,
          netAmountCents: settlement.netAmountCents,
        },
        notes: settlement.notes,
      },
      locale,
      t,
    )

    const { document } = await uploadDocument(tx, actor, {
      ownerType: 'carrier',
      ownerId: settlement.carrierId,
      documentType: 'other',
      originalFilename: `${settlement.settlementNumber}.pdf`,
      bytes: Buffer.from(pdfBytes),
    })

    const updated = await tx.update(carrierSettlements, settlement.id, {
      status: 'issued',
      issuedAt,
      pdfDocumentId: document.id,
    })
    if (!updated) throw notFound('finance.errors.settlementNotFound')
    return updated
  })
}

export async function markSettlementPaid(db: TenantDb, settlementId: string): Promise<CarrierSettlement> {
  return db.transaction(async (tx) => {
    const settlement = await tx.requireById(carrierSettlements, settlementId, 'settlement')
    if (!canTransitionSettlement(settlement.status, 'paid')) {
      throw conflict('finance.errors.invalidSettlementTransition', { from: settlement.status, to: 'paid' })
    }
    const updated = await tx.update(carrierSettlements, settlement.id, { status: 'paid', paidAt: new Date() })
    if (!updated) throw notFound('finance.errors.settlementNotFound')
    return updated
  })
}

export async function voidSettlement(db: TenantDb, settlementId: string, reason: string): Promise<CarrierSettlement> {
  if (!reason?.trim()) throw validationFailed('finance.validation.reasonRequired')
  return db.transaction(async (tx) => {
    const settlement = await tx.requireById(carrierSettlements, settlementId, 'settlement')
    if (!canTransitionSettlement(settlement.status, 'voided')) {
      throw conflict('finance.errors.invalidSettlementTransition', { from: settlement.status, to: 'voided' })
    }
    const updated = await tx.update(carrierSettlements, settlement.id, { status: 'voided', notes: appendNote(settlement.notes, reason) })
    if (!updated) throw notFound('finance.errors.settlementNotFound')
    return updated
  })
}

/** Manual factoring record: notes when a settlement's proceeds were submitted to the factor. Never implies an API call. */
export async function recordFactoringSubmission(
  db: TenantDb,
  settlementId: string,
  factoringCompanyId: string,
): Promise<CarrierSettlement> {
  return db.transaction(async (tx) => {
    const settlement = await tx.requireById(carrierSettlements, settlementId, 'settlement')
    const updated = await tx.update(carrierSettlements, settlement.id, {
      factoringCompanyId,
      factoringSubmittedAt: new Date(),
    })
    if (!updated) throw notFound('finance.errors.settlementNotFound')
    return updated
  })
}

function appendNote(existing: string | null, addition: string): string {
  return existing ? `${existing}\n${addition}` : addition
}

export type { Carrier }
