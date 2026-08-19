import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import { buildXlsx } from '@/server/exports/xlsx'
import type { ReportColumn } from '@/server/reports/types'
import { createTranslator } from '@/i18n/translate'

const dictionary = {
  report: {
    columns: { carrierName: 'Carrier', grossRate: 'Gross rate', onTimeRate: 'On-time rate' },
  },
}
const t = createTranslator(dictionary as never, 'en')

const columns: ReportColumn[] = [
  { key: 'carrierName', labelKey: 'report.columns.carrierName', type: 'string' },
  { key: 'grossRate', labelKey: 'report.columns.grossRate', type: 'currency', numeric: true },
  { key: 'onTimeRate', labelKey: 'report.columns.onTimeRate', type: 'percent', numeric: true },
]

describe('buildXlsx currency formatting from integer cents', () => {
  it('writes currency cells as dollars (not cents) with a currency number format', async () => {
    const buffer = await buildXlsx(
      columns,
      [{ carrierName: 'Summit Heavy Haul', grossRate: 250_000, onTimeRate: 92.5 }],
      'en',
      t,
      'America/New_York',
      { generatedByEmail: 'ops@goliath.test', generatedAt: new Date('2026-01-01T00:00:00Z'), reportTitle: 'Carrier Scorecard', filters: {} },
    )

    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(buffer)
    const sheet = workbook.getWorksheet('Carrier Scorecard')!
    const dataRow = sheet.getRow(2)

    // 250_000 cents => $2,500.00, stored as the numeric dollar value 2500.
    expect(dataRow.getCell(2).value).toBe(2500)
    expect(dataRow.getCell(2).numFmt).toBe('"$"#,##0.00')

    // 92.5 (already a percentage) => stored as the Excel fraction 0.925.
    expect(dataRow.getCell(3).value).toBeCloseTo(0.925, 5)
    expect(dataRow.getCell(3).numFmt).toBe('0.00%')
  })

  it('freezes the header row and writes a metadata sheet recording who/when/filters', async () => {
    const buffer = await buildXlsx(columns, [], 'en', t, 'America/New_York', {
      generatedByEmail: 'ops@goliath.test',
      generatedAt: new Date('2026-01-01T00:00:00Z'),
      reportTitle: 'Carrier Scorecard',
      filters: { range: { preset: 'monthly' } },
    })

    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(buffer)
    const sheet = workbook.getWorksheet('Carrier Scorecard')!
    const view = sheet.views[0] as { state?: string; ySplit?: number } | undefined
    expect(view?.state).toBe('frozen')
    expect(view?.ySplit).toBe(1)

    const metaSheet = workbook.getWorksheet('Metadata')!
    const values = metaSheet.getColumn(2).values as unknown[]
    expect(values.some((v) => typeof v === 'string' && v.includes('ops@goliath.test'))).toBe(true)
    expect(values.some((v) => typeof v === 'string' && v.includes('monthly'))).toBe(true)
  })
})
