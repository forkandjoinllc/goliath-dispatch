import { describe, expect, it } from 'vitest'
import en from '@/i18n/messages/en/marketing.json'
import es from '@/i18n/messages/es/marketing.json'

/**
 * Guards against a half-translated marketing page: every dotted key present
 * in the English dictionary must exist in the Spanish one, and vice versa.
 * `getDictionary()` (`src/i18n/dictionary.ts`) silently falls back to
 * English for a missing Spanish key, so a gap here would ship invisibly
 * rather than fail loudly — this test is what makes it fail loudly instead.
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

describe('marketing.json en/es key parity', () => {
  const enKeys = collectKeys(en).sort()
  const esKeys = collectKeys(es).sort()

  it('has at least the expected top-level sections', () => {
    for (const section of ['meta', 'seo', 'header', 'footer', 'forms', 'notifications', 'home', 'services', 'heavyHaul', 'forCarriers', 'forClients', 'about', 'contact', 'resources', 'carrierSignup', 'privacy', 'terms']) {
      expect(en).toHaveProperty(section)
      expect(es).toHaveProperty(section)
    }
  })

  it('every English key exists in Spanish', () => {
    const missing = enKeys.filter((key) => !esKeys.includes(key))
    expect(missing).toEqual([])
  })

  it('every Spanish key exists in English', () => {
    const missing = esKeys.filter((key) => !enKeys.includes(key))
    expect(missing).toEqual([])
  })

  it('has a non-trivial number of translated strings', () => {
    // A loose floor, not an exact count — it exists so a future accidental
    // truncation of the file (e.g. a bad merge) fails obviously.
    expect(enKeys.length).toBeGreaterThan(200)
  })

  it('has no empty string values in either locale', () => {
    const emptyInEn = enKeys.filter((key) => resolveKey(en, key) === '')
    const emptyInEs = esKeys.filter((key) => resolveKey(es, key) === '')
    expect(emptyInEn).toEqual([])
    expect(emptyInEs).toEqual([])
  })
})

function resolveKey(node: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, segment) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[segment]
    return undefined
  }, node)
}
