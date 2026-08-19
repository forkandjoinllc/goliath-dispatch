import { beforeEach, describe, expect, it } from 'vitest'
import { MockSmsAdapter, clearOutbox, readOutbox } from '@/integrations/sms/mock-adapter'
import { isE164Us, toE164Us } from '@/integrations/sms/phone'

describe('SMS consent guard', () => {
  beforeEach(() => clearOutbox())

  it('throws when consentGranted is false, before anything is sent', async () => {
    const adapter = new MockSmsAdapter()
    await expect(
      adapter.send({ to: '+15125551234', body: 'Your load has been dispatched.', consentGranted: false }),
    ).rejects.toThrow()
    expect(readOutbox()).toHaveLength(0)
  })

  it('sends and records the message when consent is granted', async () => {
    const adapter = new MockSmsAdapter()
    const result = await adapter.send({
      to: '(512) 555-1234',
      body: 'Your load has been dispatched.',
      consentGranted: true,
    })
    expect(result.providerMessageId).toMatch(/^mock-sms-/)
    const outbox = readOutbox()
    expect(outbox).toHaveLength(1)
    expect(outbox[0].to).toBe('+15125551234')
  })
})

describe('toE164Us / isE164Us', () => {
  it('normalizes a 10-digit US number', () => {
    expect(toE164Us('512-555-1234')).toBe('+15125551234')
  })

  it('normalizes an 11-digit number with a leading country code', () => {
    expect(toE164Us('15125551234')).toBe('+15125551234')
  })

  it('returns null for a number that cannot be normalized', () => {
    expect(toE164Us('12345')).toBeNull()
  })

  it('validates the E.164 US shape', () => {
    expect(isE164Us('+15125551234')).toBe(true)
    expect(isE164Us('5125551234')).toBe(false)
    expect(isE164Us('+1512555123')).toBe(false)
  })
})
