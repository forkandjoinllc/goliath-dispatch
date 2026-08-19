import 'server-only'
import { and, isNull, lte } from 'drizzle-orm'
import type { TenantDb } from '@/db/tenant-db'
import { carriers, fmcsaVerifications, tenantSettings, type Carrier, type FmcsaVerification } from '@/db/schema'
import { AppError, notFound } from '@/lib/errors'
import { sha256Hex } from '@/lib/crypto'
import {
  compareEnteredToReported,
  getFmcsaProvider,
  type FmcsaCarrierSnapshot,
  type FmcsaMismatch,
} from '@/integrations/fmcsa'
import type { ComplianceReason } from '@/server/compliance/types'

/**
 * FMCSA verification.
 *
 * `runVerification` is the only place a carrier's `fmcsaStatus` and
 * reverification schedule change outside a manual override. It never returns
 * a bare boolean — the caller (an onboarding-approval check, a dispatch gate,
 * a UI banner) needs the actual reasons to render in either language.
 */

const DEFAULT_REVERIFICATION_DAYS = 7

async function reverificationDaysFor(db: TenantDb): Promise<number> {
  const settings = await db.findFirst(tenantSettings)
  return settings?.fmcsaReverificationDays ?? DEFAULT_REVERIFICATION_DAYS
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setUTCDate(next.getUTCDate() + days)
  return next
}

function mismatchReason(mismatch: FmcsaMismatch, dotNumber: string): ComplianceReason {
  switch (mismatch.field) {
    case 'dotNumber':
      return { code: 'fmcsa_dot_mismatch', messageKey: 'errors.fmcsaMismatch', params: { dot: dotNumber }, severity: 'blocking' }
    case 'mcNumber':
      return {
        code: 'fmcsa_mc_mismatch',
        messageKey: 'carrier.compliance.fmcsaMcMismatch',
        params: { entered: mismatch.entered ?? '', reported: mismatch.reported ?? '' },
        severity: 'blocking',
      }
    case 'operatingAuthority':
      return {
        code: 'fmcsa_authority_invalid',
        messageKey: 'errors.fmcsaAuthorityInvalid',
        params: { dot: dotNumber },
        severity: 'blocking',
      }
    case 'legalName':
      return {
        code: 'fmcsa_name_mismatch',
        messageKey: 'carrier.compliance.fmcsaNameMismatch',
        params: { entered: mismatch.entered ?? '', reported: mismatch.reported ?? '' },
        severity: 'warning',
      }
    case 'insuranceOnFile':
      return { code: 'fmcsa_no_insurance', messageKey: 'carrier.compliance.fmcsaNoInsurance', severity: 'warning' }
    default:
      return { code: 'fmcsa_mismatch', messageKey: 'errors.fmcsaMismatch', params: { dot: dotNumber }, severity: 'warning' }
  }
}

function normalizedSnapshot(snapshot: FmcsaCarrierSnapshot): FmcsaVerification['normalized'] {
  return {
    legalName: snapshot.legalName,
    dbaName: snapshot.dbaName,
    dotStatus: snapshot.dotStatus,
    allowedToOperate: snapshot.allowedToOperate,
    operatingAuthority: snapshot.operatingAuthority,
    safetyRating: snapshot.safetyRating ?? null,
    insuranceOnFile: snapshot.insuranceOnFile,
    insuranceRequiredCents: snapshot.insuranceRequiredCents ?? null,
    powerUnits: snapshot.powerUnits ?? null,
    drivers: snapshot.drivers ?? null,
    addressState: snapshot.addressState ?? null,
    outOfServiceDate: snapshot.outOfServiceDate ?? null,
  }
}

export interface RunVerificationOptions {
  actorUserId: string
  attempt?: number
}

export interface FmcsaVerificationOutcome {
  verification: FmcsaVerification
  blocking: boolean
  reasons: ComplianceReason[]
}

/**
 * Looks the carrier up at the configured FMCSA provider, compares the result
 * to what the tenant entered, persists an immutable ledger row, and updates
 * the carrier's denormalized verification fields (`fmcsaStatus`,
 * `fmcsaLastVerifiedAt`, `fmcsaNextVerificationAt`).
 */
export async function runVerification(
  db: TenantDb,
  carrier: Carrier,
  options: RunVerificationOptions,
): Promise<FmcsaVerificationOutcome> {
  const provider = getFmcsaProvider()
  const reverificationDays = await reverificationDaysFor(db)
  const now = new Date()
  const attempt = options.attempt ?? 1

  const lookup = await provider.lookupByDot(carrier.dotNumber)

  if (!lookup.ok) {
    const reason: ComplianceReason = {
      code: 'fmcsa_not_found',
      messageKey: 'carrier.compliance.fmcsaNotFound',
      params: { dot: carrier.dotNumber },
      severity: 'blocking',
    }

    const verification = await db.insert(fmcsaVerifications, {
      carrierId: carrier.id,
      provider: lookup.provider,
      dotNumber: carrier.dotNumber,
      mcNumber: carrier.mcNumber,
      status: 'failed',
      normalized: null,
      mismatches: [],
      rawReference: null,
      rawPayloadDigest: null,
      attempt,
      errorMessage: lookup.error.message,
      checkedAt: now,
    })

    await db.update(carriers, carrier.id, {
      fmcsaStatus: 'failed',
      fmcsaLastVerifiedAt: now,
      fmcsaNextVerificationAt: addDays(now, reverificationDays),
    })

    return { verification, blocking: true, reasons: [reason] }
  }

  const compared = compareEnteredToReported(
    { dotNumber: carrier.dotNumber, mcNumber: carrier.mcNumber, legalName: carrier.legalName },
    lookup.data,
  )

  const verification = await db.insert(fmcsaVerifications, {
    carrierId: carrier.id,
    provider: lookup.provider,
    dotNumber: carrier.dotNumber,
    mcNumber: carrier.mcNumber,
    status: compared.status,
    normalized: normalizedSnapshot(lookup.data),
    mismatches: compared.mismatches,
    rawReference: lookup.rawReference ?? null,
    rawPayloadDigest: sha256Hex(JSON.stringify(lookup.data)),
    attempt,
    checkedAt: now,
  })

  await db.update(carriers, carrier.id, {
    fmcsaStatus: compared.status,
    fmcsaLastVerifiedAt: now,
    fmcsaNextVerificationAt: addDays(now, reverificationDays),
  })

  const reasons = compared.mismatches.map((m) => mismatchReason(m, carrier.dotNumber))

  return { verification, blocking: compared.blocking, reasons }
}

/**
 * Admin/Accounting-only escape hatch for a mismatch the business has decided
 * to accept (e.g. a known DBA vs. legal-name difference). The reason is
 * mandatory and is what appears in the audit trail — permission enforcement
 * happens in the calling action (`carrier:verification:override`).
 */
export async function overrideVerification(
  db: TenantDb,
  actor: { userId: string },
  verificationId: string,
  reason: string,
): Promise<FmcsaVerification> {
  if (!reason?.trim()) {
    throw new AppError('validation_failed', 'validation.required')
  }

  const verification = await db.requireById(fmcsaVerifications, verificationId, 'fmcsaVerification')
  const now = new Date()
  const reverificationDays = await reverificationDaysFor(db)

  const updated = await db.update(fmcsaVerifications, verificationId, {
    status: 'manually_overridden',
    overriddenByUserId: actor.userId,
    overrideReason: reason,
    overriddenAt: now,
  })
  if (!updated) throw notFound('errors.notFound', { entity: 'fmcsaVerification' })

  await db.update(carriers, verification.carrierId, {
    fmcsaStatus: 'manually_overridden',
    fmcsaLastVerifiedAt: now,
    fmcsaNextVerificationAt: addDays(now, reverificationDays),
  })

  return updated
}

/** Carriers whose FMCSA verification window has elapsed — the 7-day job's query. */
export async function dueForReverification(db: TenantDb, now: Date = new Date()): Promise<Carrier[]> {
  return db.findMany(carriers, {
    where: and(lte(carriers.fmcsaNextVerificationAt, now), isNull(carriers.suspendedAt))!,
  })
}
