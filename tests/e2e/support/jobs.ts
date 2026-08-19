import type { APIRequestContext } from '@playwright/test'
import { expect } from '@playwright/test'

/**
 * Drains the background job queue deterministically by calling the same
 * `/api/cron/drain` route Vercel Cron hits once a minute in production —
 * so a test can advance async work (invoice drafting, notification
 * delivery, document expiration sweeps, …) on demand instead of sleeping
 * for a real minute or racing a timer.
 *
 * Repeats until a drain reports zero processed jobs (nothing left to do)
 * or `maxRounds` is hit, since one job's handler can enqueue another
 * (e.g. an invoice draft enqueuing a notification).
 */
export async function runJobs(request: APIRequestContext, maxRounds = 5): Promise<void> {
  const secret = process.env.CRON_SECRET
  if (!secret) throw new Error('CRON_SECRET is not set in the test process environment')

  for (let round = 0; round < maxRounds; round += 1) {
    const res = await request.post('/api/cron/drain', {
      headers: { Authorization: `Bearer ${secret}` },
    })
    expect(res.ok(), `POST /api/cron/drain failed: ${res.status()}`).toBeTruthy()
    const body = (await res.json()) as { claimed?: number }
    if (!body.claimed) return
  }
}
