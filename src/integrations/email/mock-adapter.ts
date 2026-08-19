import { newId } from '@/lib/crypto'
import { logger } from '@/lib/logger'
import type { EmailProvider, SendEmailInput, SendEmailResult } from './provider'

const PROVIDER_NAME = 'email.mock'

export interface OutboxMessage extends SendEmailInput {
  providerMessageId: string
  sentAt: Date
}

/**
 * In-memory outbox, keyed on `globalThis` rather than a plain module-level
 * `let` — Next.js app-router compiles this module separately for each
 * webpack "layer" it is pulled into (Server Actions vs. Route Handlers vs.
 * RSC), so a plain module-scope variable is NOT actually shared between,
 * say, a Server Action that sends an email and a Route Handler that reads
 * it back, even though both run in the same Node process. `globalThis` is
 * the one thing every layer's compiled copy of this module actually shares.
 */
const GLOBAL_KEY = Symbol.for('goliath.mockEmailOutbox')
type GlobalWithOutbox = typeof globalThis & { [GLOBAL_KEY]?: OutboxMessage[] }

function store(): OutboxMessage[] {
  const g = globalThis as GlobalWithOutbox
  if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = []
  return g[GLOBAL_KEY]
}

export function readOutbox(): readonly OutboxMessage[] {
  return store()
}

export function clearOutbox(): void {
  store().length = 0
}

export class MockEmailAdapter implements EmailProvider {
  readonly name = PROVIDER_NAME

  async send(input: SendEmailInput): Promise<SendEmailResult> {
    const providerMessageId = `mock-email-${newId()}`
    const message: OutboxMessage = { ...input, providerMessageId, sentAt: new Date() }
    store().push(message)

    const recipients = Array.isArray(input.to) ? input.to.length : 1
    logger.info('email mock: message recorded', {
      provider: PROVIDER_NAME,
      providerMessageId,
      recipients,
      subject: input.subject,
      tags: input.tags,
      attachmentCount: input.attachments?.length ?? 0,
    })

    return { providerMessageId }
  }
}
