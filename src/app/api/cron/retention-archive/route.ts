import type { NextRequest } from 'next/server'
import { handleSweepCronRequest, isoDate } from '../_lib/handler'

/**
 * Daily. Archival is a housekeeping pass over a slow-moving cutoff (months),
 * so nothing is lost by running it daily rather than continuously — daily
 * is simply frequent enough that a record's active window is never
 * meaningfully overstayed, while keeping each run's candidate set small.
 */
export const runtime = 'nodejs'

async function handle(request: NextRequest) {
  return handleSweepCronRequest(request, { sweepJobType: 'retention.archive_sweep', dedupeBucket: isoDate })
}

export const GET = handle
export const POST = handle
