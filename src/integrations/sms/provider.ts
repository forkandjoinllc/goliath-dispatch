import { AppError } from '@/lib/errors'

export interface SendSmsInput {
  to: string
  body: string
  idempotencyKey?: string
  /**
   * Whether SMS consent has been recorded for `to` on this record (driver,
   * customer contact, etc). There is no default — every call site must state
   * it explicitly so consent can never be silently assumed.
   */
  consentGranted: boolean
}

export interface SendSmsResult {
  providerMessageId: string
}

export interface SmsProvider {
  readonly name: string
  send(input: SendSmsInput): Promise<SendSmsResult>
}

/**
 * Every adapter's `send()` calls this first. Centralizing the guard means a
 * new adapter cannot ship without it — there is no code path to a carrier
 * SMS API that skips the consent check.
 */
export function assertSmsConsent(input: SendSmsInput): void {
  if (!input.consentGranted) {
    throw new AppError('validation_failed', 'integrations.sms.consentRequired', {
      detail: { to: input.to },
    })
  }
}
