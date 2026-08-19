import 'server-only'
import { NextResponse, type NextRequest } from 'next/server'
import { serverEnv } from '@/lib/env'
import { safeEqual } from '@/lib/crypto'
import { readOutbox as readEmailOutbox, clearOutbox as clearEmailOutbox } from '@/integrations/email'
import { readOutbox as readSmsOutbox, clearOutbox as clearSmsOutbox } from '@/integrations/sms'

/**
 * Test-only introspection into the mock email/SMS outboxes.
 *
 * `MockEmailAdapter`/`MockSmsAdapter` hold their outbox as a module-level
 * array in whichever process constructed them (see `docs/testing.md` §3) —
 * fine for Vitest, which runs in the same process as the code under test,
 * but useless to Playwright: the E2E suite drives a real, separately
 * spawned `next start` process over HTTP and has no way to import that
 * process's module state directly. A token-based flow (email verification,
 * an invitation, a password reset) can only be exercised end-to-end, the
 * way a real user would receive it, if *something* exposes what the mock
 * provider "sent" — this route is that something.
 *
 * It never answers outside a non-production environment (`APP_ENV ===
 * 'production'` 404s outright, the same posture as `ALLOW_DEMO_SEED` and
 * every other demo/mock-only guard in this codebase), and even then it
 * requires the exact same `CRON_SECRET` bearer token every `/api/cron/*`
 * route already requires — see `src/app/api/cron/_lib/auth.ts` — so it is
 * never reachable by an anonymous request and introduces no new secret.
 */
export const runtime = 'nodejs'

function authorize(request: NextRequest): NextResponse | null {
  if (serverEnv().APP_ENV === 'production') {
    return new NextResponse(null, { status: 404 })
  }
  const header = request.headers.get('authorization')
  const expected = `Bearer ${serverEnv().CRON_SECRET}`
  if (!header || !safeEqual(header, expected)) {
    return new NextResponse(null, { status: 401 })
  }
  return null
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const unauthorized = authorize(request)
  if (unauthorized) return unauthorized
  return NextResponse.json({ email: readEmailOutbox(), sms: readSmsOutbox() })
}

/** Clears both outboxes — lets a test start from a known-empty inbox without restarting the server. */
export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const unauthorized = authorize(request)
  if (unauthorized) return unauthorized
  clearEmailOutbox()
  clearSmsOutbox()
  return new NextResponse(null, { status: 204 })
}
