import { AppError, isAppError } from '@/lib/errors'
import { ProviderHttpError } from './http'

/**
 * Maps any adapter-level failure to the one error shape the rest of the app
 * understands. Never re-throws the raw provider error — `detail` carries
 * enough for logs, `messageKey` is what a user (translated) ever sees.
 */
export function mapProviderError(
  provider: string,
  error: unknown,
  messageKey = 'integrations.unavailable',
): AppError {
  if (isAppError(error)) return error

  if (error instanceof ProviderHttpError) {
    return new AppError('integration_unavailable', messageKey, {
      params: { provider },
      detail: { status: error.status, message: error.message, retryable: error.retryable },
      cause: error,
    })
  }

  return new AppError('integration_unavailable', messageKey, {
    params: { provider },
    detail: error instanceof Error ? { message: error.message } : { error: String(error) },
    cause: error,
  })
}

/** For adapters that are entirely unimplemented for this release, or a driver selected without credentials. */
export function notConfiguredError(provider: string, messageKey: string): AppError {
  return new AppError('integration_unavailable', messageKey, { params: { provider } })
}
