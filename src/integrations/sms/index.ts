import { serverEnv } from '@/lib/env'
import type { SmsProvider } from './provider'
import { MockSmsAdapter } from './mock-adapter'
import { TwilioSmsAdapter } from './twilio-adapter'

let cached: SmsProvider | null = null

export function getSmsProvider(): SmsProvider {
  if (cached) return cached
  const driver = serverEnv().SMS_DRIVER
  cached = driver === 'twilio' ? new TwilioSmsAdapter() : new MockSmsAdapter()
  return cached
}

/** Test-only: clears the memoized provider so a test can flip the driver env var. */
export function resetSmsProviderCache(): void {
  cached = null
}

export type { SmsProvider, SendSmsInput, SendSmsResult } from './provider'
export { readOutbox, clearOutbox } from './mock-adapter'
export type { OutboxMessage } from './mock-adapter'
export { toE164Us, isE164Us } from './phone'
