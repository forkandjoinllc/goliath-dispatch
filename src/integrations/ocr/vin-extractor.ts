import { isValidVin, normalizeVin } from '@/lib/utils'

/**
 * Pure VIN extraction from arbitrary OCR/plain text.
 *
 * VINs never contain I, O or Q (they are excluded from the character class
 * below, not filtered afterward), so a run that includes one of those
 * letters simply cannot form part of a match — no special-casing needed.
 *
 * Two passes:
 *  1. `UNSPLIT_VIN` — a clean, contiguous 17-character run, bounded on both
 *     sides by a non-alphanumeric character (or the start/end of the text).
 *     This boundary is what correctly rejects a 16-character run (too short
 *     to match) and an 18+-character run (the character immediately before
 *     or after any 17-length window inside it is still alphanumeric, so the
 *     boundary check fails everywhere).
 *  2. `SPLIT_VIN` — the same VIN written across a hard line wrap (with or
 *     without a hyphenation dash) or interrupted by a single literal hyphen
 *     on one line. Two alphanumeric runs on either side of the break are
 *     captured separately and accepted only when their lengths sum to
 *     exactly 17 — a coincidental short run before an unrelated line break
 *     won't be padded out to look like a VIN, and a long run that merely
 *     happens to precede a line break (e.g. an 18-char reference number) is
 *     rejected because the class match consumes it in full, leaving no
 *     legal split point at exactly 17.
 *
 * Deliberately NOT handled: an ordinary same-line space between two runs.
 * Treating bare whitespace as a VIN separator would make prose (two nearby
 * alphanumeric tokens whose lengths happen to sum to 17) match far too
 * often; hyphen and line-wrap are the two documented OCR failure modes this
 * targets.
 */

const VIN_CHAR_CLASS = 'A-HJ-NPR-Z0-9'

const UNSPLIT_VIN = new RegExp(`(?<![A-Z0-9])[${VIN_CHAR_CLASS}]{17}(?![A-Z0-9])`, 'gi')

const SPLIT_VIN = new RegExp(
  `(?<![A-Z0-9])([${VIN_CHAR_CLASS}]{1,16})(?:[ \\t]*-?[ \\t]*\\r?\\n[ \\t]*|[ \\t]*-[ \\t]*)([${VIN_CHAR_CLASS}]{1,16})(?![A-Z0-9])`,
  'gi',
)

export function extractVins(text: string): string[] {
  const found: string[] = []
  const seen = new Set<string>()

  const add = (raw: string) => {
    const normalized = normalizeVin(raw)
    if (normalized.length === 17 && isValidVin(normalized) && !seen.has(normalized)) {
      seen.add(normalized)
      found.push(normalized)
    }
  }

  for (const match of text.matchAll(UNSPLIT_VIN)) {
    add(match[0])
  }

  for (const match of text.matchAll(SPLIT_VIN)) {
    const first = match[1]
    const second = match[2]
    if (first.length + second.length === 17) {
      add(first + second)
    }
  }

  return found
}
