import 'server-only'
import { NextResponse, type NextRequest } from 'next/server'
import { enqueue } from '@/jobs/queue'
import { drain } from '@/jobs/runner'
import { logger } from '@/lib/logger'
import { authorizeCronRequest } from './auth'

/**
 * Shared shape for every per-sweep cron route: authorize, enqueue that
 * sweep's own job (deduped to one per schedule tick, so an overlapping or
 * retried Vercel Cron invocation can never enqueue the sweep twice), then
 * drain the general queue for a bounded time so the sweep's own fan-out
 * (e.g. one `fmcsa.reverify_carrier` job per carrier) gets worked in the
 * same invocation rather than waiting for the next `/api/cron/drain` tick.
 *
 * The bounded `deadlineMs` is what keeps this from ever timing out mid-batch
 * on a Vercel function with a hard wall-clock limit: `drain()` simply stops
 * claiming new batches once the deadline passes, and whatever is left
 * un-drained stays `queued` for the next invocation — nothing is lost.
 */

const DEFAULT_DEADLINE_MS = 45_000

export interface SweepRouteOptions {
  /** The sweep's own job type — enqueued once per invocation. */
  sweepJobType: string
  /** Dedupe bucket suffix (e.g. an ISO date for a daily sweep, an ISO hour for hourly) so overlapping fires collapse to one enqueue. */
  dedupeBucket: (now: Date) => string
  deadlineMs?: number
}

export async function handleSweepCronRequest(request: NextRequest, options: SweepRouteOptions): Promise<NextResponse> {
  const unauthorized = authorizeCronRequest(request)
  if (unauthorized) return unauthorized

  const workerId = `cron:${options.sweepJobType}:${crypto.randomUUID()}`
  const now = new Date()

  await enqueue({
    jobType: options.sweepJobType,
    dedupeKey: `${options.sweepJobType}:${options.dedupeBucket(now)}`,
  })

  const result = await drain({ workerId, deadlineMs: options.deadlineMs ?? DEFAULT_DEADLINE_MS })
  logger.info('cron: sweep drained', { sweepJobType: options.sweepJobType, ...result })

  return NextResponse.json({ ok: true, sweepJobType: options.sweepJobType, ...result })
}

export function isoDate(now: Date): string {
  return now.toISOString().slice(0, 10)
}

export function isoHour(now: Date): string {
  return now.toISOString().slice(0, 13)
}

export function isoFiveMinuteBucket(now: Date): string {
  const bucketed = new Date(now)
  bucketed.setUTCMinutes(Math.floor(bucketed.getUTCMinutes() / 5) * 5, 0, 0)
  return bucketed.toISOString()
}

export function isoWeek(now: Date): string {
  // ISO week number, UTC. Good enough as a once-a-week dedupe bucket — it
  // does not need to be calendar-perfect, only stable across the same
  // Vercel Cron schedule firing more than once.
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const dayNum = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  const weekNumber = Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7)
  return `${date.getUTCFullYear()}-W${String(weekNumber).padStart(2, '0')}`
}
