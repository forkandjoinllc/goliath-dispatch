import { describe, expect, it } from 'vitest'
import { checkForSpam, MIN_FORM_SECONDS } from '@/server/marketing/spam'

const NOW = Date.parse('2026-06-01T12:00:00Z')

describe('checkForSpam', () => {
  it('rejects a filled honeypot field', () => {
    const result = checkForSpam({ hpField: 'https://spam.example', renderedAt: NOW - 60_000 }, NOW)
    expect(result).toEqual({ isSpam: true, reason: 'honeypot' })
  })

  it('rejects a honeypot field with only whitespace trimmed to empty as clean', () => {
    // Whitespace-only counts as empty — a real visitor's browser autofill quirk
    // should not be punished the same as an actual bot-filled value.
    const result = checkForSpam({ hpField: '   ', renderedAt: NOW - 60_000 }, NOW)
    expect(result.isSpam).toBe(false)
  })

  it('rejects a submission faster than the minimum time on form', () => {
    const result = checkForSpam({ hpField: '', renderedAt: NOW - (MIN_FORM_SECONDS * 1000 - 500) }, NOW)
    expect(result).toEqual({ isSpam: true, reason: 'too_fast' })
  })

  it('rejects a renderedAt timestamp in the future', () => {
    const result = checkForSpam({ hpField: '', renderedAt: NOW + 5_000 }, NOW)
    expect(result).toEqual({ isSpam: true, reason: 'future_timestamp' })
  })

  it('accepts a clean, human-paced submission', () => {
    const result = checkForSpam({ hpField: '', renderedAt: NOW - (MIN_FORM_SECONDS * 1000 + 1000) }, NOW)
    expect(result).toEqual({ isSpam: false })
  })

  it('accepts a submission at exactly the minimum threshold', () => {
    const result = checkForSpam({ hpField: '', renderedAt: NOW - MIN_FORM_SECONDS * 1000 }, NOW)
    expect(result.isSpam).toBe(false)
  })
})
