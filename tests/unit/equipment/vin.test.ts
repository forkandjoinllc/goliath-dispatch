import { describe, expect, it } from 'vitest'
import { normalizeVin } from '@/lib/utils'
import { computeVinCheckDigit, decodeModelYear, decodeVin, lookupManufacturer } from '@/server/equipment/vin'

/**
 * "1M8GDM9AXKP042788" is the canonical worked example used to teach the VIN
 * check-digit algorithm (position 9 = 'X', matching a sum-of-products
 * remainder of 10). It is not a truck/trailer WMI, so it is used here only to
 * validate the check-digit and model-year math in isolation from the WMI
 * table.
 */
const KNOWN_GOOD_VIN = '1M8GDM9AXKP042788'

describe('computeVinCheckDigit', () => {
  it('computes the correct check digit for a known-good VIN', () => {
    expect(computeVinCheckDigit(KNOWN_GOOD_VIN)).toBe('X')
  })

  it('returns null for a VIN of the wrong length', () => {
    expect(computeVinCheckDigit('1M8GDM9AXKP04278')).toBeNull()
  })
})

describe('decodeVin — check digit validation', () => {
  it('accepts a valid, unmodified VIN', () => {
    const result = decodeVin(KNOWN_GOOD_VIN)
    expect(result.valid).toBe(true)
    expect(result.checkDigitValid).toBe(true)
    expect(result.source).toBe('vin_decode')
  })

  it('rejects the same VIN once the check digit is deliberately corrupted', () => {
    const corrupted = `${KNOWN_GOOD_VIN.slice(0, 8)}0${KNOWN_GOOD_VIN.slice(9)}`
    expect(corrupted).toHaveLength(17)
    const result = decodeVin(corrupted)
    expect(result.valid).toBe(true) // still 17 well-formed characters
    expect(result.checkDigitValid).toBe(false)
  })

  it('rejects a corrupted VIN even when a different character is changed', () => {
    const corrupted = `${KNOWN_GOOD_VIN.slice(0, 3)}Z${KNOWN_GOOD_VIN.slice(4)}`
    const result = decodeVin(corrupted)
    expect(result.checkDigitValid).toBe(false)
  })

  it('flags an out-of-length VIN as structurally invalid', () => {
    const result = decodeVin('1M8GDM9AXKP04278')
    expect(result.valid).toBe(false)
    expect(result.checkDigitValid).toBe(false)
    expect(result.year).toBeNull()
    expect(result.make).toBeNull()
  })
})

describe('decodeModelYear — 30-year cycle boundary', () => {
  it('decodes the 1980s cycle when position 7 is numeric', () => {
    // Position 10 = 'A', position 7 = '9' (numeric) => 1980s cycle => 1980.
    const vin = `${KNOWN_GOOD_VIN.slice(0, 6)}9${KNOWN_GOOD_VIN.slice(7, 9)}A${KNOWN_GOOD_VIN.slice(10)}`
    expect(vin).toHaveLength(17)
    expect(vin[6]).toBe('9')
    expect(vin[9]).toBe('A')
    expect(decodeModelYear(vin)).toBe(1980)
  })

  it('decodes the 2010s cycle when position 7 is alphabetic', () => {
    // Same position-10 code 'A', but position 7 is now a letter => 2010s cycle => 2010.
    const vin = `${KNOWN_GOOD_VIN.slice(0, 6)}G${KNOWN_GOOD_VIN.slice(7, 9)}A${KNOWN_GOOD_VIN.slice(10)}`
    expect(vin).toHaveLength(17)
    expect(vin[6]).toBe('G')
    expect(vin[9]).toBe('A')
    expect(decodeModelYear(vin)).toBe(2010)
  })

  it('returns null for a year code the table does not recognize (e.g. folded 0)', () => {
    const vin = `${KNOWN_GOOD_VIN.slice(0, 9)}0${KNOWN_GOOD_VIN.slice(10)}`
    expect(decodeModelYear(vin)).toBeNull()
  })
})

describe('lookupManufacturer / WMI table', () => {
  it('resolves a known truck WMI', () => {
    expect(lookupManufacturer('1FU')).toBe('Freightliner')
    expect(lookupManufacturer('1XP')).toBe('Peterbilt')
    expect(lookupManufacturer('1M1')).toBe('Mack')
  })

  it('resolves a known trailer WMI', () => {
    expect(lookupManufacturer('1GR')).toBe('Great Dane')
    expect(lookupManufacturer('1UY')).toBe('Utility Trailer')
  })

  it('returns null — never a guess — for an unrecognized WMI', () => {
    expect(lookupManufacturer('ZZZ')).toBeNull()
    expect(lookupManufacturer('9XQ')).toBeNull()
  })

  it('is case-insensitive', () => {
    expect(lookupManufacturer('1fu')).toBe('Freightliner')
  })
})

describe('decodeVin — WMI passthrough', () => {
  it('returns the WMI and null make for an unrecognized manufacturer prefix, even on a structurally valid VIN', () => {
    const result = decodeVin(KNOWN_GOOD_VIN)
    expect(result.wmi).toBe('1M8')
    expect(result.make).toBeNull()
  })
})

describe('normalizeVin folding of I/O/Q', () => {
  it('folds I and O to 0, and Q to 0', () => {
    expect(normalizeVin('1O8GDM9AXKP04278I')).toBe('108GDM9AXKP042780')
    expect(normalizeVin('1Q8GDM9AXKP04278Q')).toBe('108GDM9AXKP042780')
  })

  it('uppercases and strips punctuation before folding', () => {
    expect(normalizeVin('1m8-gdm9-axkp-04278o')).toBe('1M8GDM9AXKP042780')
  })

  it('is idempotent on an already-normalized VIN', () => {
    expect(normalizeVin(KNOWN_GOOD_VIN)).toBe(KNOWN_GOOD_VIN)
  })
})
