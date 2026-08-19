/**
 * Live adapter for Twilio Programmable Messaging, via the official `twilio`
 * package (installed). Selected only when `SMS_DRIVER=twilio`.
 *
 * The SDK is loaded with a dynamic `import()` on first send rather than a
 * static one. Twilio pulls in `jsonwebtoken`, which requires Node's `crypto`
 * module; a static import would put that in every bundle that transitively
 * reaches this file — including the Edge runtime bundle Next builds for
 * `instrumentation.ts` — and fail the build even though the code is
 * runtime-guarded. Deferring the import keeps the Node-only dependency out of
 * the static module graph.
 */
import { serverEnv } from '@/lib/env'
import { logger } from '@/lib/logger'
import { mapProviderError, notConfiguredError } from '../_shared/errors'
import { assertSmsConsent, type SmsProvider, type SendSmsInput, type SendSmsResult } from './provider'
import { isE164Us, toE164Us } from './phone'

type TwilioClient = Awaited<ReturnType<typeof loadTwilioClient>>

/** Exists only to give the memoized client a name TypeScript can infer from. */
async function loadTwilioClient(accountSid: string, authToken: string) {
  const mod = await import('twilio')
  return (mod.default ?? mod)(accountSid, authToken)
}

const PROVIDER_NAME = 'sms.twilio'

export class TwilioSmsAdapter implements SmsProvider {
  readonly name = PROVIDER_NAME

  private readonly accountSid: string
  private readonly authToken: string
  private readonly messagingServiceSid?: string
  private readonly fromNumber?: string
  private clientPromise: Promise<TwilioClient> | null = null

  constructor() {
    const env = serverEnv()
    if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) {
      throw notConfiguredError(PROVIDER_NAME, 'integrations.sms.notConfigured')
    }
    if (!env.TWILIO_MESSAGING_SERVICE_SID && !env.TWILIO_FROM_NUMBER) {
      throw notConfiguredError(PROVIDER_NAME, 'integrations.sms.notConfigured')
    }
    this.accountSid = env.TWILIO_ACCOUNT_SID
    this.authToken = env.TWILIO_AUTH_TOKEN
    this.messagingServiceSid = env.TWILIO_MESSAGING_SERVICE_SID
    this.fromNumber = env.TWILIO_FROM_NUMBER
  }

  /** Memoized so the SDK is loaded and the client constructed at most once. */
  private client(): Promise<TwilioClient> {
    this.clientPromise ??= loadTwilioClient(this.accountSid, this.authToken)
    return this.clientPromise
  }

  async send(input: SendSmsInput): Promise<SendSmsResult> {
    assertSmsConsent(input)

    const to = isE164Us(input.to) ? input.to : toE164Us(input.to)
    if (!to) {
      throw mapProviderError(
        PROVIDER_NAME,
        new Error(`"${input.to}" is not a normalizable US phone number`),
        'integrations.sms.invalidNumber',
      )
    }

    try {
      const client = await this.client()
      const message = await client.messages.create({
        to,
        body: input.body,
        ...(this.messagingServiceSid
          ? { messagingServiceSid: this.messagingServiceSid }
          : { from: this.fromNumber }),
      })
      logger.info('twilio: message queued', { provider: PROVIDER_NAME, providerMessageId: message.sid })
      return { providerMessageId: message.sid }
    } catch (error) {
      throw mapProviderError(PROVIDER_NAME, error, 'integrations.sms.unavailable')
    }
  }
}
