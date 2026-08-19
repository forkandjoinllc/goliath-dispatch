import { isValidVin, normalizeVin } from '@/lib/utils'

/**
 * Offline VIN decoding.
 *
 * This is deliberately *not* a call to NHTSA's vPIN service or any other
 * network provider — the product runs and its tests pass with no third-party
 * credentials (see `docs/architecture.md` §1), and a VIN decode is used here
 * only to pre-fill year/make/model on a new truck or trailer, never as a
 * compliance source of truth (the COI/VIN match in
 * `server/verification/equipment-verification.ts` is that source).
 *
 * Every function here is pure: no I/O, no database, no `server-only` import,
 * so it is safe to unit-test exhaustively and to call from a client-facing
 * "decode on blur" action without ceremony.
 */

export type VinDecodeSource = 'vin_decode'

export interface VinDecodeResult {
  /** True when the value is 17 characters drawn from the valid VIN alphabet. Says nothing about the check digit. */
  valid: boolean
  /** True when position 9 matches the value computed from positions 1–17. */
  checkDigitValid: boolean
  /** Model year decoded from position 10 (disambiguated by position 7). Null when undecodable. */
  year: number | null
  /** Manufacturer name for a recognized WMI. Null — never a guess — for an unrecognized one. */
  make: string | null
  /** The first three characters (World Manufacturer Identifier), when the input is long enough to have one. */
  wmi: string | null
  source: VinDecodeSource
}

/* ── Check digit ─────────────────────────────────────────────────────────── */

/**
 * NHTSA/SAE J853 transliteration table used to compute the VIN check digit.
 * I, O and Q are deliberately absent: they are not valid VIN characters, and
 * `normalizeVin` has already folded any mistyped occurrence to '0' before
 * this table is consulted.
 */
const CHECK_DIGIT_TRANSLITERATION: Record<string, number> = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
  J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
  S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
}

/** Position weights 1–17. Position 9 (the check digit itself) carries weight 0. */
const CHECK_DIGIT_WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2]

function transliterate(char: string): number | null {
  if (/^[0-9]$/.test(char)) return Number(char)
  return CHECK_DIGIT_TRANSLITERATION[char] ?? null
}

/**
 * Computes the expected check-digit character ('0'-'9' or 'X') for a
 * well-formed 17-character VIN. Returns null if any character falls outside
 * the transliteration table (which should not happen once `isValidVin` has
 * already passed, but this stays defensive rather than throwing).
 */
export function computeVinCheckDigit(vin17: string): string | null {
  if (vin17.length !== 17) return null

  let sum = 0
  for (let i = 0; i < 17; i += 1) {
    const value = transliterate(vin17[i]!)
    if (value === null) return null
    sum += value * CHECK_DIGIT_WEIGHTS[i]!
  }

  const remainder = sum % 11
  return remainder === 10 ? 'X' : String(remainder)
}

/* ── Model year ──────────────────────────────────────────────────────────── */

/**
 * Position 10 → model year, one tuple per code covering both 30-year cycles
 * this table can currently distinguish. The codes intentionally skip I, O, Q
 * (never valid), and also skip U, Z and the digit 0, which SAE J853 reserves
 * (Z and 0 to avoid confusion with 2 and O; U is unused pending a future
 * cycle).
 */
const MODEL_YEAR_CODES: Record<string, [cycle1980s: number, cycle2010s: number]> = {
  A: [1980, 2010], B: [1981, 2011], C: [1982, 2012], D: [1983, 2013], E: [1984, 2014],
  F: [1985, 2015], G: [1986, 2016], H: [1987, 2017], J: [1988, 2018], K: [1989, 2019],
  L: [1990, 2020], M: [1991, 2021], N: [1992, 2022], P: [1993, 2023], R: [1994, 2024],
  S: [1995, 2025], T: [1996, 2026], V: [1997, 2027], W: [1998, 2028], X: [1999, 2029],
  Y: [2000, 2030],
  '1': [2001, 2031], '2': [2002, 2032], '3': [2003, 2033], '4': [2004, 2034],
  '5': [2005, 2035], '6': [2006, 2036], '7': [2007, 2037], '8': [2008, 2038], '9': [2009, 2039],
}

/**
 * Decodes the model year from position 10, disambiguating the 30-year cycle
 * using position 7 — the convention NHTSA guidance adopted starting with the
 * 2010 model year: manufacturers use an alphabetic character in position 7
 * for 2010 and later, and a numeric character in position 7 for 1980–2009.
 */
export function decodeModelYear(vin17: string): number | null {
  if (vin17.length !== 17) return null
  const yearCode = vin17[9]!
  const cyclePositionChar = vin17[6]!
  const codes = MODEL_YEAR_CODES[yearCode]
  if (!codes) return null

  const isSecondCycle = /^[A-Z]$/.test(cyclePositionChar)
  return isSecondCycle ? codes[1] : codes[0]
}

/* ── WMI → manufacturer ──────────────────────────────────────────────────── */

/**
 * Best-effort World Manufacturer Identifier table covering the major North
 * American truck and trailer OEMs this product's tenants operate. This is
 * maintained by hand from public VIN-decoder references, not NHTSA's vPIC
 * database — it is used only to pre-fill a form field a dispatcher can
 * always overwrite, never as a compliance source of truth. A WMI absent from
 * this table returns `make: null`; it is never guessed at.
 */
const WMI_TABLE: Record<string, string> = {
  // Trucks (tractors / straight trucks)
  '1FU': 'Freightliner',
  '1FV': 'Freightliner',
  '3AK': 'Freightliner',
  '4UZ': 'Freightliner',
  '1XP': 'Peterbilt',
  '1XK': 'Kenworth',
  '2XK': 'Kenworth',
  '1XH': 'International (Navistar)',
  '1HT': 'International (Navistar)',
  '1HS': 'International (Navistar)',
  '1M1': 'Mack',
  '1M2': 'Mack',
  '2M1': 'Mack',
  '4V4': 'Volvo Trucks',
  '4VL': 'Volvo Trucks',
  '4VG': 'Volvo Trucks',
  '4VM': 'Volvo Trucks',
  '5KJ': 'Western Star',
  '2WL': 'Western Star',
  '5KK': 'Western Star',

  // Trailers
  '1GR': 'Great Dane',
  '4GR': 'Great Dane',
  '1UY': 'Utility Trailer',
  '5UY': 'Utility Trailer',
  '1JJ': 'Wabash National',
  '3UY': 'Wabash National',
  '1F9': 'Fontaine Trailer',
  '4F9': 'Fontaine Trailer',
  '1TK': 'Trail King',
  '1XL': 'XL Specialized Trailers',
  '1TF': 'Talbert Manufacturing',
  '1LZ': 'Landoll',
  '2M8': 'Manac',
  '2M9': 'Manac',
  '1D2': 'Doonan Trailer',
  '1W2': 'Wilson Trailer',
  '1R9': 'Reitnouer',
  '1MC': 'MAC Trailer Manufacturing',
  '1LK': 'Load King',
  '1DW': 'Dorsey Trailer',
}

export function lookupManufacturer(wmi: string): string | null {
  return WMI_TABLE[wmi.toUpperCase()] ?? null
}

/* ── Public entry point ──────────────────────────────────────────────────── */

/**
 * Decodes a (possibly loosely typed) VIN. Normalizes first — the same
 * normalization the COI/VIN compliance match uses — so decode results are
 * always computed against the value that will actually be persisted and
 * compared.
 */
export function decodeVin(rawVin: string): VinDecodeResult {
  const normalized = normalizeVin(rawVin ?? '')
  const wmi = normalized.length >= 3 ? normalized.slice(0, 3) : null
  const valid = isValidVin(normalized)

  if (!valid) {
    return { valid: false, checkDigitValid: false, year: null, make: null, wmi, source: 'vin_decode' }
  }

  const expectedCheckDigit = computeVinCheckDigit(normalized)
  const checkDigitValid = expectedCheckDigit !== null && expectedCheckDigit === normalized[8]

  return {
    valid: true,
    checkDigitValid,
    year: decodeModelYear(normalized),
    make: wmi ? lookupManufacturer(wmi) : null,
    wmi,
    source: 'vin_decode',
  }
}
