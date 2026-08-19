import { logger } from '@/lib/logger'

/**
 * Shared HTTP client for live adapters.
 *
 * - Bounds every call with an AbortController timeout.
 * - Retries ONLY on 429, 5xx, or a network-level failure (including our own
 *   timeout) — never on 4xx, which represents a request we should not repeat.
 * - Backs off exponentially with full jitter, honouring `Retry-After` when
 *   the server sends one.
 * - Logs a sanitized URL (`redactQueryParams`) and never logs header values —
 *   callers must not put a credential in a URL in the first place; this is a
 *   defense-in-depth measure for adapters (e.g. FMCSA's `webkey`) that a
 *   third-party API forces into the query string.
 */

const DEFAULT_TIMEOUT_MS = 8_000
const DEFAULT_MAX_ATTEMPTS = 3
const DEFAULT_BASE_DELAY_MS = 250
const DEFAULT_MAX_DELAY_MS = 4_000

export class ProviderHttpError extends Error {
  readonly provider: string
  readonly status: number | null
  readonly retryable: boolean

  constructor(
    provider: string,
    status: number | null,
    message: string,
    retryable: boolean,
    options?: { cause?: unknown },
  ) {
    super(message, { cause: options?.cause })
    this.name = 'ProviderHttpError'
    this.provider = provider
    this.status = status
    this.retryable = retryable
  }
}

export interface FetchJsonOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  headers?: Record<string, string>
  body?: unknown
  timeoutMs?: number
  maxAttempts?: number
  baseDelayMs?: number
  maxDelayMs?: number
  /** Short provider name for logging, e.g. "fmcsa.qcmobile". */
  provider: string
  /** Query parameter names whose values are replaced with `[redacted]` before logging. */
  redactQueryParams?: string[]
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Full jitter: a random delay in `[0, cappedExponentialBackoff]`. */
function jitteredDelayMs(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  const capped = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1))
  return Math.random() * capped
}

function retryAfterMs(headerValue: string | null): number | null {
  if (!headerValue) return null
  const asSeconds = Number(headerValue)
  if (Number.isFinite(asSeconds)) return Math.max(0, asSeconds * 1000)
  const asDate = Date.parse(headerValue)
  if (!Number.isNaN(asDate)) return Math.max(0, asDate - Date.now())
  return null
}

function sanitizeUrlForLog(url: string, redactParams: string[] = []): string {
  try {
    const parsed = new URL(url)
    for (const param of redactParams) {
      if (parsed.searchParams.has(param)) parsed.searchParams.set(param, '[redacted]')
    }
    return parsed.toString()
  } catch {
    return '[unparsable-url]'
  }
}

type Outcome<T> =
  | { kind: 'success'; data: T }
  | { kind: 'retry'; delayMs: number; reason: string }
  | { kind: 'fail'; error: ProviderHttpError }

/** Performs one JSON HTTP call with timeout + bounded retry. Throws `ProviderHttpError` on final failure. */
export async function fetchJson<T>(url: string, options: FetchJsonOptions): Promise<T> {
  const {
    method = 'GET',
    headers,
    body,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    baseDelayMs = DEFAULT_BASE_DELAY_MS,
    maxDelayMs = DEFAULT_MAX_DELAY_MS,
    provider,
    redactQueryParams,
  } = options
  const log = logger.child({ integration: provider })
  const sanitizedUrl = sanitizeUrlForLog(url, redactQueryParams)

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let outcome: Outcome<T> | undefined

    try {
      const response = await fetch(url, {
        method,
        headers: { 'content-type': 'application/json', ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      })

      if (response.ok) {
        const text = await response.text()
        outcome = { kind: 'success', data: (text ? JSON.parse(text) : undefined) as T }
      } else {
        const retryable = response.status === 429 || response.status >= 500
        const bodyText = await response.text().catch(() => '')
        const error = new ProviderHttpError(
          provider,
          response.status,
          `${provider} responded with HTTP ${response.status}`,
          retryable,
          { cause: bodyText.slice(0, 500) },
        )
        if (retryable && attempt < maxAttempts) {
          const retryAfter = retryAfterMs(response.headers.get('retry-after'))
          outcome = {
            kind: 'retry',
            delayMs: retryAfter ?? jitteredDelayMs(attempt, baseDelayMs, maxDelayMs),
            reason: `http_${response.status}`,
          }
        } else {
          outcome = { kind: 'fail', error }
        }
      }
    } catch (error) {
      const isAbort = error instanceof Error && error.name === 'AbortError'
      const httpError = new ProviderHttpError(
        provider,
        null,
        isAbort ? `${provider} request timed out after ${timeoutMs}ms` : `${provider} network error`,
        true,
        { cause: error },
      )
      if (attempt < maxAttempts) {
        outcome = {
          kind: 'retry',
          delayMs: jitteredDelayMs(attempt, baseDelayMs, maxDelayMs),
          reason: isAbort ? 'timeout' : 'network_error',
        }
      } else {
        outcome = { kind: 'fail', error: httpError }
      }
    } finally {
      clearTimeout(timer)
    }

    if (!outcome) {
      throw new ProviderHttpError(provider, null, `${provider} produced no outcome`, false)
    }
    if (outcome.kind === 'success') {
      log.debug('provider request succeeded', { provider, method, url: sanitizedUrl, attempt })
      return outcome.data
    }
    if (outcome.kind === 'fail') {
      log.error('provider request failed', {
        provider,
        method,
        url: sanitizedUrl,
        attempt,
        message: outcome.error.message,
      })
      throw outcome.error
    }
    log.warn('provider request retrying', {
      provider,
      method,
      url: sanitizedUrl,
      attempt,
      reason: outcome.reason,
      delayMs: Math.round(outcome.delayMs),
    })
    await sleep(outcome.delayMs)
  }

  throw new ProviderHttpError(provider, null, `${provider} exhausted retries`, false)
}
