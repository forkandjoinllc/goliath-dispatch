import { describe, expect, it } from 'vitest'
import {
  feetInchesToInches,
  inchesToFeetInches,
  quoteFormSchema,
} from '@/server/marketing/schema'

describe('feetInchesToInches', () => {
  it('converts feet and inches to a total integer inches', () => {
    expect(feetInchesToInches({ feet: 8, inches: 6 })).toBe(102)
  })

  it('handles zero feet', () => {
    expect(feetInchesToInches({ feet: 0, inches: 11 })).toBe(11)
  })

  it('handles zero inches', () => {
    expect(feetInchesToInches({ feet: 13, inches: 0 })).toBe(156)
  })

  it('round-trips through inchesToFeetInches', () => {
    const value = { feet: 12, inches: 9 }
    const totalInches = feetInchesToInches(value)
    expect(inchesToFeetInches(totalInches)).toEqual(value)
  })
})

describe('quoteFormSchema dimension parsing', () => {
  const baseInput = {
    hpField: '',
    renderedAt: Date.now() - 10_000,
    contactName: 'Jane Dispatcher',
    email: 'jane@example.com',
    commodity: 'Transformer',
    weightPounds: 45000,
    length: { feet: 53, inches: 0 },
    width: { feet: 8, inches: 6 },
    height: { feet: 13, inches: 6 },
    originCity: 'Fort Worth',
    originState: 'TX',
    destinationCity: 'Denver',
    destinationState: 'CO',
    isOversizeSuspected: true,
    locale: 'en',
    consent: true,
  }

  it('parses feet+inches fields and converts them to integer inches via feetInchesToInches', () => {
    const parsed = quoteFormSchema.parse(baseInput)
    expect(feetInchesToInches(parsed.length)).toBe(636)
    expect(feetInchesToInches(parsed.width)).toBe(102)
    expect(feetInchesToInches(parsed.height)).toBe(162)
  })

  it('accepts feet/inches submitted as strings (as a native form field would send them)', () => {
    const parsed = quoteFormSchema.parse({
      ...baseInput,
      length: { feet: '53', inches: '0' },
      width: { feet: '8', inches: '6' },
    })
    expect(feetInchesToInches(parsed.length)).toBe(636)
    expect(feetInchesToInches(parsed.width)).toBe(102)
  })

  it('rejects an inches value of 12 or more (must roll over to feet)', () => {
    const result = quoteFormSchema.safeParse({ ...baseInput, length: { feet: 10, inches: 12 } })
    expect(result.success).toBe(false)
  })
})
