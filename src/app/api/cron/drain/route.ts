import { NextResponse, type NextRequest } from 'next/server'
import { drain } from '@/jobs/runner'
import { logger } from '@/lib/logger'
import { authorizeCronRequest } from '../_lib/auth'

/**
 * The general-purpose worker every schedule shares.
 *
 * Every sweep route above already drains for a bounded time right after
 * enqueueing its own sweep, so most fan-out work (one `fmcsa.reverify_carrier`
 * job per carrier, one `notification.deliver` per queued notification, …)
 * gets worked in the same invocation it was created in. This route exists
 * for whatever is left between sweeps — a job whose own sweep's drain
 * window ran out, a `document.ocr_extract` job enqueued by a user upload
 * outside any sweep, a retried job whose backoff delay has now elapsed —
 * and runs once a minute (`vercel.json`) so nothing waits longer than that
 * for a worker.
 *
 * Vercel Cron sends GET; POST is accepted too so it can be curled directly
 * for manual/local draining without a scheduler in front of it.
 */
export const runtime = 'nodejs'

const DEADLINE_MS = 45_000

async function handle(request: NextRequest): Promise<NextResponse> {
  const unauthorized = authorizeCronRequest(request)
  if (unauthorized) return unauthorized

  const workerId = `cron:drain:${crypto.randomUUID()}`
  const result = await drain({ workerId, deadlineMs: DEADLINE_MS, limit: 20 })
  logger.info('cron: queue drained', { ...result })

  return NextResponse.json({ ok: true, ...result })
}

export const GET = handle
export const POST = handle
