import type { Locale } from '@/i18n/config'
import { formatDate, formatMoney, type TranslateFn } from '@/i18n/translate'
import type { ReportColumn } from '@/server/reports/types'

/**
 * Renders one report cell to a display string for CSV/XLSX/PDF export and
 * for the on-screen table. A string value that looks like an i18n key (the
 * reports emit `report.values.unassigned`, `report.values.expired`, etc. for
 * values that need translation rather than a raw DB string) is resolved
 * through the translator; anything else that resolves to nothing is shown
 * verbatim.
 */
export function formatCellValue(
  value: unknown,
  column: ReportColumn,
  locale: Locale,
  t: TranslateFn,
  timeZone: string,
): string {
  if (value === null || value === undefined) return ''

  if (typeof value === 'string' && value.startsWith('report.')) {
    const translated = t.optional(value)
    if (translated !== null) return translated
  }

  switch (column.type) {
    case 'currency':
      return formatMoney(Number(value), locale)
    case 'percent':
      return `${Number(value).toLocaleString(locale === 'es' ? 'es-US' : 'en-US', { maximumFractionDigits: 2 })}%`
    case 'bps':
      return `${(Number(value) / 100).toLocaleString(locale === 'es' ? 'es-US' : 'en-US', { maximumFractionDigits: 2 })}%`
    case 'date':
      return value instanceof Date ? formatDate(value, locale, timeZone) : String(value)
    case 'integer':
      return Number(value).toLocaleString(locale === 'es' ? 'es-US' : 'en-US')
    case 'string':
    default:
      return String(value)
  }
}
