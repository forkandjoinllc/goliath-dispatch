import 'server-only'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { unsafeDb } from '@/db/client'
import { consentRecords } from '@/db/schema'
import { normalizeEmail } from '@/lib/utils'
import type { Locale } from '@/i18n/config'

/**
 * Consent recording.
 *
 * Current policy versions live here, in one place, so bumping a version is a
 * one-line change that transparently re-prompts every user who accepted the
 * previous one (`hasCurrentConsent` compares against these constants).
 */
export const CURRENT_POLICY_VERSIONS = {
  privacy_policy: '2026-01',
  terms_and_conditions: '2026-01',
  electronic_signature: '2025-06',
  sms: '2025-06',
  tracking_location: '2025-06',
} as const

export type ConsentType = keyof typeof CURRENT_POLICY_VERSIONS

export interface RecordConsentInput {
  type: ConsentType
  granted: boolean
  locale: Locale
  ipAddress: string | null
  userAgent: string | null
  tenantId?: string | null
  userId?: string | null
  subjectEmail?: string | null
  /** Overrides the current constant — used only when re-recording history. */
  policyVersion?: string
}

export async function recordConsent(input: RecordConsentInput): Promise<void> {
  await unsafeDb.insert(consentRecords).values({
    tenantId: input.tenantId ?? null,
    userId: input.userId ?? null,
    subjectEmail: input.subjectEmail ? (normalizeEmail(input.subjectEmail) ?? input.subjectEmail) : null,
    consentType: input.type,
    policyVersion: input.policyVersion ?? CURRENT_POLICY_VERSIONS[input.type],
    granted: input.granted,
    locale: input.locale,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  })
}

/**
 * True when the subject has an unrevoked, granted consent of `type` recorded
 * at the current policy version. A user identified only by email (pre-account
 * public consent, e.g. during signup) is matched by normalized address.
 */
export async function hasCurrentConsent(
  type: ConsentType,
  subject: { userId?: string | null; subjectEmail?: string | null },
): Promise<boolean> {
  const emailNormalized = subject.subjectEmail ? normalizeEmail(subject.subjectEmail) : null

  const identity = subject.userId
    ? eq(consentRecords.userId, subject.userId)
    : emailNormalized
      ? eq(consentRecords.subjectEmail, emailNormalized)
      : null
  if (!identity) return false

  const row = await unsafeDb
    .select({ id: consentRecords.id })
    .from(consentRecords)
    .where(
      and(
        identity,
        eq(consentRecords.consentType, type),
        eq(consentRecords.policyVersion, CURRENT_POLICY_VERSIONS[type]),
        eq(consentRecords.granted, true),
        isNull(consentRecords.revokedAt),
      ),
    )
    .limit(1)
    .then((rows) => rows[0] ?? null)

  return row != null
}

export async function revokeConsent(userId: string, type: ConsentType): Promise<void> {
  await unsafeDb
    .update(consentRecords)
    .set({ revokedAt: new Date() })
    .where(and(eq(consentRecords.userId, userId), eq(consentRecords.consentType, type), isNull(consentRecords.revokedAt)))
}

export async function listConsentsForUser(userId: string) {
  return unsafeDb
    .select()
    .from(consentRecords)
    .where(eq(consentRecords.userId, userId))
    .orderBy(desc(consentRecords.createdAt))
}
