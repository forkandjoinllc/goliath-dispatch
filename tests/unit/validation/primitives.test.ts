import { describe, expect, it } from 'vitest'
import {
  addressSchema,
  bpsSchema,
  dateRangeSchema,
  dotNumberSchema,
  einSchema,
  emailSchema,
  localeSchema,
  mcNumberSchema,
  moneyCentsSchema,
  paginationSchema,
  phoneSchema,
  postalCodeSchema,
  reasonSchema,
  usStateSchema,
  uuidSchema,
  vinSchema,
} from '@/lib/validation'

describe('dotNumberSchema', () => {
  it('accepts 5-8 digit DOT numbers', () => {
    expect(dotNumberSchema.parse('1000001')).toBe('1000001')
    expect(dotNumberSchema.parse('12345')).toBe('12345')
  })

  it('strips punctuation before validating', () => {
    expect(dotNumberSchema.parse(' 1-000-001 ')).toBe('1000001')
  })

  it('rejects too short or too long values with the i18n key', () => {
    const result = dotNumberSchema.safeParse('123')
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues[0]?.message).toBe('validation.dot')

    expect(dotNumberSchema.safeParse('123456789').success).toBe(false)
  })
})

describe('mcNumberSchema', () => {
  it('accepts 5-8 digits', () => {
    expect(mcNumberSchema.parse('500001')).toBe('500001')
  })

  it('rejects non-numeric-only garbage', () => {
    const result = mcNumberSchema.safeParse('abc')
    expect(result.success).toBe(false)
  })
})

describe('einSchema', () => {
  it('accepts 9 raw digits', () => {
    expect(einSchema.parse('123456789')).toBe('123456789')
  })

  it('accepts the XX-XXXXXXX display format', () => {
    expect(einSchema.parse('12-3456789')).toBe('123456789')
  })

  it('rejects the wrong digit count', () => {
    expect(einSchema.safeParse('12-345').success).toBe(false)
    const result = einSchema.safeParse('12-345')
    if (!result.success) expect(result.error.issues[0]?.message).toBe('validation.ein')
  })
})

describe('vinSchema', () => {
  it('accepts a valid 17-character VIN', () => {
    expect(vinSchema.parse('1FUJGLDR6LLJY0026')).toBe('1FUJGLDR6LLJY0026')
  })

  it('folds lowercase and O (read for 0) before validating', () => {
    // lowercase 'o' folds to '0', matching normalizeVin
    expect(vinSchema.parse('1FUJGLDR6LLJY0o26')).toBe('1FUJGLDR6LLJY0026')
  })

  it('never produces a folded VIN containing I, O or Q', () => {
    const folded = vinSchema.parse('1FUJGLDR6LLJY0o26')
    expect(folded).not.toMatch(/[IOQ]/)
  })

  it('rejects a value that is too short', () => {
    const result = vinSchema.safeParse('1FUJGLDR6LLJY00')
    expect(result.success).toBe(false)
  })

  it('rejects a value that is too long', () => {
    const result = vinSchema.safeParse('1FUJGLDR6LLJY002600')
    expect(result.success).toBe(false)
  })
})

describe('usStateSchema', () => {
  it('accepts a valid state code, case-insensitively', () => {
    expect(usStateSchema.parse('tx')).toBe('TX')
    expect(usStateSchema.parse('DC')).toBe('DC')
    expect(usStateSchema.parse('PR')).toBe('PR')
  })

  it('rejects an invalid code', () => {
    const result = usStateSchema.safeParse('ZZ')
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues[0]?.message).toBe('validation.state')
  })
})

describe('postalCodeSchema', () => {
  it('accepts 5 and 9 digit ZIPs', () => {
    expect(postalCodeSchema.parse('75001')).toBe('75001')
    expect(postalCodeSchema.parse('75001-1234')).toBe('75001-1234')
  })

  it('rejects malformed codes', () => {
    expect(postalCodeSchema.safeParse('750011234').success).toBe(false)
    expect(postalCodeSchema.safeParse('ABCDE').success).toBe(false)
  })
})

describe('phoneSchema', () => {
  it('normalizes to 10 digits', () => {
    expect(phoneSchema.parse('(214) 555-0100')).toBe('2145550100')
    expect(phoneSchema.parse('+1 214 555 0100')).toBe('2145550100')
  })

  it('rejects a number with too few digits to normalize', () => {
    expect(phoneSchema.safeParse('555-01').success).toBe(false)
  })
})

describe('emailSchema', () => {
  it('lowercases and trims', () => {
    expect(emailSchema.parse('  Dispatch@Example.COM ')).toBe('dispatch@example.com')
  })

  it('rejects an invalid address', () => {
    expect(emailSchema.safeParse('not-an-email').success).toBe(false)
  })
})

describe('moneyCentsSchema', () => {
  it('accepts a non-negative integer', () => {
    expect(moneyCentsSchema.parse(150_000)).toBe(150_000)
    expect(moneyCentsSchema.parse(0)).toBe(0)
  })

  it('rejects negative and non-integer values', () => {
    expect(moneyCentsSchema.safeParse(-1).success).toBe(false)
    expect(moneyCentsSchema.safeParse(10.5).success).toBe(false)
  })
})

describe('bpsSchema', () => {
  it('accepts the full 0-10000 range', () => {
    expect(bpsSchema.parse(0)).toBe(0)
    expect(bpsSchema.parse(10_000)).toBe(10_000)
    expect(bpsSchema.parse(1_000)).toBe(1_000)
  })

  it('rejects out-of-range values', () => {
    expect(bpsSchema.safeParse(-1).success).toBe(false)
    expect(bpsSchema.safeParse(10_001).success).toBe(false)
  })
})

describe('addressSchema', () => {
  it('accepts a well-formed US address', () => {
    const result = addressSchema.parse({
      line1: '123 Main St',
      city: 'Dallas',
      state: 'tx',
      postalCode: '75201',
      country: 'US',
    })
    expect(result.state).toBe('TX')
  })

  it('rejects a missing required field', () => {
    const result = addressSchema.safeParse({
      line1: '',
      city: 'Dallas',
      state: 'TX',
      postalCode: '75201',
    })
    expect(result.success).toBe(false)
  })
})

describe('localeSchema', () => {
  it('accepts en and es only', () => {
    expect(localeSchema.parse('en')).toBe('en')
    expect(localeSchema.parse('es')).toBe('es')
    expect(localeSchema.safeParse('fr').success).toBe(false)
  })
})

describe('uuidSchema', () => {
  it('accepts a valid uuid', () => {
    expect(uuidSchema.parse('11111111-1111-4111-8111-111111111111')).toBe(
      '11111111-1111-4111-8111-111111111111',
    )
  })

  it('rejects a non-uuid', () => {
    expect(uuidSchema.safeParse('not-a-uuid').success).toBe(false)
  })
})

describe('reasonSchema', () => {
  it('requires at least 10 characters', () => {
    expect(reasonSchema.safeParse('too short').success).toBe(false)
    expect(reasonSchema.parse('This is a sufficiently long reason.')).toBe(
      'This is a sufficiently long reason.',
    )
  })
})

describe('paginationSchema', () => {
  it('defaults page and pageSize', () => {
    expect(paginationSchema.parse({})).toEqual({ page: 1, pageSize: 25 })
  })

  it('rejects an oversized page', () => {
    expect(paginationSchema.safeParse({ pageSize: 500 }).success).toBe(false)
  })
})

describe('dateRangeSchema', () => {
  it('accepts an end after the start', () => {
    const result = dateRangeSchema.parse({ start: '2026-01-01', end: '2026-01-02' })
    expect(result.end.getTime()).toBeGreaterThan(result.start.getTime())
  })

  it('rejects an end before or equal to the start', () => {
    expect(dateRangeSchema.safeParse({ start: '2026-01-02', end: '2026-01-01' }).success).toBe(false)
    expect(dateRangeSchema.safeParse({ start: '2026-01-01', end: '2026-01-01' }).success).toBe(false)
  })
})
