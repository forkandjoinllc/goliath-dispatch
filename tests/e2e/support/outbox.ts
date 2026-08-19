import type { APIRequestContext } from '@playwright/test'
import { expect } from '@playwright/test'

/**
 * Reads the running server's mock email/SMS outbox through the guarded
 * `/api/testing/outbox` route (see that route's own doc comment for why it
 * exists and how it is locked down). Requires `CRON_SECRET` — the same
 * secret every `/api/cron/*` route already requires.
 */

export interface OutboxMessage {
  to: string | string[]
  subject: string
  html: string
  text: string
  tags?: string[]
  sentAt: string
}

interface OutboxResponse {
  email: OutboxMessage[]
  sms: Array<{ to: string; body: string }>
}

function cronSecret(): string {
  const secret = process.env.CRON_SECRET
  if (!secret) throw new Error('CRON_SECRET is not set in the test process environment')
  return secret
}

export async function readOutbox(request: APIRequestContext): Promise<OutboxResponse> {
  const res = await request.get('/api/testing/outbox', {
    headers: { Authorization: `Bearer ${cronSecret()}` },
  })
  expect(res.ok(), `GET /api/testing/outbox failed: ${res.status()}`).toBeTruthy()
  return res.json()
}

export async function clearOutbox(request: APIRequestContext): Promise<void> {
  const res = await request.delete('/api/testing/outbox', {
    headers: { Authorization: `Bearer ${cronSecret()}` },
  })
  expect(res.ok(), `DELETE /api/testing/outbox failed: ${res.status()}`).toBeTruthy()
}

/** Polls the outbox until a message to `to` matching `subjectContains` shows up, then returns it. */
export async function waitForEmail(
  request: APIRequestContext,
  to: string,
  subjectContains?: string,
): Promise<OutboxMessage> {
  const target = to.trim().toLowerCase()
  let found: OutboxMessage | undefined
  await expect
    .poll(
      async () => {
        const { email } = await readOutbox(request)
        found = email
          .slice()
          .reverse()
          .find((m) => {
            const recipients = Array.isArray(m.to) ? m.to : [m.to]
            const toMatches = recipients.some((r) => r.trim().toLowerCase() === target)
            const subjectMatches = !subjectContains || m.subject.includes(subjectContains)
            return toMatches && subjectMatches
          })
        return found ? 'found' : 'pending'
      },
      { message: `waiting for an email to ${to}`, timeout: 15_000 },
    )
    .toBe('found')
  return found!
}

/**
 * Extracts the last path segment of the first URL in `text` matching
 * `marker` (e.g. `/verify-email/`) — the raw, single-use token a real
 * recipient would click. The charset includes `.` because a signing link's
 * token is `${tenantId}.${randomSecret}` (see `buildRawToken` in
 * `server/signatures/service.ts`) — every link in this app's plain-text
 * email bodies sits alone on its own line, so this never swallows trailing
 * sentence punctuation.
 */
export function extractTokenFromLink(text: string, marker: string): string {
  const pattern = new RegExp(`${marker}([A-Za-z0-9._-]+)`)
  const match = text.match(pattern)
  if (!match) throw new Error(`No link matching "${marker}" found in email body: ${text}`)
  return match[1]!
}
