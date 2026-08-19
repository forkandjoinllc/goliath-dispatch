import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

vi.mock('@/jobs/queue', () => ({
  complete: vi.fn(async () => undefined),
  fail: vi.fn(async () => ({ deadLettered: false, nextRunAt: new Date() })),
  deadLetter: vi.fn(async () => undefined),
  release: vi.fn(async () => undefined),
  claimBatch: vi.fn(async () => []),
  reclaimExpiredLeases: vi.fn(async () => 0),
}))

import { complete, deadLetter, fail } from '@/jobs/queue'
import { defineJob, __resetRegistryForTests } from '@/jobs/registry'
// `runner.ts` imports `./handlers` for its side effect of registering every
// real job type — importing it here (rather than only the two functions
// under test) exercises the exact module graph the cron routes and CLI use.
import { processJob } from '@/jobs/runner'
import type { QueuedJob } from '@/db/schema'

function fakeJob(overrides: Partial<QueuedJob> = {}): QueuedJob {
  return {
    id: 'job-1',
    tenantId: 'tenant-1',
    jobType: 'test.unregistered',
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
    ...overrides,
  } as QueuedJob
}

describe('processJob', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    // Blunt and global, but safe here: each test that needs a custom job
    // type registers its own fresh, and vitest isolates module state (and
    // therefore this in-memory registry) per test *file*, not per test —
    // nothing outside this file observes the reset.
    __resetRegistryForTests()
  })

  it('dead-letters a job whose type is not in the registry, without ever calling the handler', async () => {
    const job = fakeJob({ jobType: 'test.this_type_was_never_registered' })

    const result = await processJob(job, 'worker-1')

    expect(result.outcome).toBe('dead_lettered')
    expect(deadLetter).toHaveBeenCalledTimes(1)
    expect(deadLetter).toHaveBeenCalledWith(job.id, expect.stringContaining('Unknown job type'))
    expect(complete).not.toHaveBeenCalled()
    expect(fail).not.toHaveBeenCalled()
  })

  it('dead-letters a job whose payload fails its registered schema, without calling the handler', async () => {
    const handler = vi.fn()
    defineJob('test.strict_payload', {
      schema: z.object({ requiredField: z.string() }),
      handler,
      defaultMaxAttempts: 3,
      description: 'test only',
    })

    const job = fakeJob({ jobType: 'test.strict_payload', payload: { wrongField: 123 } })
    const result = await processJob(job, 'worker-1')

    expect(result.outcome).toBe('dead_lettered')
    expect(deadLetter).toHaveBeenCalledTimes(1)
    expect(deadLetter).toHaveBeenCalledWith(job.id, expect.stringContaining('schema validation'))
    expect(handler).not.toHaveBeenCalled()
  })

  it('completes the job when the handler succeeds', async () => {
    const handler = vi.fn(async () => undefined)
    defineJob('test.succeeds', {
      schema: z.object({}),
      handler,
      defaultMaxAttempts: 3,
      description: 'test only',
    })

    const job = fakeJob({ jobType: 'test.succeeds', payload: {} })
    const result = await processJob(job, 'worker-1')

    expect(result.outcome).toBe('succeeded')
    expect(handler).toHaveBeenCalledTimes(1)
    expect(complete).toHaveBeenCalledWith(job.id)
  })

  it('calls fail() (not dead-letter) when the handler throws and attempts remain', async () => {
    const handler = vi.fn(async () => {
      throw new Error('transient failure')
    })
    defineJob('test.throws', {
      schema: z.object({}),
      handler,
      defaultMaxAttempts: 5,
      description: 'test only',
    })

    const job = fakeJob({ jobType: 'test.throws', payload: {}, attempts: 1, maxAttempts: 5 })
    const result = await processJob(job, 'worker-1')

    expect(result.outcome).toBe('retrying')
    expect(fail).toHaveBeenCalledWith(expect.objectContaining({ jobId: job.id, error: expect.stringContaining('transient failure') }))
    expect(complete).not.toHaveBeenCalled()
    expect(deadLetter).not.toHaveBeenCalled()
  })
})
