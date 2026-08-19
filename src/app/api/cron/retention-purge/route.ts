import type { NextRequest } from 'next/server'
import { handleSweepCronRequest, isoWeek } from '../_lib/handler'

/**
 * Weekly. Permanent deletion is irreversible and its cutoffs are measured in
 * years — there is no operational reason to check for newly-purge-eligible
 * records more than once a week, and a slower cadence gives an operator a
 * full week to notice and apply a legal hold before the next run considers
 * a borderline record. The payload this route enqueues never sets
 * `confirm: true` — see `src/jobs/handlers/retention-purge.ts`'s header
 * comment — so in production this schedule fires every week but performs no
 * deletion until an operator deliberately confirms one.
 */
export const runtime = 'nodejs'

async function handle(request: NextRequest) {
  return handleSweepCronRequest(request, { sweepJobType: 'retention.purge_sweep', dedupeBucket: isoWeek })
}

export const GET = handle
export const POST = handle
