import 'server-only'
import { z } from 'zod'
import { desc, eq } from 'drizzle-orm'
import { tenantDb } from '@/db/tenant-db'
import { carriers, fmcsaVerifications } from '@/db/schema'
import { logger } from '@/lib/logger'
import { dueForReverification, runVerification } from '@/server/verification/fmcsa-service'
import { defineJob, type JobContext } from '../registry'
import { enqueue } from '../queue'
import { listSweepableTenantIds } from '../tenants'
import { SYSTEM_ACTOR_USER_ID } from '../constants'

/**
 * FMCSA re-verification: the 7-day sweep.
 *
 * Two job types work together:
 *
 *  - `fmcsa.reverification_sweep` (tenantId: null, cron-triggered, no
 *    payload): iterates every sweepable tenant, asks
 *    `dueForReverification()` which carriers have crossed their
 *    `fmcsaNextVerificationAt`, and enqueues one `fmcsa.reverify_carrier`
 *    job per carrier. Re-running the sweep the same day is a no-op for a
 *    carrier already enqueued: the dedupe key is `carrier + calendar date`,
 *    so a second sweep (a retried cron invocation, an operator-triggered
 *    replay) can never double-verify a carrier on the same day, while a
 *    genuinely new day always can.
 *  - `fmcsa.reverify_carrier` (tenantId set, payload `{ carrierId }`):
 *    idempotent and tenant-aware — it loads the carrier fresh, calls the
 *    same `runVerification()` the onboarding flow uses, and is safe to
 *    retry (the FMCSA lookup is a read; updating the carrier's denormalized
 *    status is a set, not an increment). The ledger row it writes is
 *    intentionally NOT deduplicated — `fmcsaVerifications` is an
 *    append-only history of every check, by design (see the domain
 *    module's own header comment).
 */

const sweepSchema = z.object({}).strict()
const reverifyCarrierSchema = z.object({ carrierId: z.string().uuid() })

function isoDateUtc(now: Date): string {
  return now.toISOString().slice(0, 10)
}

async function runSweep(_payload: z.infer<typeof sweepSchema>, _ctx: JobContext): Promise<void> {
  const now = new Date()
  const tenantIds = await listSweepableTenantIds()

  for (const tenantId of tenantIds) {
    const db = tenantDb(tenantId)
    const due = await dueForReverification(db, now)

    for (const carrier of due) {
      const dedupeKey = `fmcsa.reverify_carrier:${tenantId}:${carrier.id}:${isoDateUtc(now)}`
      await enqueue({
        tenantId,
        jobType: 'fmcsa.reverify_carrier',
        payload: { carrierId: carrier.id },
        dedupeKey,
        maxAttempts: 5,
      })
    }
  }
}

/**
 * Runs one carrier's verification and — the safety-relevant part —
 * compares the outcome to the carrier's last recorded verification.
 *
 * There is no `carrier.fmcsa_mismatch` (or similar) entry in
 * `NOTIFICATION_CATALOG` (`src/server/notifications/catalog.ts`), which is a
 * fixed 14-key union this agent does not own, so a genuine regression
 * (a previously clean carrier now mismatching, or losing operating
 * authority) is surfaced the two ways available without extending that
 * catalog: a loud structured log, and the `fmcsaVerifications` /
 * `carriers.fmcsaStatus` state itself, which every compliance screen and
 * dispatch gate already reads. Recommended follow-up for whoever owns
 * `catalog.ts`: add a `carrier.fmcsa_mismatch` event so this can become a
 * real in-app/email notification instead of a log line.
 */
export async function reverifyCarrier(
  payload: z.infer<typeof reverifyCarrierSchema>,
  ctx: JobContext,
): Promise<void> {
  if (!ctx.tenantId) throw new Error('fmcsa.reverify_carrier requires a tenantId')
  const db = tenantDb(ctx.tenantId)

  const carrier = await db.findById(carriers, payload.carrierId)
  if (!carrier) return // Carrier deleted since this job was enqueued — nothing left to verify.

  const previous = await db.findFirst(fmcsaVerifications, {
    where: eq(fmcsaVerifications.carrierId, carrier.id),
    orderBy: desc(fmcsaVerifications.checkedAt),
  })

  const outcome = await runVerification(db, carrier, { actorUserId: SYSTEM_ACTOR_USER_ID, attempt: 1 })

  const wasGood = previous ? previous.status === 'verified' || previous.status === 'manually_overridden' : false
  const nowBad = outcome.verification.status === 'mismatch' || outcome.verification.status === 'failed'
  const previousNormalized = previous?.normalized as { allowedToOperate?: boolean } | null
  const nextNormalized = outcome.verification.normalized as { allowedToOperate?: boolean } | null
  const authorityLost = previousNormalized?.allowedToOperate === true && nextNormalized?.allowedToOperate === false

  if (wasGood && (nowBad || authorityLost)) {
    logger.warn('fmcsa: previously-verified carrier regressed on reverification', {
      tenantId: ctx.tenantId,
      carrierId: carrier.id,
      previousStatus: previous?.status,
      newStatus: outcome.verification.status,
      authorityLost,
    })
  }
}

defineJob('fmcsa.reverification_sweep', {
  schema: sweepSchema,
  handler: runSweep,
  defaultMaxAttempts: 3,
  description: 'Daily sweep: finds carriers whose FMCSA reverification window elapsed and enqueues one job per carrier.',
})

defineJob('fmcsa.reverify_carrier', {
  schema: reverifyCarrierSchema,
  handler: reverifyCarrier,
  defaultMaxAttempts: 5,
  description: 'Re-verifies one carrier against FMCSA and flags a regression from a previously-clean status.',
})

/**
 * `carrier.fmcsa_verify` — the on-demand, single-carrier verification
 * `src/server/carriers/service.ts` already enqueues when a carrier is
 * created. Shares `reverifyCarrier`'s logic exactly: the initial check has
 * no "previous" verification to regress from, so the comparison above is a
 * harmless no-op the first time.
 */
defineJob('carrier.fmcsa_verify', {
  schema: reverifyCarrierSchema,
  handler: reverifyCarrier,
  defaultMaxAttempts: 5,
  description: 'On-demand FMCSA verification for a newly created carrier.',
})
