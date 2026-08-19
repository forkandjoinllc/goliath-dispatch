/**
 * Live adapter for Mailgun, via the official `mailgun.js` + `form-data`
 * (both installed dependencies). Selected only when `EMAIL_DRIVER=mailgun`.
 *
 * Both SDKs are loaded with a dynamic `import()` on first send. A static import
 * would place Node-only dependencies in every bundle that transitively reaches
 * this file — including the Edge bundle Next builds for `instrumentation.ts` —
 * and break the build despite the runtime guard.
 */
import { serverEnv } from '@/lib/env'
import { logger } from '@/lib/logger'
import { mapProviderError, notConfiguredError } from '../_shared/errors'
import type { EmailProvider, SendEmailInput, SendEmailResult } from './provider'

type MailgunClient = Awaited<ReturnType<typeof loadMailgunClient>>

async function loadMailgunClient(apiKey: string, url: string) {
  const [{ default: FormData }, { default: Mailgun }] = await Promise.all([
    import('form-data'),
    import('mailgun.js'),
  ])
  const mailgun = new Mailgun(FormData)
  return mailgun.client({ username: 'api', key: apiKey, url })
}

const PROVIDER_NAME = 'email.mailgun'
const REGION_BASE_URL: Record<'us' | 'eu', string> = {
  us: 'https://api.mailgun.net',
  eu: 'https://api.eu.mailgun.net',
}

export class MailgunEmailAdapter implements EmailProvider {
  readonly name = PROVIDER_NAME

  private readonly domain: string
  private readonly from: string
  private readonly apiKey: string
  private readonly baseUrl: string
  private clientPromise: Promise<MailgunClient> | null = null

  constructor() {
    const env = serverEnv()
    if (!env.MAILGUN_API_KEY || !env.MAILGUN_DOMAIN) {
      throw notConfiguredError(PROVIDER_NAME, 'integrations.email.notConfigured')
    }
    this.domain = env.MAILGUN_DOMAIN
    this.from = env.EMAIL_FROM
    this.apiKey = env.MAILGUN_API_KEY
    this.baseUrl = REGION_BASE_URL[env.MAILGUN_REGION]
  }

  /** Memoized so the SDKs are loaded and the client constructed at most once. */
  private client(): Promise<MailgunClient> {
    this.clientPromise ??= loadMailgunClient(this.apiKey, this.baseUrl)
    return this.clientPromise
  }

  async send(input: SendEmailInput): Promise<SendEmailResult> {
    try {
      const client = await this.client()
      const response = await client.messages.create(this.domain, {
        from: this.from,
        to: input.to,
        subject: input.subject,
        html: input.html,
        text: input.text,
        'h:Reply-To': input.replyTo,
        'o:tag': input.tags,
        ...(input.idempotencyKey ? { 'h:X-Idempotency-Key': input.idempotencyKey } : {}),
        attachment: input.attachments?.map((a) => ({
          data: Buffer.from(a.content),
          filename: a.filename,
          contentType: a.contentType,
        })),
      })

      if (!response.id) {
        throw new Error(`Mailgun accepted the request but returned no message id (status ${response.status})`)
      }

      logger.info('mailgun: message accepted', {
        provider: PROVIDER_NAME,
        providerMessageId: response.id,
        recipients: Array.isArray(input.to) ? input.to.length : 1,
      })

      return { providerMessageId: response.id }
    } catch (error) {
      throw mapProviderError(PROVIDER_NAME, error, 'integrations.email.unavailable')
    }
  }
}
