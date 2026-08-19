import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { QueuedJob } from '@/db/schema'

const state = {
  now: 0,
  claimCalls: 0,
}

vi.mock('@/jobs/queue', () => ({
  complete: vi.fn(async () => undefined),
  fail: vi.fn(async () => ({ deadLettered: false, nextRunAt: new Date() })),
  deadLetter: vi.fn(async () => undefined),
  release: vi.fn(async () => undefined),
  reclaimExpiredLeases: vi.fn(async () => 0),
  // Always returns a full batch of unregistered-type jobs (which
  // `processJob` dead-letters immediately, without a database round trip)
  // so the queue never drains empty on its own — the only thing that can
  // stop the loop is the deadline.
  claimBatch: vi.fn(async ({ limit }: { limit: number }) => {
    state.claimCalls += 1
    return Array.from({ length: limit }, (_, i) => fakeJob(`job-${state.claimCalls}-${i}`))
  }),
}))

function fakeJob(id: string): QueuedJob {
  return {
    id,
    tenantId: 'tenant-1',
    jobType: 'test.never_registered_for_drain_deadline_test',
    payload: {},
    status: 'running',
    priority: 100,
    runAt: new Date(),
    startedAt: new Date(),
    completedAt: null,
    attempts: 1,
    maxAttempts: 5,
    lastError: null,
    lockedBy: 'worker-1',
    lockedUntil: new Date(Date.now() + 60_000),
    dedupeKey: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as QueuedJob
}

import { claimBatch } from '@/jobs/queue'
import { drain } from '@/jobs/runner'

describe('drain deadline', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.now = 0
    state.claimCalls = 0
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('stops claiming new batches once the deadline has elapsed, even though work is always available', async () => {
    // A fake clock that advances 10ms per read — deterministic and fast,
    // no real timers involved. `drain()` reads `now()` once per loop
    // iteration to check the deadline.
    const now = () => {
      const current = new Date(state.now)
      state.now += 10
      return current
    }

    const result = await drain({ workerId: 'test-worker', limit: 5, deadlineMs: 100, now })

    // The loop must have actually stopped, not run away — with a 100ms
    // deadline and unlimited "available" work, an unbounded loop would
    // never return.
    expect(result.claimed).toBeGreaterThan(0)
    expect(claimBatch).toHaveBeenCalled()
    expect(state.claimCalls).toBeLessThan(1000) // generous upper bound; a real bug here is unbounded, not "a bit high"
  })

  it('never claims a single batch when the deadline is already zero', async () => {
    let calls = 0
    const now = () => {
      calls += 1
      return new Date(0)
    }

    const result = await drain({ workerId: 'test-worker', limit: 5, deadlineMs: 0, now })

    expect(result.claimed).toBe(0)
    expect(claimBatch).not.toHaveBeenCalled()
    expect(calls).toBeGreaterThan(0)
  })
})
