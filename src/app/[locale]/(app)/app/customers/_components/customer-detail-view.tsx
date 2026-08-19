'use client'

import Link from 'next/link'
import { Pencil } from 'lucide-react'
import { PageHeader } from '@/components/shell/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DetailList, type DetailItem } from '@/components/data/detail-list'
import { EmptyState } from '@/components/ui/feedback'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { StatusBadge } from '@/components/status/status-badge'
import { useI18n, useTranslate } from '@/components/providers/i18n-provider'
import { formatDateTime, formatMoney } from '@/i18n/translate'
import type { Customer, CustomerContact, CustomerLocation, Load } from '@/db/schema'
import type { ReceivablesSummary } from '@/server/customers/queries'
import { ContactsPanel } from './contacts-panel'
import { LocationsPanel } from './locations-panel'
import { CustomerDeleteButton } from './customer-delete-button'

const STATUS_TONE: Record<Customer['status'], 'success' | 'warning' | 'neutral'> = {
  active: 'success',
  on_hold: 'warning',
  inactive: 'neutral',
}

export interface CustomerDetailViewProps {
  locale: string
  customer: Customer
  contacts: CustomerContact[]
  locations: CustomerLocation[]
  recentLoads: Load[]
  receivables: ReceivablesSummary
  permissions: { canEdit: boolean; canDelete: boolean }
}

export function CustomerDetailView({
  locale,
  customer,
  contacts,
  locations,
  recentLoads,
  receivables,
  permissions,
}: CustomerDetailViewProps) {
  const t = useTranslate()
  const { locale: i18nLocale, timezone } = useI18n()

  const overviewItems: DetailItem[] = [
    { key: 'dotNumber', label: t('customer.fields.dotNumber'), value: customer.dotNumber ?? t('common.labels.none') },
    { key: 'mcNumber', label: t('customer.fields.mcNumber'), value: customer.mcNumber ?? t('common.labels.none') },
    { key: 'website', label: t('customer.fields.website'), value: customer.website ?? t('common.labels.none') },
    { key: 'phone', label: t('customer.fields.phone'), value: customer.phone ?? t('common.labels.none') },
    { key: 'email', label: t('customer.fields.email'), value: customer.email ?? t('common.labels.none') },
    {
      key: 'physicalAddress',
      label: t('customer.fields.physicalAddress'),
      value:
        [customer.physicalLine1, customer.physicalCity, customer.physicalState, customer.physicalPostalCode]
          .filter(Boolean)
          .join(', ') || t('common.labels.none'),
      fullWidth: true,
    },
    {
      key: 'billingAddress',
      label: t('customer.fields.billingAddress'),
      value: customer.billingSameAsPhysical
        ? t('customer.fields.billingSameAsPhysical')
        : [customer.billingLine1, customer.billingCity, customer.billingState, customer.billingPostalCode]
            .filter(Boolean)
            .join(', ') || t('common.labels.none'),
      fullWidth: true,
    },
    { key: 'notes', label: t('customer.fields.notes'), value: customer.notes ?? t('common.labels.none'), fullWidth: true },
  ]

  const creditItems: DetailItem[] = [
    {
      key: 'taxId',
      label: t('customer.fields.taxId'),
      value: customer.taxIdLast4 ? t('common.labels.lastFour', { last4: customer.taxIdLast4 }) : t('common.labels.none'),
      masked: Boolean(customer.taxIdLast4),
    },
    {
      key: 'creditLimit',
      label: t('customer.fields.creditLimit'),
      value: customer.creditLimitCents != null ? formatMoney(customer.creditLimitCents, i18nLocale) : t('common.labels.none'),
    },
    {
      key: 'creditApproved',
      label: t('customer.fields.creditApproved'),
      value: customer.creditApproved ? t('common.labels.yes') : t('common.labels.no'),
    },
    { key: 'paymentTermsDays', label: t('customer.fields.paymentTermsDays'), value: customer.paymentTermsDays },
    {
      key: 'usesFactoring',
      label: t('customer.fields.usesFactoring'),
      value: customer.usesFactoring ? t('common.labels.yes') : t('common.labels.no'),
    },
    {
      key: 'factoringCompanyName',
      label: t('customer.fields.factoringCompanyName'),
      value: customer.factoringCompanyName ?? t('common.labels.none'),
    },
    {
      key: 'creditNotes',
      label: t('customer.fields.creditNotes'),
      value: customer.creditNotes ?? t('common.labels.none'),
      fullWidth: true,
    },
  ]

  const receivablesItems: DetailItem[] = [
    { key: 'openInvoiceCount', label: t('customer.receivables.openInvoiceCount'), value: receivables.openInvoiceCount },
    { key: 'openBalance', label: t('customer.receivables.openBalance'), value: formatMoney(receivables.openBalanceCents, i18nLocale) },
    { key: 'overdueInvoiceCount', label: t('customer.receivables.overdueInvoiceCount'), value: receivables.overdueInvoiceCount },
    {
      key: 'overdueBalance',
      label: t('customer.receivables.overdueBalance'),
      value: formatMoney(receivables.overdueBalanceCents, i18nLocale),
    },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title={customer.companyName}
        status={<Badge tone={STATUS_TONE[customer.status]}>{t(`customer.status.${customer.status}`)}</Badge>}
        secondaryActions={permissions.canDelete ? <CustomerDeleteButton customerId={customer.id} locale={locale} /> : undefined}
        primaryAction={
          permissions.canEdit ? (
            <Button variant="secondary" asChild>
              <Link href={`/${locale}/app/customers/${customer.id}/edit`}>
                <Pencil aria-hidden="true" />
                {t('customer.actions.edit')}
              </Link>
            </Button>
          ) : undefined
        }
      />

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">{t('customer.sections.overview')}</TabsTrigger>
          <TabsTrigger value="contacts">{t('customer.sections.contacts')}</TabsTrigger>
          <TabsTrigger value="locations">{t('customer.sections.locations')}</TabsTrigger>
          <TabsTrigger value="loads">{t('customer.sections.loads')}</TabsTrigger>
          <TabsTrigger value="receivables">{t('customer.sections.receivables')}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <DetailList items={overviewItems} />
          <div>
            <h3 className="mb-3 text-base font-bold text-carbon">{t('customer.sections.credit')}</h3>
            <DetailList items={creditItems} />
          </div>
        </TabsContent>

        <TabsContent value="contacts">
          <ContactsPanel customerId={customer.id} contacts={contacts} canManage={permissions.canEdit} />
        </TabsContent>

        <TabsContent value="locations">
          <LocationsPanel customerId={customer.id} locations={locations} canManage={permissions.canEdit} />
        </TabsContent>

        <TabsContent value="loads">
          {recentLoads.length === 0 ? (
            <EmptyState title={t('customer.recentLoads.empty')} />
          ) : (
            <div className="space-y-3">
              <ul className="divide-y divide-steel-200 rounded-lg border border-steel-200">
                {recentLoads.map((load) => (
                  <li key={load.id} className="flex items-center justify-between gap-3 p-3">
                    <Link href={`/${locale}/app/loads/${load.id}`} className="font-semibold text-navy-700 hover:underline">
                      {load.loadNumber}
                    </Link>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-steel-600">{formatDateTime(load.createdAt, i18nLocale, timezone)}</span>
                      <StatusBadge kind="load" value={load.status} />
                    </div>
                  </li>
                ))}
              </ul>
              <Link href={`/${locale}/app/loads?customerId=${customer.id}`} className="text-sm font-semibold text-navy-700 hover:underline">
                {t('customer.recentLoads.viewAll')}
              </Link>
            </div>
          )}
        </TabsContent>

        <TabsContent value="receivables">
          <DetailList items={receivablesItems} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
