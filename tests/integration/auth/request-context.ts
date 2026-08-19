import { vi } from 'vitest'

/**
 * `src/server/context.ts` and `src/lib/auth/session.ts` read the incoming
 * request through `next/headers` (`cookies()`, `headers()`), which only
 * resolves inside an actual Next.js request — calling it from a plain
 * Vitest test throws "outside a request scope". This is the one seam in the
 * auth stack that a real integration test (as opposed to calling a
 * `requireActor()`-free function with a hand-built `Actor`, as the carrier
 * suite does) cannot avoid, because impersonation and session flows are
 * defined in terms of "the current request's cookie", not an injected value.
 *
 * `vi.mock('next/headers', ...)` below backs both with simple in-memory maps
 * that a test can drive directly — `setTestSessionCookie` for the session
 * token `readSessionToken()`/`setSessionCookie()` read and write, and
 * `setTestRequestHeaders` for the values `getRequestMeta()` reads.
 */

const { cookieStore, headerStore } = vi.hoisted(() => ({
  cookieStore: new Map<string, string>(),
  headerStore: new Map<string, string>(),
}))

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (cookieStore.has(name) ? { value: cookieStore.get(name)! } : undefined),
    set: (name: string, value: string) => {
      cookieStore.set(name, value)
    },
    delete: (name: string) => {
      cookieStore.delete(name)
    },
  }),
  headers: async () => ({
    get: (name: string) => headerStore.get(name.toLowerCase()) ?? null,
  }),
}))

export function setTestSessionCookie(token: string | null): void {
  if (token) cookieStore.set('goliath_session', token)
  else cookieStore.delete('goliath_session')
}

export function setTestRequestHeaders(entries: Record<string, string>): void {
  headerStore.clear()
  for (const [key, value] of Object.entries(entries)) headerStore.set(key.toLowerCase(), value)
}

export function resetTestRequestContext(): void {
  cookieStore.clear()
  headerStore.clear()
}
