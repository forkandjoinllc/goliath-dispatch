import type { NextRequest } from 'next/server'
import { handleSweepCronRequest, isoDate } from '../_lib/handler'

/**
 * Daily. FMCSA data (authority status, insurance-on-file, safety rating)
 * changes on its own schedule, not the tenant's — a carrier can lose
 * operating authority between two of our checks with no local trigger to
 * notice. Daily is frequent enough to catch that within the tenant's
 * configured `fmcsaReverificationDays` window (7 days by default) without
 * hammering the FMCSA QCMobile API on every carrier every day: the sweep
 * only enqueues a carrier whose window has actually elapsed.
 */
export const runtime = 'nodejs'

async function handle(request: NextRequest) {
  return handleSweepCronRequest(request, { sweepJobType: 'fmcsa.reverification_sweep', dedupeBucket: isoDate })
}

export const GET = handle
export const POST = handle
