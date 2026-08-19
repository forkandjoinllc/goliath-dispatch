import { describe, expect, it } from 'vitest'
import { NAMESPACES } from '@/i18n/namespaces'
import type { MessageTree } from '@/i18n/dictionary'

/**
 * Namespace-wide i18n parity guard.
 *
 * For every namespace registered in `src/i18n/namespaces.ts`, this asserts:
 *  1. The `en` and `es` key sets are identical (dotted-path diff reported on
 *     failure, both directions).
 *  2. No value is an empty string in either locale.
 *  3. No `es` value is byte-identical to its `en` counterpart, unless the key
 *     or the shared value is on the allow-list below (proper nouns, units,
 *     acronyms, numbers, and other strings that are legitimately the same in
 *     both languages). This is what catches a namespace someone copied and
 *     forgot to translate.
 *
 * `getDictionary()` (`src/i18n/dictionary.ts`) silently falls back to English
 * for a missing Spanish key, so a gap here would otherwise ship invisibly —
 * this test is what makes it fail loudly instead.
 */

function collectKeys(node: unknown, prefix = ''): string[] {
  if (typeof node === 'string') return [prefix]
  if (node && typeof node === 'object') {
    return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
      collectKeys(value, prefix ? `${prefix}.${key}` : key),
    )
  }
  return []
}

function resolveKey(node: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, segment) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[segment]
    return undefined
  }, node)
}

/**
 * Values that are legitimately identical between English and Spanish:
 * proper nouns, acronyms/initialisms used as-is in US trucking Spanish,
 * units, and standalone numerals/punctuation. Matched against the *whole*
 * trimmed value (case-sensitive) so a sentence merely containing "DOT"
 * still has to be translated.
 */
const ALLOWED_IDENTICAL_VALUES = new Set<string>([
  'OK',
  'DOT',
  'VIN',
  'PDF',
  'CSV',
  'MC',
  'USD',
  'USDOT',
  'API',
  'SMS',
  'ELD',
  'GPS',
  'EIN',
  'W-9',
  'W9',
  'ACH',
  'ID',
  'URL',
  'FMCSA',
  'CDL',
  'IFTA',
  'BOL',
  'POD',
  'AM',
  'PM',
  'N/A',
  '—',
  '-',
  '$',
  '%',
  '#',
  'Goliath Dispatch',
  'Goliath',
  // Genuine Spanish/English cognates commonly used unchanged in professional
  // US-trucking business Spanish — not machine-literal calques.
  'Total',
  'Subtotal',
  'No',
  'Plan',
  'Legal',
  'Interior',
  'Manual',
  'Actor',
  'Excel',
  'Webhook',
  'Ext.',
])

/** Bare unit/abbreviation tokens that are identical in both languages once
 * interpolation placeholders are stripped out (e.g. "{minutes} min"). */
const ALLOWED_UNIT_TOKENS = new Set(['min', 'mi', 'h', 'm', 's', 'lb', 'kg', 'ft', 'in'])

/** Keys whose value is allowed to be identical regardless of content (e.g. brand names, codes). */
const ALLOWED_IDENTICAL_KEY_SUFFIXES = [
  'currencyCode',
  'countryCode',
  'stateCode',
]

function isAllowedIdentical(key: string, value: string): boolean {
  const trimmed = value.trim()
  if (ALLOWED_IDENTICAL_VALUES.has(trimmed)) return true
  if (ALLOWED_IDENTICAL_KEY_SUFFIXES.some((suffix) => key.endsWith(suffix))) return true

  // Strip interpolation placeholders ({token}) before judging translatability —
  // a template like "{from} → {to}" or "{minutes} min" carries no words that
  // need translating once the placeholders are removed.
  const withoutPlaceholders = trimmed.replace(/\{\w+\}/g, ' ').trim()

  // Nothing left but symbols/whitespace (e.g. "{from} → {to}").
  if (!/\p{L}/u.test(withoutPlaceholders)) return true

  // Every remaining letter-run is a known identical unit/abbreviation token,
  // or itself a whole allowed value (e.g. "{minutes} min", "{hours}h
  // {minutes}m", "DOT / MC").
  const words = withoutPlaceholders.match(/\p{L}+/gu) ?? []
  if (
    words.length > 0 &&
    words.every((word) => ALLOWED_UNIT_TOKENS.has(word) || ALLOWED_IDENTICAL_VALUES.has(word))
  ) {
    return true
  }

  return false
}

describe('i18n namespace key parity (en/es)', () => {
  for (const namespace of NAMESPACES) {
    describe(`namespace: ${namespace}`, () => {
      let en: MessageTree
      let es: MessageTree

      it('loads both locale files', async () => {
        en = ((await import(`@/i18n/messages/en/${namespace}.json`)) as { default: MessageTree })
          .default
        es = ((await import(`@/i18n/messages/es/${namespace}.json`)) as { default: MessageTree })
          .default
        expect(en).toBeTruthy()
        expect(es).toBeTruthy()
      })

      it('has identical key sets in en and es', async () => {
        const enMod = (await import(`@/i18n/messages/en/${namespace}.json`)) as {
          default: MessageTree
        }
        const esMod = (await import(`@/i18n/messages/es/${namespace}.json`)) as {
          default: MessageTree
        }
        const enKeys = collectKeys(enMod.default).sort()
        const esKeys = collectKeys(esMod.default).sort()

        const missingInEs = enKeys.filter((key) => !esKeys.includes(key))
        const missingInEn = esKeys.filter((key) => !enKeys.includes(key))

        expect(
          missingInEs,
          `Keys present in en/${namespace}.json but missing from es/${namespace}.json:\n${missingInEs.join('\n')}`,
        ).toEqual([])
        expect(
          missingInEn,
          `Keys present in es/${namespace}.json but missing from en/${namespace}.json:\n${missingInEn.join('\n')}`,
        ).toEqual([])
      })

      it('has no empty string values', async () => {
        const enMod = (await import(`@/i18n/messages/en/${namespace}.json`)) as {
          default: MessageTree
        }
        const esMod = (await import(`@/i18n/messages/es/${namespace}.json`)) as {
          default: MessageTree
        }
        const enKeys = collectKeys(enMod.default)
        const esKeys = collectKeys(esMod.default)

        const emptyInEn = enKeys.filter((key) => resolveKey(enMod.default, key) === '')
        const emptyInEs = esKeys.filter((key) => resolveKey(esMod.default, key) === '')

        expect(emptyInEn, `Empty string values in en/${namespace}.json:\n${emptyInEn.join('\n')}`).toEqual([])
        expect(emptyInEs, `Empty string values in es/${namespace}.json:\n${emptyInEs.join('\n')}`).toEqual([])
      })

      it('has no un-translated (byte-identical) es values outside the allow-list', async () => {
        const enMod = (await import(`@/i18n/messages/en/${namespace}.json`)) as {
          default: MessageTree
        }
        const esMod = (await import(`@/i18n/messages/es/${namespace}.json`)) as {
          default: MessageTree
        }
        const enKeys = collectKeys(enMod.default)

        const untranslated = enKeys.filter((key) => {
          const enValue = resolveKey(enMod.default, key)
          const esValue = resolveKey(esMod.default, key)
          if (typeof enValue !== 'string' || typeof esValue !== 'string') return false
          if (enValue !== esValue) return false
          return !isAllowedIdentical(key, enValue)
        })

        expect(
          untranslated,
          `es values byte-identical to en in ${namespace} (likely un-translated):\n${untranslated
            .map((key) => `${key}: "${resolveKey(enMod.default, key)}"`)
            .join('\n')}`,
        ).toEqual([])
      })
    })
  }
})
