import 'server-only'
import { logger } from '@/lib/logger'
import { claimBatch, complete, deadLetter, fail, release, reclaimExpiredLeases } from './queue'
import { getJobDefinition } from './registry'
import type { QueuedJob } from '@/db/schema'
// Side-effect import: registers every job type via each handler module's own
// `defineJob(...)` call. Importing it here (rather than leaving every cron
// route and the CLI to remember to) means `drain()`/`processJob()` always
// have a populated registry to look up against, from any entry point.
import './handlers'

/**
 * Ties `queue.ts` (mechanics) to `registry.ts` (meaning) into the one loop
 * every cron route and the local CLI worker calls. Deliberately a separate
 * module from both: `queue.ts` never imports the registry (nothing there
 * needs to know what a job type *does*), and `registry.ts` never imports the
 * queue (its handlers reach `enqueue()` directly, from `./queue`, without
 * this module in between) — this file is the only place both meanings meet,
 * which keeps the dependency graph acyclic.
 */

export interface ProcessJobResult {
  job: QueuedJob
  outcome: 'succeeded' | 'retrying' | 'dead_lettered'
}

/** Runs exactly one already-claimed job through its registered handler. Never throws — every outcome is reported back, not raised. */
export async function processJob(job: QueuedJob, workerId: string): Promise<ProcessJobResult> {
  const log = logger.child({ jobType: job.jobType, tenantId: job.tenantId ?? undefined, requestId: job.id })
  const definition = getJobDefinition(job.jobType)

  if (!definition) {
    const reason = `Unknown job type "${job.jobType}"`
    log.error('jobs: dead-lettering unknown job type', {})
    await deadLetter(job.id, reason)
    return { job, outcome: 'dead_lettered' }
  }

  const parsed = definition.schema.safeParse(job.payload)
  if (!parsed.success) {
    const reason = `Payload failed schema validation: ${parsed.error.issues.map((i) => i.path.join('.') + ': ' + i.message).join('; ')}`
    log.error('jobs: dead-lettering job with invalid payload', {})
    await deadLetter(job.id, reason)
    return { job, outcome: 'dead_lettered' }
  }

  try {
    await definition.handler(parsed.data, {
      jobId: job.id,
      tenantId: job.tenantId,
      attempt: job.attempts,
      maxAttempts: job.maxAttempts,
      workerId,
    })
    await complete(job.id)
    return { job, outcome: 'succeeded' }
  } catch (error) {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    log.warn('jobs: handler failed', { attempt: job.attempts, maxAttempts: job.maxAttempts })
    const result = await fail({ jobId: job.id, error: message })
    return { job, outcome: result.deadLettered ? 'dead_lettered' : 'retrying' }
  }
}

export interface DrainOptions {
  workerId: string
  /** Jobs claimed per batch. */
  limit?: number
  /** Wall-clock budget; the loop stops claiming new batches once exceeded so a Vercel function never times out mid-batch. */
  deadlineMs: number
  /** Restricts the drain to a single job type — used by the CLI's `--job-type` flag and by per-sweep cron routes. */
  jobType?: string
  now?: () => Date
}

export interface DrainResult {
  claimed: number
  succeeded: number
  retrying: number
  deadLettered: number
  reclaimedLeases: number
}

/**
 * Repeatedly claims and processes batches until either no due work remains
 * or `deadlineMs` has elapsed. Unfinished work simply stays `queued` (or
 * `running` under a lease that will itself expire and be reclaimed) — it is
 * never lost, only picked up by the next invocation.
 */
export async function drain(options: DrainOptions): Promise<DrainResult> {
  const now = options.now ?? (() => new Date())
  const start = now().getTime()
  const limit = options.limit ?? 10
  const result: DrainResult = { claimed: 0, succeeded: 0, retrying: 0, deadLettered: 0, reclaimedLeases: 0 }

  result.reclaimedLeases = await reclaimExpiredLeases(now())

  for (;;) {
    if (now().getTime() - start >= options.deadlineMs) break

    const batch = await claimBatch({ workerId: options.workerId, limit, now: now() })
    const relevant = options.jobType ? batch.filter((j) => j.jobType === options.jobType) : batch

    // A job claimed but filtered out by `jobType` was still leased to this
    // worker — release it immediately rather than holding the lease idle
    // until it expires, so a targeted debug drain never starves the general
    // worker pool.
    const irrelevant = options.jobType ? batch.filter((j) => j.jobType !== options.jobType) : []
    for (const job of irrelevant) {
      await release(job.id)
    }

    if (batch.length === 0) break

    for (const job of relevant) {
      if (now().getTime() - start >= options.deadlineMs) break
      result.claimed += 1
      const { outcome } = await processJob(job, options.workerId)
      if (outcome === 'succeeded') result.succeeded += 1
      else if (outcome === 'retrying') result.retrying += 1
      else result.deadLettered += 1
    }

    if (relevant.length === 0 && irrelevant.length > 0) {
      // The whole batch was filtered out. A narrow `jobType` drain (the
      // CLI's `--job-type` debug flag) stops here rather than repeatedly
      // re-claiming-and-releasing the same unrelated rows until the
      // deadline — this option exists for debugging one handler, not for
      // production draining, which never sets it.
      break
    }
    if (batch.length < limit) break
  }

  return result
}
