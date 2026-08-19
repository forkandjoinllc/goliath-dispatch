/**
 * Application error taxonomy.
 *
 * Messages here are safe to surface to users only through an i18n key —
 * `messageKey` — never as raw English. Internal detail stays in `detail`, which
 * is logged but never serialized to the client.
 */

export type AppErrorCode =
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'validation_failed'
  | 'conflict'
  | 'rate_limited'
  | 'compliance_blocked'
  | 'scheduling_conflict'
  | 'immutable'
  | 'integration_unavailable'
  | 'payment_failed'
  | 'internal'

const statusByCode: Record<AppErrorCode, number> = {
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  validation_failed: 422,
  conflict: 409,
  rate_limited: 429,
  compliance_blocked: 409,
  scheduling_conflict: 409,
  immutable: 409,
  integration_unavailable: 503,
  payment_failed: 402,
  internal: 500,
}

export class AppError extends Error {
  readonly code: AppErrorCode
  readonly messageKey: string
  readonly params: Record<string, string | number>
  readonly detail?: unknown
  readonly httpStatus: number

  constructor(
    code: AppErrorCode,
    messageKey: string,
    options: { params?: Record<string, string | number>; detail?: unknown; cause?: unknown } = {},
  ) {
    super(`${code}: ${messageKey}`, { cause: options.cause })
    this.name = 'AppError'
    this.code = code
    this.messageKey = messageKey
    this.params = options.params ?? {}
    this.detail = options.detail
    this.httpStatus = statusByCode[code]
  }

  /** Client-safe projection. Never includes `detail`. */
  toClient() {
    return { code: this.code, messageKey: this.messageKey, params: this.params }
  }
}

export const unauthenticated = (key = 'errors.unauthenticated') =>
  new AppError('unauthenticated', key)

export const forbidden = (key = 'errors.forbidden', params?: Record<string, string | number>) =>
  new AppError('forbidden', key, { params })

export const notFound = (key = 'errors.notFound', params?: Record<string, string | number>) =>
  new AppError('not_found', key, { params })

export const conflict = (key: string, params?: Record<string, string | number>) =>
  new AppError('conflict', key, { params })

export const validationFailed = (key = 'errors.validationFailed', detail?: unknown) =>
  new AppError('validation_failed', key, { detail })

export const complianceBlocked = (key: string, params?: Record<string, string | number>) =>
  new AppError('compliance_blocked', key, { params })

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError
}
