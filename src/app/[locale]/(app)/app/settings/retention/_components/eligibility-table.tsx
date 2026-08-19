'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useTranslate } from '@/components/providers/i18n-provider'
import type { RetentionEligibilitySummary } from '@/server/retention/queries'

export function EligibilityTable({ rows }: { rows: RetentionEligibilitySummary[] }) {
  const t = useTranslate()

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.retention.eligibilityTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-steel-200 text-left text-xs font-semibold uppercase tracking-wide text-steel-500">
              <th className="py-2 pr-3">{t('settings.retention.columns.entityType')}</th>
              <th className="py-2 pr-3">{t('settings.retention.columns.classification')}</th>
              <th className="py-2 pr-3 text-right">{t('settings.retention.columns.total')}</th>
              <th className="py-2 pr-3 text-right">{t('settings.retention.columns.held')}</th>
              <th className="py-2 pr-3 text-right">{t('settings.retention.columns.archiveEligible')}</th>
              <th className="py-2 pr-3 text-right">{t('settings.retention.columns.purgeEligible')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.entityType} className="border-b border-steel-100">
                <td className="py-2 pr-3 font-mono text-xs">{row.entityType}</td>
                <td className="py-2 pr-3">
                  <Badge tone={row.classification === 'financial' ? 'navy' : 'neutral'}>
                    {t(`settings.retention.classification.${row.classification}`)}
                  </Badge>
                </td>
                <td className="tabular py-2 pr-3 text-right">{row.totalCount}</td>
                <td className="tabular py-2 pr-3 text-right">
                  {row.heldCount > 0 ? <Badge tone="warning">{row.heldCount}</Badge> : row.heldCount}
                </td>
                <td className="tabular py-2 pr-3 text-right">{row.archiveEligibleCount}</td>
                <td className="tabular py-2 pr-3 text-right">{row.purgeEligibleCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  )
}
