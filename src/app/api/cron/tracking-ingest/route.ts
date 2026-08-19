import type { NextRequest } from 'next/server'
import { handleSweepCronRequest, isoFiveMinuteBucket } from '../_lib/handler'

/**
 * Every 5 minutes. A load in transit needs a location update frequent
 * enough that "current location" on a tracking screen (internal or the
 * public customer link) still feels live, but polling every active
 * session's provider more often than that buys little — GPS pings this
 * granular are not meaningfully different, and it needlessly burns request
 * quota against a real tracking provider's API once one is configured.
 */
export const runtime = 'nodejs'

async function handle(request: NextRequest) {
  return handleSweepCronRequest(request, { sweepJobType: 'tracking.ingest_sweep', dedupeBucket: isoFiveMinuteBucket })
}

export const GET = handle
export const POST = handle
