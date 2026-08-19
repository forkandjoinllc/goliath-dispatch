/**
 * Server-side spam defenses for public marketing forms.
 *
 * No third-party CAPTCHA: a honeypot field plus a minimum-time-on-form check,
 * layered with the IP rate limiter in `src/lib/rate-limit.ts`. All three run
 * inside the server action, never in the client — a bot that skips the
 * client bundle entirely still hits every check.
 */

/** Below this, a submission is almost certainly scripted, not typed by a human. */
export const MIN_FORM_SECONDS = 3

export interface AntiSpamFields {
  /** Must arrive empty. A filled honeypot means a bot populated every field it found. */
  hpField: string
  /** `Date.now()` captured when the form mounted on the client. */
  renderedAt: number
}

export interface SpamCheckResult {
  isSpam: boolean
  reason?: 'honeypot' | 'too_fast' | 'future_timestamp'
}

/**
 * `now` is injectable for tests; production callers omit it and get the
 * real clock.
 */
export function checkForSpam(fields: AntiSpamFields, now: number = Date.now()): SpamCheckResult {
  if (fields.hpField.trim().length > 0) {
    return { isSpam: true, reason: 'honeypot' }
  }

  const elapsedMs = now - fields.renderedAt
  if (elapsedMs < 0) {
    return { isSpam: true, reason: 'future_timestamp' }
  }
  if (elapsedMs < MIN_FORM_SECONDS * 1000) {
    return { isSpam: true, reason: 'too_fast' }
  }

  return { isSpam: false }
}
