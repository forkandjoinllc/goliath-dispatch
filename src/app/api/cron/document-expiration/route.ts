import type { NextRequest } from 'next/server'
import { handleSweepCronRequest, isoDate } from '../_lib/handler'

/**
 * Daily. Documents expire on calendar dates (COIs, registrations, medical
 * cards), not by the minute — once a day is enough to materialize the
 * warning/expired rows and notify the same morning a document crosses its
 * threshold, and running it more often would only ever re-check dates that
 * haven't moved since the last pass.
 */
export const runtime = 'nodejs'

async function handle(request: NextRequest) {
  return handleSweepCronRequest(request, { sweepJobType: 'document.expiration_sweep', dedupeBucket: isoDate })
}

export const GET = handle
export const POST = handle
