import { newId } from '@/lib/crypto'
import { logger } from '@/lib/logger'
import { assertSmsConsent, type SmsProvider, type SendSmsInput, type SendSmsResult } from './provider'
import { toE164Us } from './phone'

const PROVIDER_NAME = 'sms.mock'

export interface OutboxMessage {
  to: string
  body: string
  providerMessageId: string
  idempotencyKey?: string
  sentAt: Date
}

/**
 * Keyed on `globalThis` rather than a plain module-level `let` — see the
 * matching comment in `src/integrations/email/mock-adapter.ts` for why a
 * module-scope variable alone is not actually shared across Next.js
 * webpack layers within the same process.
 */
const GLOBAL_KEY = Symbol.for('goliath.mockSmsOutbox')
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

export class MockSmsAdapter implements SmsProvider {
  readonly name = PROVIDER_NAME

  async send(input: SendSmsInput): Promise<SendSmsResult> {
    assertSmsConsent(input)

    const providerMessageId = `mock-sms-${newId()}`
    const to = toE164Us(input.to) ?? input.to
    store().push({
      to,
      body: input.body,
      providerMessageId,
      idempotencyKey: input.idempotencyKey,
      sentAt: new Date(),
    })

    logger.info('sms mock: message recorded', { provider: PROVIDER_NAME, providerMessageId })
    return { providerMessageId }
  }
}
