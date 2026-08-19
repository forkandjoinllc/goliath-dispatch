'use client'

import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/feedback'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useTranslate } from '@/components/providers/i18n-provider'
import { useI18n } from '@/components/providers/i18n-provider'
import { formatDate } from '@/i18n/translate'
import type { CarrierAssignmentHistoryRow } from '@/server/assignments/queries'

export function CarrierHistoryPanel({
  carrierOptions,
  selectedCarrierId,
  history,
}: {
  carrierOptions: { value: string; label: string }[]
  selectedCarrierId: string
  history: CarrierAssignmentHistoryRow[]
}) {
  const t = useTranslate()
  const { locale, timezone } = useI18n()
  const router = useRouter()

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-bold text-carbon">{t('assignment.history.title')}</h3>
        <p className="text-sm text-steel-600">{t('assignment.history.description')}</p>
      </div>

      <Select
        value={selectedCarrierId}
        onValueChange={(value) => router.push(`?carrierId=${value}`)}
      >
        <SelectTrigger className="w-64">
          <SelectValue placeholder={t('equipment.fields.carrier')} />
        </SelectTrigger>
        <SelectContent>
          {carrierOptions.map((c) => (
            <SelectItem key={c.value} value={c.value}>
              {c.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {!selectedCarrierId ? null : history.length === 0 ? (
        <EmptyState title={t('assignment.history.empty')} />
      ) : (
        <ul className="divide-y divide-steel-200 rounded-lg border border-steel-200">
          {history.map(({ assignment, dispatcherName }) => {
            const isCurrent = !assignment.endDate
            return (
              <li key={assignment.id} className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
                <div>
                  <p className="font-semibold text-carbon">
                    {dispatcherName}
                    {assignment.isPrimary ? (
                      <Badge tone="info" className="ml-2">
                        {t('assignment.history.primary')}
                      </Badge>
                    ) : null}
                    {isCurrent ? (
                      <Badge tone="success" className="ml-2">
                        {t('assignment.history.current')}
                      </Badge>
                    ) : null}
                  </p>
                  <p className="text-xs text-steel-500">
                    {t('assignment.history.startDate')}: {formatDate(assignment.startDate, locale, timezone)}
                    {assignment.endDate ? ` · ${t('assignment.history.endDate')}: ${formatDate(assignment.endDate, locale, timezone)}` : ''}
                  </p>
                  {assignment.reason ? <p className="text-xs text-steel-500">{assignment.reason}</p> : null}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
