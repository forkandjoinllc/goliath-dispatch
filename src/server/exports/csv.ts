import type { ReportColumn } from '@/server/reports/types'
import type { Locale } from '@/i18n/config'
import type { TranslateFn } from '@/i18n/translate'
import { formatCellValue } from './format'

/**
 * CSV generation.
 *
 * RFC 4180: fields containing a comma, double quote or newline are wrapped in
 * double quotes, with internal double quotes doubled. A UTF-8 BOM is
 * prepended so Excel on Windows renders Spanish accents (á, é, ñ, …)
 * correctly instead of guessing a Latin-1 codepage.
 *
 * Formula-injection guard: a cell whose first character is `=`, `+`, `-` or
 * `@` is interpreted as a formula by Excel/Sheets/LibreOffice when the CSV is
 * opened, which is a known exfiltration vector for exported user data (e.g. a
 * customer name of `=HYPERLINK(...)`). Every such value is prefixed with a
 * single quote, which both tools render as literal text.
 */

const FORMULA_PREFIX_CHARS = new Set(['=', '+', '-', '@', '\t', '\r'])

export function guardFormulaInjection(value: string): string {
  if (value.length === 0) return value
  return FORMULA_PREFIX_CHARS.has(value[0]!) ? `'${value}` : value
}

export function escapeCsvField(rawValue: string): string {
  const guarded = guardFormulaInjection(rawValue)
  const needsQuoting = /[",\n\r]/.test(guarded)
  if (!needsQuoting) return guarded
  return `"${guarded.replace(/"/g, '""')}"`
}

export const UTF8_BOM = '﻿'

export function buildCsv(
  columns: ReportColumn[],
  rows: Array<Record<string, unknown>>,
  locale: Locale,
  t: TranslateFn,
  timeZone: string,
): string {
  const header = columns.map((c) => escapeCsvField(t(c.labelKey))).join(',')
  const lines = rows.map((row) =>
    columns
      .map((column) => escapeCsvField(formatCellValue(row[column.key], column, locale, t, timeZone)))
      .join(','),
  )
  return UTF8_BOM + [header, ...lines].join('\r\n') + '\r\n'
}
