import 'server-only'
import { z } from 'zod'
import { tenantDb } from '@/db/tenant-db'
import { loads } from '@/db/schema'
import { logger } from '@/lib/logger'
import { calculateRoute } from '@/server/routes/service'
import { getCurrentEvaluation, runEvaluation } from '@/server/oversize/service'
import { defineJob, type JobContext } from '../registry'

/**
 * Recalculates a load's route and oversize evaluation after its stops (or
 * dimensions) change.
 *
 * `calculateRoute()` is called without `force` — its own fingerprint check
 * (`stopsFingerprint`) already refuses to re-bill the geo provider for a
 * load whose stop coordinates have not actually changed, so it is always
 * safe to enqueue this job speculatively and let it no-op the network call.
 *
 * SAFETY PROPERTY — a validated oversize evaluation must never survive a
 * dimension change: `runEvaluation()` always **inserts a brand-new**
 * `oversize_evaluations` row with `humanValidationStatus: 'pending'` (see
 * that function's own code — it is an insert, never an update), and
 * `getCurrentEvaluation()` / `compliance/gates.ts::oversizeGate` always read
 * the most recently *evaluated* row, not a stored pointer. A previously
 * `validated` evaluation is therefore automatically superseded the instant
 * this job runs — there is no separate "clear the validation" step to
 * forget. The assertion below makes that structural guarantee an explicit,
 * checked invariant rather than an implicit one: if it ever fails, that is
 * a real regression in the oversize domain, not a transient error, so it is
 * logged loudly rather than silently swallowed.
 *
 * No `oversize.outcome_changed` (or similar) entry exists in
 * `NOTIFICATION_CATALOG` (`src/server/notifications/catalog.ts`, a fixed
 * 14-key union this agent does not own), so a material outcome change is
 * surfaced as a structured log plus the persisted evaluation row itself
 * (which every dispatch screen already reads) rather than an in-app/email
 * notification. Recommended follow-up for whoever owns `catalog.ts`: add
 * one so `emitNotification()` can replace the log line below.
 */

const payloadSchema = z.object({ loadId: z.string().uuid() })

function materiallyDifferent(
  previous: { outcome: string; permitLikelyRequired: boolean; escortLikelyRequired: boolean; policeEscortLikelyRequired: boolean } | null,
  next: { outcome: string; permitLikelyRequired: boolean; escortLikelyRequired: boolean; policeEscortLikelyRequired: boolean },
): boolean {
  if (!previous) return true
  return (
    previous.outcome !== next.outcome ||
    previous.permitLikelyRequired !== next.permitLikelyRequired ||
    previous.escortLikelyRequired !== next.escortLikelyRequired ||
    previous.policeEscortLikelyRequired !== next.policeEscortLikelyRequired
  )
}

export async function reevaluateRoute(payload: z.infer<typeof payloadSchema>, ctx: JobContext): Promise<void> {
  if (!ctx.tenantId) throw new Error('route.evaluate requires a tenantId')
  const db = tenantDb(ctx.tenantId)

  const previous = await getCurrentEvaluation(db, payload.loadId)
  const wasValidated = previous?.humanValidationStatus === 'validated'

  await calculateRoute(db, payload.loadId)
  const next = await runEvaluation(db, payload.loadId)

  // Checked invariant, not an assumption: see the safety-property comment above.
  if (wasValidated && next.humanValidationStatus === 'validated') {
    logger.error('route-evaluation: a validated oversize evaluation survived a dimension change', {
      tenantId: ctx.tenantId,
      loadId: payload.loadId,
      previousEvaluationId: previous?.id,
      newEvaluationId: next.id,
    })
  }

  if (materiallyDifferent(previous, next)) {
    const load = await db.findById(loads, payload.loadId)
    logger.warn('route-evaluation: oversize outcome changed materially, dispatcher should be notified', {
      tenantId: ctx.tenantId,
      loadId: payload.loadId,
      dispatcherUserId: load?.dispatcherUserId ?? undefined,
      previousOutcome: previous?.outcome,
      newOutcome: next.outcome,
    })
  }
}

defineJob('route.evaluate', {
  schema: payloadSchema,
  handler: reevaluateRoute,
  defaultMaxAttempts: 5,
  description: "Recalculates a load's route and oversize evaluation after stops or dimensions change.",
})
