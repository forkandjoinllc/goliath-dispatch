'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { useTranslate } from '@/components/providers/i18n-provider'

export interface AuditFilterBarProps {
  basePath: string
  actions: readonly string[]
  values: {
    action: string
    entityType: string
    requestId: string
    reasonPresent: string
    dateFrom: string
    dateTo: string
  }
}

export function AuditFilterBar({ basePath, actions, values }: AuditFilterBarProps) {
  const router = useRouter()
  const t = useTranslate()

  function pushParams(next: Record<string, string | undefined>) {
    const params = new URLSearchParams({ ...values, page: '1' })
    for (const [key, value] of Object.entries(next)) {
      if (value === undefined || value === '') params.delete(key)
      else params.set(key, value)
    }
    router.push(`${basePath}?${params.toString()}`)
  }

  return (
    <div className="flex flex-wrap items-end gap-4 rounded-lg border border-steel-200 bg-white p-4">
      <div className="space-y-1.5">
        <Label htmlFor="audit-action">{t('report.audit.filters.action')}</Label>
        <select
          id="audit-action"
          className="h-10 rounded-md border border-steel-300 bg-white px-3 text-sm"
          defaultValue={values.action}
          onChange={(event) => pushParams({ action: event.target.value })}
        >
          <option value="">{t('report.filters.all')}</option>
          {actions.map((action) => (
            <option key={action} value={action}>
              {action}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="audit-entity-type">{t('report.audit.filters.entityType')}</Label>
        <Input
          id="audit-entity-type"
          defaultValue={values.entityType}
          className="w-44"
          onKeyDown={(event) => {
            if (event.key === 'Enter') pushParams({ entityType: (event.target as HTMLInputElement).value })
          }}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="audit-request-id">{t('report.audit.filters.requestId')}</Label>
        <Input
          id="audit-request-id"
          defaultValue={values.requestId}
          className="w-56"
          onKeyDown={(event) => {
            if (event.key === 'Enter') pushParams({ requestId: (event.target as HTMLInputElement).value })
          }}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="audit-date-from">{t('report.audit.filters.from')}</Label>
        <Input
          id="audit-date-from"
          type="date"
          defaultValue={values.dateFrom}
          className="w-40"
          onChange={(event) => pushParams({ dateFrom: event.target.value })}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="audit-date-to">{t('report.audit.filters.to')}</Label>
        <Input
          id="audit-date-to"
          type="date"
          defaultValue={values.dateTo}
          className="w-40"
          onChange={(event) => pushParams({ dateTo: event.target.value })}
        />
      </div>

      <label className="flex items-center gap-2 pb-2 text-sm text-steel-700">
        <input
          type="checkbox"
          defaultChecked={values.reasonPresent === '1'}
          onChange={(event) => pushParams({ reasonPresent: event.target.checked ? '1' : undefined })}
        />
        {t('report.audit.filters.reasonPresent')}
      </label>

      <Button type="button" variant="secondary" onClick={() => router.push(basePath)}>
        {t('report.filters.reset')}
      </Button>
    </div>
  )
}
