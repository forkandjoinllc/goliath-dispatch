/**
 * Shared result envelope for every integration family.
 *
 * Every live and mock adapter returns normalized domain data wrapped in
 * `ProviderResult<T>`. Adapters never throw for an expected "the remote
 * system said no" outcome — that is `{ ok: false, error }`. Adapters DO throw
 * `AppError('integration_unavailable', …)` (see `./errors.ts`) for
 * configuration problems (missing credentials, SDK not installed) because
 * those are programming/deployment errors, not domain outcomes a caller
 * should branch on.
 *
 * `fetchedAt` + `cacheTtlSeconds` are the caching contract: this layer never
 * caches beyond an in-process memo where it is obviously safe (see
 * `geo/mock-adapter.ts` geocoding memo). Callers persist `data` alongside
 * `fetchedAt` and decide when `cacheTtlSeconds` has elapsed.
 */

export interface ProviderSuccess<T> {
  ok: true
  data: T
  provider: string
  fetchedAt: Date
  /** Opaque id/hash the source system gave us — for support/debugging, not display. */
  rawReference?: string
  /** How long the caller may treat `data` as fresh without re-fetching. */
  cacheTtlSeconds: number
}

export interface ProviderFailure {
  ok: false
  provider: string
  error: {
    code: string
    message: string
    retryable: boolean
  }
}

export type ProviderResult<T> = ProviderSuccess<T> | ProviderFailure

export function providerSuccess<T>(
  provider: string,
  data: T,
  options: { rawReference?: string; cacheTtlSeconds: number; fetchedAt?: Date } = {
    cacheTtlSeconds: 0,
  },
): ProviderSuccess<T> {
  return {
    ok: true,
    data,
    provider,
    fetchedAt: options.fetchedAt ?? new Date(),
    rawReference: options.rawReference,
    cacheTtlSeconds: options.cacheTtlSeconds,
  }
}

export function providerFailure(
  provider: string,
  error: { code: string; message: string; retryable: boolean },
): ProviderFailure {
  return { ok: false, provider, error }
}
