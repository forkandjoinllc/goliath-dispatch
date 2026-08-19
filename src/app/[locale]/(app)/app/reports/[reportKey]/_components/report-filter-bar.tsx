'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { useTranslate } from '@/components/providers/i18n-provider'

export interface FilterFieldDescriptor {
  key: string
  kind: 'enum' | 'string' | 'uuid' | 'boolean'
  options?: string[]
}

const DATE_PRESETS = ['daily', 'weekly', 'monthly', 'yearly', 'custom'] as const

export interface ReportFilterBarProps {
  basePath: string
  supportsDateRange: boolean
  fields: FilterFieldDescriptor[]
  values: Record<string, string>
}

/**
 * URL-param-driven filter bar, generic across every report: the date-range
 * preset picker (common to any report with `supportsDateRange`) plus one
 * control per field `reportFilterFields()` found on the report's own filter
 * schema — an enum renders as a segmented picker, anything else as a text
 * input. There is no per-report filter component to maintain.
 */
export function ReportFilterBar({ basePath, supportsDateRange, fields, values }: ReportFilterBarProps) {
  const router = useRouter()
  const t = useTranslate()

  function pushParams(next: Record<string, string | undefined>) {
    const params = new URLSearchParams(values)
    for (const [key, value] of Object.entries(next)) {
      if (value === undefined || value === '') params.delete(key)
      else params.set(key, value)
    }
    router.push(`${basePath}?${params.toString()}`)
  }

  const preset = values.preset || 'monthly'

  return (
    <div className="flex flex-wrap items-end gap-4 rounded-lg border border-steel-200 bg-white p-4">
      {supportsDateRange ? (
        <div className="space-y-1.5">
          <Label>{t('report.filters.dateRange')}</Label>
          <div className="flex flex-wrap gap-1.5">
            {DATE_PRESETS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => pushParams({ preset: option })}
                aria-pressed={preset === option}
                className={
                  'rounded-full border px-3 py-1 text-xs font-semibold transition-colors ' +
                  (preset === option
                    ? 'border-navy-700 bg-navy-700 text-white'
                    : 'border-steel-300 bg-white text-steel-700 hover:bg-steel-50')
                }
              >
                {t(`report.filters.presets.${option}`)}
              </button>
            ))}
          </div>
          {preset === 'custom' ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Input
                type="date"
                aria-label={t('report.filters.start')}
                defaultValue={values.start ?? ''}
                onBlur={(event) => pushParams({ start: event.target.value })}
                className="w-40"
              />
              <span className="text-xs text-steel-500">{t('report.filters.to')}</span>
              <Input
                type="date"
                aria-label={t('report.filters.end')}
                defaultValue={values.end ?? ''}
                onBlur={(event) => pushParams({ end: event.target.value })}
                className="w-40"
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {fields.map((field) => (
        <div key={field.key} className="space-y-1.5">
          <Label>{t(`report.filters.fields.${field.key}`)}</Label>
          {field.kind === 'enum' && field.options ? (
            <div className="flex flex-wrap gap-1.5">
              {['', ...field.options].map((option) => (
                <button
                  key={option || 'all'}
                  type="button"
                  onClick={() => pushParams({ [field.key]: option })}
                  aria-pressed={(values[field.key] ?? '') === option}
                  className={
                    'rounded-full border px-3 py-1 text-xs font-semibold transition-colors ' +
                    ((values[field.key] ?? '') === option
                      ? 'border-navy-700 bg-navy-700 text-white'
                      : 'border-steel-300 bg-white text-steel-700 hover:bg-steel-50')
                  }
                >
                  {option ? t.optional(`report.filters.values.${option}`) || option : t('report.filters.all')}
                </button>
              ))}
            </div>
          ) : (
            <Input
              defaultValue={values[field.key] ?? ''}
              className="w-56"
              onKeyDown={(event) => {
                if (event.key === 'Enter') pushParams({ [field.key]: (event.target as HTMLInputElement).value })
              }}
            />
          )}
        </div>
      ))}

      <Button type="button" variant="secondary" onClick={() => router.push(basePath)}>
        {t('report.filters.reset')}
      </Button>
    </div>
  )
}
