import { describe, expect, it } from 'vitest'
import { buildCsv, escapeCsvField, guardFormulaInjection, UTF8_BOM } from '@/server/exports/csv'
import type { ReportColumn } from '@/server/reports/types'

function fakeTranslate(key: string): string {
  const labels: Record<string, string> = {
    'report.columns.name': 'Name',
    'report.columns.amount': 'Amount',
  }
  return labels[key] ?? key
}
// Minimal stand-in matching the shape `buildCsv` calls (`t(key)`).
const t = Object.assign((key: string) => fakeTranslate(key), {
  optional: (key: string) => fakeTranslate(key),
  has: () => true,
  locale: 'en' as const,
})

describe('formula-injection guard', () => {
  it.each(['=SUM(A1:A2)', '+1+1', '-1+1', '@SUM(1)', '\ttabbed'])(
    'prefixes a leading quote onto a dangerous value: %s',
    (value) => {
      const guarded = guardFormulaInjection(value)
      expect(guarded.startsWith("'")).toBe(true)
      expect(guarded.slice(1)).toBe(value)
    },
  )

  it('leaves an ordinary value untouched', () => {
    expect(guardFormulaInjection('Acme Freight LLC')).toBe('Acme Freight LLC')
  })

  it('leaves an empty string untouched', () => {
    expect(guardFormulaInjection('')).toBe('')
  })
})

describe('RFC 4180 CSV field escaping', () => {
  it('does not quote a plain field', () => {
    expect(escapeCsvField('Acme Freight')).toBe('Acme Freight')
  })

  it('quotes and doubles internal quotes', () => {
    expect(escapeCsvField('Say "hello"')).toBe('"Say ""hello"""')
  })

  it('quotes a field containing a comma', () => {
    expect(escapeCsvField('Dallas, TX')).toBe('"Dallas, TX"')
  })

  it('quotes a field containing a newline', () => {
    expect(escapeCsvField('line one\nline two')).toBe('"line one\nline two"')
  })

  it('applies the formula guard before quoting', () => {
    expect(escapeCsvField('=1+1,2')).toBe(`"'=1+1,2"`)
  })
})

describe('buildCsv', () => {
  const columns: ReportColumn[] = [
    { key: 'name', labelKey: 'report.columns.name', type: 'string' },
    { key: 'amount', labelKey: 'report.columns.amount', type: 'currency', numeric: true },
  ]

  it('prepends a UTF-8 BOM so Excel renders accents correctly', () => {
    const csv = buildCsv(columns, [], 'en', t, 'America/New_York')
    expect(csv.startsWith(UTF8_BOM)).toBe(true)
  })

  it('renders a header row using translated labels', () => {
    const csv = buildCsv(columns, [], 'en', t, 'America/New_York')
    const [header] = csv.replace(UTF8_BOM, '').split('\r\n')
    expect(header).toBe('Name,Amount')
  })

  it('renders currency cells from integer cents', () => {
    const csv = buildCsv(columns, [{ name: 'Acme', amount: 150_000 }], 'en', t, 'America/New_York')
    expect(csv).toContain('Acme,"$1,500.00"')
  })

  it('formula-guards a customer name that looks like a formula', () => {
    const csv = buildCsv(columns, [{ name: '=cmd|calc', amount: 0 }], 'en', t, 'America/New_York')
    expect(csv).toContain(`'=cmd|calc,`)
    expect(csv).not.toContain('\r\n=cmd|calc')
  })
})
