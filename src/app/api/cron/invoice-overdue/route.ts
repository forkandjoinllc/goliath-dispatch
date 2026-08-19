import type { NextRequest } from 'next/server'
import { handleSweepCronRequest, isoDate } from '../_lib/handler'

/**
 * Daily. `overdue` is a due-date comparison, not a real-time state — an
 * invoice does not need to flip within minutes of midnight, and Accounting's
 * aging reports are read once a day at most. Daily keeps the invoice's
 * status (and its one-time `invoice.overdue` notification) current within
 * a day of the due date passing.
 */
export const runtime = 'nodejs'

async function handle(request: NextRequest) {
  return handleSweepCronRequest(request, { sweepJobType: 'invoice.overdue_sweep', dedupeBucket: isoDate })
}

export const GET = handle
export const POST = handle
