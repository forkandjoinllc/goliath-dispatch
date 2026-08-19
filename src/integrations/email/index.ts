import { serverEnv } from '@/lib/env'
import type { EmailProvider } from './provider'
import { MockEmailAdapter } from './mock-adapter'
import { MailgunEmailAdapter } from './mailgun-adapter'

let cached: EmailProvider | null = null

export function getEmailProvider(): EmailProvider {
  if (cached) return cached
  const driver = serverEnv().EMAIL_DRIVER
  cached = driver === 'mailgun' ? new MailgunEmailAdapter() : new MockEmailAdapter()
  return cached
}

/** Test-only: clears the memoized provider so a test can flip the driver env var. */
export function resetEmailProviderCache(): void {
  cached = null
}

export type { EmailProvider, SendEmailInput, SendEmailResult, EmailAttachment } from './provider'
export { readOutbox, clearOutbox } from './mock-adapter'
export type { OutboxMessage } from './mock-adapter'
export { renderEmailShell } from './templates'
export type { EmailBranding, EmailShellStrings, RenderEmailShellInput, RenderedEmail } from './templates'
