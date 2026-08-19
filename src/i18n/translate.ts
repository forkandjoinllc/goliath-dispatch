import type { Dictionary, MessageTree } from './dictionary'
import { LOCALE_TAGS, type Locale } from './config'

/**
 * Translation and locale-aware formatting.
 *
 * Keys are dotted paths, `namespace.section.key`. Interpolation uses {token}.
 * A missing key returns the key itself and logs in development, which makes gaps
 * obvious in review rather than shipping a blank label.
 */

export type TranslateParams = Record<string, string | number | undefined | null>

export function resolveMessage(dictionary: Dictionary, key: string): string | null {
  const [namespace, ...rest] = key.split('.')
  if (!namespace) return null
  let node: MessageTree | string | undefined = dictionary[namespace]
  for (const segment of rest) {
    if (typeof node !== 'object' || node === null) return null
    node = node[segment]
  }
  return typeof node === 'string' ? node : null
}

/**
 * Matches one ICU MessageFormat `plural` clause: `{var, plural, one {...} other {...}}`.
 * Only the `one`/`other` categories are needed — the only two CLDR cardinal
 * categories either supported locale (`en`, `es`) ever selects — and branch
 * bodies are assumed not to contain nested `{}` (true of every message that
 * uses this today — `grep -rn ', plural,' src/i18n/messages` is the full
 * audited list: `customer.duplicates.description`,
 * `load.new.reviewStopsCount`, and `load.assignments.carrierNotCompliant` /
 * `blockingCount` / `warningCount`).
 */
const PLURAL_CLAUSE = /\{(\w+),\s*plural,\s*((?:\w+\s*\{[^{}]*\}\s*)+)\}/g
const PLURAL_BRANCH = /(\w+)\s*\{([^{}]*)\}/g

/**
 * Resolves every `{var, plural, one {...} other {...}}` clause in `template`
 * against `params[var]` before the plain `{token}` substitution below runs.
 * Without this, a message using ICU plural syntax rendered the raw pattern
 * (e.g. `{count, plural, one {# stop} other {# stops}}`) verbatim to users —
 * a real, previously-unnoticed bug hit by every message that used it
 * (`customer.duplicates.description`, `load.new.reviewStopsCount`,
 * `load.assignments.carrierNotCompliant`/`blockingCount`/`warningCount`).
 * `n === 1 ? 'one' : 'other'` is the correct CLDR cardinal rule for both
 * `en` and `es` (neither treats 0 specially), so this doesn't need
 * `Intl.PluralRules` to be correct for the locales this app ships.
 */
function resolvePlurals(template: string, params: TranslateParams): string {
  return template.replace(PLURAL_CLAUSE, (fullMatch, token: string, branchesSource: string) => {
    const rawCount = params[token]
    if (rawCount === undefined || rawCount === null) return fullMatch
    const count = Number(rawCount)
    if (Number.isNaN(count)) return fullMatch

    const branches: Record<string, string> = {}
    for (const [, category, body] of branchesSource.matchAll(PLURAL_BRANCH)) {
      if (category) branches[category] = body ?? ''
    }
    const category = count === 1 ? 'one' : 'other'
    const chosen = branches[category] ?? branches.other ?? ''
    return chosen.replace(/#/g, String(count))
  })
}

export function interpolate(template: string, params?: TranslateParams): string {
  if (!params) return template
  const withPlurals = resolvePlurals(template, params)
  return withPlurals.replace(/\{(\w+)\}/g, (match, token: string) => {
    const value = params[token]
    return value === undefined || value === null ? match : String(value)
  })
}

export type TranslateFn = ((key: string, params?: TranslateParams) => string) & {
  /** Returns null instead of the key when a message is absent. */
  optional: (key: string, params?: TranslateParams) => string | null
  has: (key: string) => boolean
  locale: Locale
}

export function createTranslator(dictionary: Dictionary, locale: Locale): TranslateFn {
  const translate = ((key: string, params?: TranslateParams) => {
    const message = resolveMessage(dictionary, key)
    if (message === null) {
      if (process.env.NODE_ENV === 'development') {
        console.warn(`[i18n] missing message "${key}" for locale "${locale}"`)
      }
      return key
    }
    return interpolate(message, params)
  }) as TranslateFn

  translate.optional = (key, params) => {
    const message = resolveMessage(dictionary, key)
    return message === null ? null : interpolate(message, params)
  }
  translate.has = (key) => resolveMessage(dictionary, key) !== null
  translate.locale = locale
  return translate
}

/* ── Formatting ──────────────────────────────────────────────────────────── */

/** USD only, from integer cents — never from a float. */
export function formatMoney(
  cents: number | null | undefined,
  locale: Locale,
  options: { showCents?: boolean } = {},
): string {
  const value = (cents ?? 0) / 100
  return new Intl.NumberFormat(LOCALE_TAGS[locale], {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: options.showCents === false ? 0 : 2,
    maximumFractionDigits: options.showCents === false ? 0 : 2,
  }).format(value)
}

/** Basis points → percentage string (1050 → "10.5%"). */
export function formatBps(bps: number | null | undefined, locale: Locale): string {
  return new Intl.NumberFormat(LOCALE_TAGS[locale], {
    style: 'percent',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format((bps ?? 0) / 10000)
}

export function formatNumber(
  value: number | null | undefined,
  locale: Locale,
  options?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(LOCALE_TAGS[locale], options).format(value ?? 0)
}

export function formatDate(
  value: Date | string | null | undefined,
  locale: Locale,
  timeZone: string,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'medium' },
): string {
  if (!value) return '—'
  const date = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat(LOCALE_TAGS[locale], { ...options, timeZone }).format(date)
}

export function formatDateTime(
  value: Date | string | null | undefined,
  locale: Locale,
  timeZone: string,
): string {
  return formatDate(value, locale, timeZone, { dateStyle: 'medium', timeStyle: 'short' })
}

/** Imperial length: inches rendered as feet + inches. */
export function formatInches(value: number | null | undefined, locale: Locale): string {
  if (value == null) return '—'
  const feet = Math.floor(value / 12)
  const inches = value % 12
  const nf = new Intl.NumberFormat(LOCALE_TAGS[locale])
  return inches === 0 ? `${nf.format(feet)}'` : `${nf.format(feet)}' ${nf.format(inches)}"`
}

export function formatPounds(value: number | null | undefined, locale: Locale): string {
  if (value == null) return '—'
  return `${new Intl.NumberFormat(LOCALE_TAGS[locale]).format(value)} lb`
}

export function formatMiles(value: number | null | undefined, locale: Locale): string {
  if (value == null) return '—'
  return `${new Intl.NumberFormat(LOCALE_TAGS[locale]).format(value)} mi`
}
