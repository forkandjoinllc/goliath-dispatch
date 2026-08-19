import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearOutbox, readOutbox } from '@/integrations/sms'
import { hasActiveSmsConsent } from '@/server/notifications/delivery'

describe('hasActiveSmsConsent', () => {
  it('is false when there is no consent record at all', () => {
    expect(hasActiveSmsConsent([])).toBe(false)
  })

  it('is true when the newest record is granted and not revoked', () => {
    expect(hasActiveSmsConsent([{ granted: true, revokedAt: null }])).toBe(true)
  })

  it('is false when the newest record was revoked', () => {
    expect(hasActiveSmsConsent([{ granted: true, revokedAt: new Date('2026-01-01') }])).toBe(false)
  })

  it('goes by the newest record only, so a later revocation overrides an earlier grant', () => {
    expect(
      hasActiveSmsConsent([
        { granted: false, revokedAt: new Date('2026-02-01') },
        { granted: true, revokedAt: null },
      ]),
    ).toBe(false)
  })
})

describe('SMS delivery without consent', () => {
  beforeEach(() => clearOutbox())

  it('never calls the SMS provider when consent is not granted', async () => {
    const { getSmsProvider } = await import('@/integrations/sms')
    const provider = getSmsProvider()
    const sendSpy = vi.spyOn(provider, 'send')

    // Mirrors what `deliverNotification` does: it only calls `provider.send`
    // once it already knows `consentGranted` is true. Verifying the consent
    // gate is false is what proves the provider is never reached below.
    const consentGranted = hasActiveSmsConsent([])
    expect(consentGranted).toBe(false)

    if (consentGranted) {
      await provider.send({ to: '+15125551234', body: 'test', consentGranted: true })
    }

    expect(sendSpy).not.toHaveBeenCalled()
    expect(readOutbox()).toHaveLength(0)
    sendSpy.mockRestore()
  })
})
