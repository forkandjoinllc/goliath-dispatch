import 'server-only'
import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm'
import { unsafeDb } from '@/db/client'
import { jobQueue, type QueuedJob } from '@/db/schema'
import { logger } from '@/lib/logger'
import { nextRunAtAfterFailure } from './backoff'

/**
 * The durable job queue.
 *
 * This module owns nothing but the lifecycle of a `job_queue` row —
 * claiming, completing, failing, dead-lettering, reclaiming an abandoned
 * lease. It never knows what a job *type* means; that is `registry.ts`'s
 * job. `unsafeDb` is used throughout on purpose: a queue row has no single
 * tenant to scope a `TenantDb` handle to (many rows are platform-level
 * sweeps with `tenantId: null`), and the queue mechanics themselves must be
 * able to see every tenant's work in one claim. ESLint allow-lists
 * `src/jobs/**` for exactly this reason.
 */

/** How long a worker's claim on a job is presumed valid before another worker may reclaim it. */
export const DEFAULT_LEASE_MS = 5 * 60_000

export interface EnqueueInput {
  tenantId?: string | null
  jobType: string
  payload?: Record<string, unknown>
  runAt?: Date
  priority?: number
  /** Makes a duplicate enqueue a no-op: a second call with the same key returns the first job, never a second row. */
  dedupeKey?: string | null
  maxAttempts?: number
}

/**
 * Inserts a new queued job, or — when `dedupeKey` collides with an existing
 * row (the unique index `job_queue_dedupe_uq` is the actual guarantee) —
 * returns that existing row untouched. Never throws on a duplicate key: a
 * retried status transition, a re-run sweep, or a race between two request
 * handlers enqueuing the same effect must all be harmless.
 */
export async function enqueue(input: EnqueueInput): Promise<QueuedJob> {
  const values = {
    tenantId: input.tenantId ?? null,
    jobType: input.jobType,
    payload: input.payload ?? {},
    runAt: input.runAt ?? new Date(),
    priority: input.priority ?? 100,
    dedupeKey: input.dedupeKey ?? null,
    maxAttempts: input.maxAttempts ?? 5,
  }

  if (values.dedupeKey) {
    const [inserted] = await unsafeDb
      .insert(jobQueue)
      .values(values)
      .onConflictDoNothing({ target: jobQueue.dedupeKey })
      .returning()
    if (inserted) return inserted

    const [existing] = await unsafeDb.select().from(jobQueue).where(eq(jobQueue.dedupeKey, values.dedupeKey))
    if (existing) return existing
    // Extremely narrow race: the conflicting row was deleted between the
    // conflict and this read (retention purge, in practice, never runs this
    // fast). Falling through to a plain insert is still correct — worst case
    // we lose the dedupe guarantee for this one enqueue, never correctness.
  }

  const [created] = await unsafeDb.insert(jobQueue).values(values).returning()
  return created!
}

export interface ClaimBatchInput {
  workerId: string
  limit: number
  now?: Date
  leaseMs?: number
}

/**
 * Atomically claims up to `limit` due jobs for `workerId`. The `FOR UPDATE
 * SKIP LOCKED` subquery is the entire safety property this function exists
 * to provide: two workers calling this concurrently can never both come back
 * with the same row, because whichever transaction's row-lock loses the race
 * simply skips that row rather than blocking on it.
 */
export async function claimBatch(input: ClaimBatchInput): Promise<QueuedJob[]> {
  const now = input.now ?? new Date()
  const leaseMs = input.leaseMs ?? DEFAULT_LEASE_MS
  const lockedUntil = new Date(now.getTime() + leaseMs)

  const candidateIds = unsafeDb
    .select({ id: jobQueue.id })
    .from(jobQueue)
    .where(and(eq(jobQueue.status, 'queued'), lte(jobQueue.runAt, now)))
    .orderBy(asc(jobQueue.priority), asc(jobQueue.runAt))
    .limit(input.limit)
    .for('update', { skipLocked: true })

  const claimed = await unsafeDb
    .update(jobQueue)
    .set({
      status: 'running',
      lockedBy: input.workerId,
      lockedUntil,
      startedAt: now,
      attempts: sql`${jobQueue.attempts} + 1`,
    })
    .where(inArray(jobQueue.id, candidateIds))
    .returning()

  return claimed
}

/** Marks a job as having finished successfully. Idempotent: completing an already-completed job is a harmless no-op. */
export async function complete(jobId: string, now: Date = new Date()): Promise<void> {
  await unsafeDb
    .update(jobQueue)
    .set({ status: 'succeeded', completedAt: now, lockedBy: null, lockedUntil: null })
    .where(eq(jobQueue.id, jobId))
}

export interface FailInput {
  jobId: string
  error: string
  now?: Date
  random?: () => number
}

export interface FailResult {
  deadLettered: boolean
  nextRunAt: Date | null
}

/**
 * Records a failed attempt. If the job's `attempts` (already incremented by
 * `claimBatch`) has reached `maxAttempts`, the row moves straight to
 * `dead_letter` instead of being rescheduled — the caller does not need to
 * decide this separately.
 */
export async function fail(input: FailInput): Promise<FailResult> {
  const now = input.now ?? new Date()
  const [row] = await unsafeDb.select().from(jobQueue).where(eq(jobQueue.id, input.jobId))
  if (!row) return { deadLettered: false, nextRunAt: null }

  const truncatedError = input.error.slice(0, 4000)

  if (row.attempts >= row.maxAttempts) {
    await deadLetter(input.jobId, truncatedError, now)
    return { deadLettered: true, nextRunAt: null }
  }

  const nextRunAt = nextRunAtAfterFailure(row.attempts, now, input.random)
  await unsafeDb
    .update(jobQueue)
    .set({
      status: 'queued',
      runAt: nextRunAt,
      lastError: truncatedError,
      lockedBy: null,
      lockedUntil: null,
    })
    .where(eq(jobQueue.id, input.jobId))

  return { deadLettered: false, nextRunAt }
}

/**
 * Releases a claimed job back to `queued` without counting it as a failed
 * attempt — used when a targeted `--job-type` drain claims a row it has no
 * handler interest in and wants another worker to pick it up immediately,
 * not after a backoff delay. Undoes `claimBatch`'s attempt increment so the
 * job's real retry budget is untouched by having been claimed here.
 */
export async function release(jobId: string): Promise<void> {
  await unsafeDb
    .update(jobQueue)
    .set({ status: 'queued', lockedBy: null, lockedUntil: null, attempts: sql`greatest(${jobQueue.attempts} - 1, 0)` })
    .where(eq(jobQueue.id, jobId))
}

/** Moves a job straight to `dead_letter` — used both by `fail()` at `maxAttempts` and by the registry for an unknown job type. */
export async function deadLetter(jobId: string, reason: string, now: Date = new Date()): Promise<void> {
  await unsafeDb
    .update(jobQueue)
    .set({
      status: 'dead_letter',
      lastError: reason.slice(0, 4000),
      completedAt: now,
      lockedBy: null,
      lockedUntil: null,
    })
    .where(eq(jobQueue.id, jobId))
}

/**
 * Returns leases from workers that died mid-job (crashed process, killed
 * function, lost connection) back to `queued` so another worker can pick
 * them up. A job reclaimed this way keeps its already-incremented `attempts`
 * count — a lease timeout counts as a failed attempt, the same as a thrown
 * error, so a job that reliably wedges a worker still eventually
 * dead-letters instead of looping forever.
 */
export async function reclaimExpiredLeases(now: Date = new Date()): Promise<number> {
  const reclaimed = await unsafeDb
    .update(jobQueue)
    .set({ status: 'queued', lockedBy: null, lockedUntil: null })
    .where(and(eq(jobQueue.status, 'running'), lte(jobQueue.lockedUntil, now)))
    .returning({ id: jobQueue.id })
  if (reclaimed.length > 0) {
    logger.warn('jobs: reclaimed expired leases', { count: reclaimed.length })
  }
  return reclaimed.length
}
