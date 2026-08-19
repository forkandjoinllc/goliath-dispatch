export interface EmailAttachment {
  filename: string
  contentType: string
  content: Uint8Array
}

export interface SendEmailInput {
  to: string | string[]
  subject: string
  html: string
  text: string
  replyTo?: string
  tags?: string[]
  attachments?: EmailAttachment[]
  /** Passed through to the provider where supported, to make retried sends safe. */
  idempotencyKey?: string
}

export interface SendEmailResult {
  providerMessageId: string
}

export interface EmailProvider {
  readonly name: string
  send(input: SendEmailInput): Promise<SendEmailResult>
}
