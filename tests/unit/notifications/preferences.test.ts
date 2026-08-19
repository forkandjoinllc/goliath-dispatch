import { describe, expect, it } from 'vitest'
import { resolvePreferenceChannels } from '@/server/notifications/preferences'

describe('resolvePreferenceChannels', () => {
  it('falls back to the event default when the user has never set a preference', () => {
    const channels = resolvePreferenceChannels(['in_app', 'email'], null)
    expect(channels).toEqual(['in_app', 'email'])
  })

  it('honors a stored preference that narrows the channels', () => {
    const channels = resolvePreferenceChannels(['in_app', 'email', 'sms'], {
      inApp: true,
      email: false,
      sms: false,
    })
    expect(channels).toEqual(['in_app'])
  })

  it('honors a stored preference that adds sms even though it is not a default channel', () => {
    const channels = resolvePreferenceChannels(['in_app', 'email'], { inApp: true, email: true, sms: true })
    expect(channels).toEqual(['in_app', 'email', 'sms'])
  })

  it('can resolve to no channels at all when every flag is off', () => {
    const channels = resolvePreferenceChannels(['in_app', 'email'], { inApp: false, email: false, sms: false })
    expect(channels).toEqual([])
  })
})
