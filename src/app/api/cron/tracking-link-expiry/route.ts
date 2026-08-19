import type { NextRequest } from 'next/server'
import { handleSweepCronRequest, isoHour } from '../_lib/handler'

/**
 * Hourly. A public tracking link is already refused at resolve time the
 * instant it is past its own `expiresAt` (see
 * `src/server/tracking/public-links.ts`), so this sweep's only job is
 * keeping `revokedAt` an accurate reflection of that for admin-facing
 * "active links" lists. Hourly is far more often than any such list is
 * likely to be checked, without running a near-empty sweep every minute.
 */
export const runtime = 'nodejs'

async function handle(request: NextRequest) {
  return handleSweepCronRequest(request, { sweepJobType: 'tracking.link_expiry_sweep', dedupeBucket: isoHour })
}

export const GET = handle
export const POST = handle
