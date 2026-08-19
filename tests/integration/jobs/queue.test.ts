import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { unsafeDb } from '@/db/client'
import { jobQueue } from '@/db/schema'
import { claimBatch, complete, deadLetter, enqueue, fail, reclaimExpiredLeases } from '@/jobs/queue'
import { testWorkerId } from './fixtures'

/**
 * Queue-mechanics integration tests, against real Postgres. No tenant is
 * needed for most of these — the queue itself is tenant-agnostic (see
 * `queue.ts`'s header comment) — so each test just uses a unique `jobType` /
 * `dedupeKey` to stay isolated from any other test running against the same
 * database.
 */

function uniqueJobType(label: string): string {
  return `test.${label}.${Date.now()}.${Math.random().toString(36).slice(2)}`
}

describe('job queue', () => {
  it('enqueuing the same dedupeKey twice creates exactly one row', async () => {
    const jobType = uniqueJobType('dedupe')
    const dedupeKey = `dedupe-key-${jobType}`

    const first = await enqueue({ jobType, dedupeKey, payload: { n: 1 } })
    const second = await enqueue({ jobType, dedupeKey, payload: { n: 2 } })

    expect(second.id).toBe(first.id)
    // The second call's payload must never have overwritten the first row.
    expect(second.payload).toEqual({ n: 1 })

    const rows = await unsafeDb.select().from(jobQueue).where(eq(jobQueue.dedupeKey, dedupeKey))
    expect(rows).toHaveLength(1)
  })

  it('two concurrent claimBatch calls never claim the same job', async () => {
    const jobType = uniqueJobType('concurrent-claim')
    const jobs = await Promise.all(
      Array.from({ length: 10 }, (_, i) => enqueue({ jobType, payload: { i }, dedupeKey: `${jobType}-${i}` })),
    )
    expect(jobs).toHaveLength(10)

    const workerA = testWorkerId()
    const workerB = testWorkerId()

    // Both claims race for the same 10 due rows with a combined limit of 12
    // (more than available) — `FOR UPDATE SKIP LOCKED` is what must prevent
    // any overlap between the two result sets.
    const [claimedA, claimedB] = await Promise.all([
      claimBatch({ workerId: workerA, limit: 6 }),
      claimBatch({ workerId: workerB, limit: 6 }),
    ])

    const idsA = new Set(claimedA.filter((j) => j.jobType === jobType).map((j) => j.id))
    const idsB = new Set(claimedB.filter((j) => j.jobType === jobType).map((j) => j.id))

    for (const id of idsA) {
      expect(idsB.has(id)).toBe(false)
    }

    const totalClaimedOfThisType = idsA.size + idsB.size
    expect(totalClaimedOfThisType).toBe(10)
  })

  it('a failing handler retries then dead-letters once maxAttempts is reached', async () => {
    const jobType = uniqueJobType('retry-then-dead-letter')
    const workerId = testWorkerId()
    const job = await enqueue({ jobType, maxAttempts: 2, dedupeKey: `${jobType}-only` })

    // Attempt 1: claim increments attempts to 1, still below maxAttempts (2)
    // -> fail() reschedules rather than dead-lettering.
    const [claim1] = await claimBatch({ workerId, limit: 1 })
    expect(claim1?.id).toBe(job.id)
    expect(claim1?.attempts).toBe(1)

    const result1 = await fail({ jobId: job.id, error: 'transient failure one' })
    expect(result1.deadLettered).toBe(false)

    const [afterFail1] = await unsafeDb.select().from(jobQueue).where(eq(jobQueue.id, job.id))
    expect(afterFail1?.status).toBe('queued')

    // Attempt 2: claim increments attempts to 2, which equals maxAttempts ->
    // fail() must now dead-letter instead of rescheduling again.
    const [claim2] = await claimBatch({ workerId, limit: 1, now: new Date(Date.now() + 60 * 60_000) })
    expect(claim2?.id).toBe(job.id)
    expect(claim2?.attempts).toBe(2)

    const result2 = await fail({ jobId: job.id, error: 'transient failure two' })
    expect(result2.deadLettered).toBe(true)
    expect(result2.nextRunAt).toBeNull()

    const [afterFail2] = await unsafeDb.select().from(jobQueue).where(eq(jobQueue.id, job.id))
    expect(afterFail2?.status).toBe('dead_letter')
    expect(afterFail2?.lastError).toContain('transient failure two')
  })

  it('a lease that expires before completion is reclaimed for another worker', async () => {
    const jobType = uniqueJobType('expired-lease')
    const workerId = testWorkerId()
    const job = await enqueue({ jobType, dedupeKey: `${jobType}-only` })

    const claimTime = new Date()
    // A short lease: `lockedUntil` is only 1s past `claimTime`, so checking
    // "expired" at `claimTime` itself must find nothing, while checking a
    // couple of seconds later must reclaim it.
    const [claimed] = await claimBatch({ workerId, limit: 1, now: claimTime, leaseMs: 1_000 })
    expect(claimed?.id).toBe(job.id)

    const reclaimedBeforeExpiry = await reclaimExpiredLeases(claimTime)
    expect(reclaimedBeforeExpiry).toBe(0)

    const reclaimedCount = await reclaimExpiredLeases(new Date(claimTime.getTime() + 2_000))
    expect(reclaimedCount).toBeGreaterThanOrEqual(1)

    const [row] = await unsafeDb.select().from(jobQueue).where(eq(jobQueue.id, job.id))
    expect(row?.status).toBe('queued')
    expect(row?.lockedBy).toBeNull()

    // Reclaimed work is immediately claimable again by a fresh worker.
    const [reclaimedJob] = await claimBatch({ workerId: testWorkerId(), limit: 1 })
    expect(reclaimedJob?.id).toBe(job.id)
    await complete(reclaimedJob!.id)
  })

  it('an unknown-type dead-letter is terminal and never re-claimed', async () => {
    const jobType = uniqueJobType('dead-letter-terminal')
    const job = await enqueue({ jobType, dedupeKey: `${jobType}-only` })
    await deadLetter(job.id, 'no handler registered for this test job type')

    const [claimed] = await claimBatch({ workerId: testWorkerId(), limit: 5 })
    expect(claimed).toBeUndefined()

    const [row] = await unsafeDb.select().from(jobQueue).where(eq(jobQueue.id, job.id))
    expect(row?.status).toBe('dead_letter')
  })
})
