import 'server-only'
import { NextResponse } from 'next/server'
import { serverEnv } from '@/lib/env'
import { safeEqual } from '@/lib/crypto'

/**
 * Every cron route's front door.
 *
 * Vercel Cron (and the CLI/manual trigger for local dev) sends
 * `Authorization: Bearer <CRON_SECRET>`. A missing or wrong secret returns a
 * bare 401 with no body — never a message key, never which part was wrong —
 * so a probing request learns nothing about why it failed.
 */
export function authorizeCronRequest(request: Request): NextResponse | null {
  const header = request.headers.get('authorization')
  const expected = `Bearer ${serverEnv().CRON_SECRET}`

  if (!header || !safeEqual(header, expected)) {
    return new NextResponse(null, { status: 401 })
  }
  return null
}
