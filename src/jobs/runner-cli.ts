#!/usr/bin/env -S node --import tsx
/**
 * `npm run jobs:run` — a local worker that drains the queue continuously.
 *
 * Flags:
 *   --once              Drain a single batch then exit, instead of looping forever.
 *   --job-type=<type>    Restrict this worker to one job type (see `drain()`'s own
 *                        comment on why a targeted drain stops after one empty pass
 *                        rather than busy-looping).
 *   --tenant=<id>        Debugging convenience: only ever process jobs for one
 *                        tenant, by wrapping the handler dispatch so any job whose
 *                        `tenantId` doesn't match is released back to the queue
 *                        untouched, exactly like an unmatched `--job-type`.
 *
 * SIGINT/SIGTERM trigger a graceful shutdown: the in-flight batch is allowed to
 * finish (each job's lease is released normally, by `complete`/`fail`/`deadLetter`
 * inside `processJob`), then the process exits — never killed mid-write.
 */
import 'dotenv/config'
import { randomUUID } from 'node:crypto'
import { logger } from '@/lib/logger'
import { drain, processJob, type DrainResult } from './runner'
import { claimBatch, release } from './queue'

interface CliOptions {
  once: boolean
  jobType?: string
  tenantId?: string
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { once: false }
  for (const arg of argv) {
    if (arg === '--once') options.once = true
    else if (arg.startsWith('--job-type=')) options.jobType = arg.slice('--job-type='.length)
    else if (arg.startsWith('--tenant=')) options.tenantId = arg.slice('--tenant='.length)
  }
  return options
}

const BATCH_LIMIT = 10
const LOOP_DEADLINE_MS = 25_000 // one `drain()` call per loop iteration; short enough that a shutdown signal is honored promptly
const IDLE_SLEEP_MS = 5_000

let shuttingDown = false

function requestShutdown(signal: string): void {
  if (shuttingDown) return
  shuttingDown = true
  logger.info('jobs:run — shutdown requested, finishing in-flight batch', { signal })
}

process.on('SIGINT', () => requestShutdown('SIGINT'))
process.on('SIGTERM', () => requestShutdown('SIGTERM'))

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * `drain()` has no native concept of "only this tenant" (a job has no
 * ambient tenant to filter on before it's claimed), so the `--tenant` flag
 * is layered on top here for local debugging: claim normally, but a
 * mismatched tenant is released rather than run, the same courtesy
 * `drain()` itself extends to a mismatched `--job-type`.
 */
async function drainOnce(options: CliOptions, workerId: string): Promise<DrainResult> {
  if (!options.tenantId) {
    return drain({ workerId, limit: BATCH_LIMIT, deadlineMs: LOOP_DEADLINE_MS, jobType: options.jobType })
  }

  // Tenant-filtered debugging path: `drain()`'s public API has no concept of
  // "only this tenant" (jobs are claimed before their tenant is known to
  // matter), so this claims its own small batch directly and releases
  // anything outside the requested tenant, mirroring what `drain()` itself
  // does for a mismatched `--job-type`.
  const batch = await claimBatch({ workerId, limit: BATCH_LIMIT })
  const relevant = batch.filter((j) => j.tenantId === options.tenantId && (!options.jobType || j.jobType === options.jobType))
  const irrelevant = batch.filter((j) => !relevant.includes(j))
  for (const job of irrelevant) await release(job.id)

  let succeeded = 0
  let retrying = 0
  let deadLettered = 0
  for (const job of relevant) {
    const { outcome } = await processJob(job, workerId)
    if (outcome === 'succeeded') succeeded += 1
    else if (outcome === 'retrying') retrying += 1
    else deadLettered += 1
  }
  return { claimed: relevant.length, succeeded, retrying, deadLettered, reclaimedLeases: 0 }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  const workerId = `cli:${process.pid}:${randomUUID()}`
  logger.info('jobs:run — worker starting', { workerId, ...options })

  do {
    const result = await drainOnce(options, workerId)
    if (result.claimed > 0) {
      logger.info('jobs:run — batch drained', { ...result })
    }
    if (options.once) break
    if (shuttingDown) break
    if (result.claimed === 0) await sleep(IDLE_SLEEP_MS)
  } while (!shuttingDown)

  logger.info('jobs:run — worker stopped', { workerId })
  process.exit(0)
}

main().catch((error) => {
  logger.error('jobs:run — worker crashed', { error })
  process.exit(1)
})
