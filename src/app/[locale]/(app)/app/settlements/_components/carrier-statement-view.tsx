'use client'

import { ScrollText } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/feedback'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { PageHeader } from '@/components/shell/page-header'
import { useI18n, useTranslate } from '@/components/providers/i18n-provider'
import { formatDate, formatMoney } from '@/i18n/translate'
import type { CarrierStatementEntry } from '@/server/settlements/queries'

export function CarrierStatementView({
  carrierName,
  entries,
}: {
  carrierName: string
  entries: CarrierStatementEntry[]
}) {
  const t = useTranslate()
  const { locale, timezone } = useI18n()

  let runningBalance = 0

  return (
    <div className="space-y-6">
      <PageHeader title={t('finance.settlement.statement.title')} description={carrierName} />
      <Card>
        <CardHeader>
          <CardTitle>{carrierName}</CardTitle>
          <CardDescription>{t('finance.settlement.statement.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          {entries.length === 0 ? (
            <EmptyState icon={ScrollText} title={t('finance.settlement.statement.empty')} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('finance.settlement.statement.date')}</TableHead>
                  <TableHead>{t('finance.settlement.statement.description_column')}</TableHead>
                  <TableHead numeric>{t('finance.settlement.statement.amount')}</TableHead>
                  <TableHead numeric>{t('finance.settlement.statement.runningBalance')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry, index) => {
                  runningBalance += entry.amountCents
                  return (
                    <TableRow key={`${entry.referenceId}-${index}`}>
                      <TableCell>{formatDate(entry.date, locale, timezone)}</TableCell>
                      <TableCell>
                        {t(`finance.settlement.statement.kind.${entry.kind}`)} — {entry.referenceLabel}
                      </TableCell>
                      <TableCell numeric className="tabular">{formatMoney(entry.amountCents, locale)}</TableCell>
                      <TableCell numeric className="tabular font-semibold">{formatMoney(runningBalance, locale)}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
