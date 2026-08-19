'use client'

import Link from 'next/link'
import { Pencil } from 'lucide-react'
import { PageHeader } from '@/components/shell/page-header'
import { StatusBadge } from '@/components/status/status-badge'
import { ComplianceBadge } from '@/components/status/compliance-badge'
import { DetailList, type DetailItem } from '@/components/data/detail-list'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/ui/feedback'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useI18n, useTranslate } from '@/components/providers/i18n-provider'
import { formatDateTime, formatInches, formatPounds } from '@/i18n/translate'
import type { LoadDetail } from '@/server/loads/queries'
import type { OversizeEvaluation } from '@/db/schema'
import type { MapWaypoint } from '@/components/data/map-view'
import type { SessionSummary } from '../../../tracking/[loadId]/_components/session-control-panel'
import { LoadStatusActions } from './load-status-actions'
import { LoadCancelButton } from './load-cancel-button'
import { LoadDuplicateButton } from './load-duplicate-button'
import { StopsPanel } from './stops-panel'
import { AssignmentsTab } from './assignments-tab'
import { FinancialsTab } from './financials-tab'
import { DocumentsTab } from './documents-tab'
import { TrackingTab } from './tracking-tab'
import { HistoryTab } from './history-tab'

export interface LoadDetailPermissions {
  canUpdate: boolean
  canAssignCarrier: boolean
  canAssignResources: boolean
  canChangeStatus: boolean
  canCancel: boolean
  canDuplicate: boolean
  canReadFinancials: boolean
  canUpdateFinancials: boolean
  canUploadDocuments: boolean
  canReviewDocuments: boolean
  canRespondToRateConfirmation: boolean
  canEvaluateOversize: boolean
  canValidateOversize: boolean
}

export function LoadDetailView({
  locale,
  detail,
  permissions,
  duplicatedFromLoadNumber,
  resourceLabels,
  userLabels,
  oversize,
  tracking,
}: {
  locale: string
  detail: LoadDetail
  permissions: LoadDetailPermissions
  duplicatedFromLoadNumber?: string | null
  resourceLabels: Record<string, string>
  userLabels: Record<string, string>
  oversize: { evaluation: OversizeEvaluation | null; isStale: boolean }
  tracking: { session: SessionSummary | null; waypoints: MapWaypoint[] }
}) {
  const t = useTranslate()
  const { locale: i18nLocale, timezone } = useI18n()
  const { load, customer, carrier } = detail

  const complianceState = !detail.compliance.ok ? 'blocked' : detail.compliance.warnings.length > 0 ? 'warning' : 'clear'

  const overviewItems: DetailItem[] = [
    { key: 'customer', label: t('load.fields.customer'), value: <Link href={`/${locale}/app/customers/${customer.id}`} className="text-navy-700 hover:underline">{customer.companyName}</Link> },
    { key: 'carrier', label: t('load.fields.carrier'), value: carrier?.legalName ?? t('common.labels.none') },
    { key: 'customerReference', label: t('load.fields.customerReference'), value: load.customerReference ?? t('common.labels.none') },
    { key: 'poNumber', label: t('load.fields.poNumber'), value: load.poNumber ?? t('common.labels.none') },
    { key: 'commodity', label: t('load.fields.commodity'), value: load.commodity ?? t('common.labels.none') },
    { key: 'weightPounds', label: t('load.fields.weightPounds'), value: formatPounds(load.weightPounds, i18nLocale) },
    {
      key: 'dimensions',
      label: t('load.fields.dimensions'),
      value:
        load.lengthInches || load.widthInches || load.heightInches
          ? `${formatInches(load.lengthInches, i18nLocale)} × ${formatInches(load.widthInches, i18nLocale)} × ${formatInches(load.heightInches, i18nLocale)}`
          : t('common.labels.none'),
    },
    { key: 'pieceCount', label: t('load.fields.pieceCount'), value: load.pieceCount ?? t('common.labels.none') },
    { key: 'axleConfiguration', label: t('load.fields.axleConfiguration'), value: load.axleConfiguration ?? t('common.labels.none') },
    {
      key: 'plannedPickupAt',
      label: t('load.fields.plannedPickupAt'),
      value: load.plannedPickupAt ? formatDateTime(load.plannedPickupAt, i18nLocale, timezone) : t('common.labels.none'),
    },
    {
      key: 'plannedDeliveryAt',
      label: t('load.fields.plannedDeliveryAt'),
      value: load.plannedDeliveryAt ? formatDateTime(load.plannedDeliveryAt, i18nLocale, timezone) : t('common.labels.none'),
    },
    {
      key: 'specialInstructions',
      label: t('load.fields.specialInstructions'),
      value: load.specialInstructions ?? t('common.labels.none'),
      fullWidth: true,
    },
    {
      key: 'internalNotes',
      label: t('load.fields.internalNotes'),
      value: load.internalNotes ?? t('common.labels.none'),
      fullWidth: true,
    },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('load.loadNumber', { number: load.loadNumber })}
        status={<StatusBadge kind="load" value={load.status} />}
        secondaryActions={
          <div className="flex flex-wrap items-center gap-2">
            <ComplianceBadge state={complianceState} />
            {permissions.canChangeStatus ? <LoadStatusActions loadId={load.id} status={load.status} /> : null}
            {permissions.canDuplicate ? <LoadDuplicateButton loadId={load.id} locale={locale} /> : null}
            {permissions.canCancel && load.status !== 'cancelled' ? <LoadCancelButton loadId={load.id} /> : null}
          </div>
        }
        primaryAction={
          permissions.canUpdate && load.status !== 'cancelled' ? (
            <Link href={`/${locale}/app/loads/${load.id}/edit`}>
              <Button variant="secondary">
                <Pencil aria-hidden="true" />
                {t('load.actions.edit')}
              </Button>
            </Link>
          ) : undefined
        }
      />

      {load.duplicatedFromLoadId ? (
        <Alert tone="info">
          <Link href={`/${locale}/app/loads/${load.duplicatedFromLoadId}`} className="hover:underline">
            {t('load.duplicate.linkedFrom', { loadNumber: duplicatedFromLoadNumber ?? load.duplicatedFromLoadId })}
          </Link>
        </Alert>
      ) : null}
      {load.status === 'cancelled' ? (
        <Alert tone="danger" title={t('load.cancel.title')}>
          {load.cancellationReason}
          {load.cancelledAt ? ` — ${t('load.cancel.cancelledOn', { date: formatDateTime(load.cancelledAt, i18nLocale, timezone) })}` : null}
        </Alert>
      ) : null}
      {(load.isOversize || load.isOverweight) ? (
        <div className="flex flex-wrap gap-2">
          {load.isOversize ? <Badge tone="warning">{t('load.fields.oversizeIndicator')}</Badge> : null}
          {load.isOverweight ? <Badge tone="warning">{t('load.fields.overweightIndicator')}</Badge> : null}
        </div>
      ) : null}
      {!detail.compliance.ok ? (
        <Alert tone="danger" title={t('load.compliance.blockingCount', { count: detail.compliance.blocking.length })}>
          <ul className="list-inside list-disc space-y-1">
            {detail.compliance.blocking.map((reason, index) => (
              <li key={`${reason.code}-${index}`}>{t(reason.messageKey, reason.params)}</li>
            ))}
          </ul>
        </Alert>
      ) : detail.compliance.warnings.length > 0 ? (
        <Alert tone="warning" title={t('load.compliance.warningCount', { count: detail.compliance.warnings.length })}>
          <ul className="list-inside list-disc space-y-1">
            {detail.compliance.warnings.map((reason, index) => (
              <li key={`${reason.code}-${index}`}>{t(reason.messageKey, reason.params)}</li>
            ))}
          </ul>
        </Alert>
      ) : null}

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">{t('load.tabs.overview')}</TabsTrigger>
          <TabsTrigger value="assignments">{t('load.tabs.assignments')}</TabsTrigger>
          <TabsTrigger value="financials">{t('load.tabs.financials')}</TabsTrigger>
          <TabsTrigger value="documents">{t('load.tabs.documents')}</TabsTrigger>
          <TabsTrigger value="tracking">{t('load.tabs.tracking')}</TabsTrigger>
          <TabsTrigger value="history">{t('load.tabs.history')}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <DetailList items={overviewItems} />
          <StopsPanel loadId={load.id} stops={detail.stops} canManage={permissions.canUpdate} />
        </TabsContent>

        <TabsContent value="assignments">
          <AssignmentsTab
            load={load}
            carrier={carrier}
            assignments={detail.assignments}
            resourceLabels={resourceLabels}
            permissions={permissions}
          />
        </TabsContent>

        <TabsContent value="financials">
          <FinancialsTab load={load} snapshot={detail.financialSnapshot} canRead={permissions.canReadFinancials} />
        </TabsContent>

        <TabsContent value="documents">
          <DocumentsTab
            loadId={load.id}
            documents={detail.documents}
            documentReviews={detail.documentReviews}
            reviewerLabels={userLabels}
            rateConfirmationDecisions={detail.rateConfirmationDecisions}
            decisionActorLabels={userLabels}
            canUpload={permissions.canUploadDocuments}
            canReview={permissions.canReviewDocuments}
            canRespond={permissions.canRespondToRateConfirmation}
          />
        </TabsContent>

        <TabsContent value="tracking">
          <TrackingTab
            loadId={load.id}
            checkCalls={detail.checkCalls}
            completedByLabels={userLabels}
            canManage={permissions.canUpdate}
            oversizeEvaluation={oversize.evaluation}
            oversizeIsStale={oversize.isStale}
            canEvaluateOversize={permissions.canEvaluateOversize}
            canValidateOversize={permissions.canValidateOversize}
            trackingSession={tracking.session}
            trackingWaypoints={tracking.waypoints}
          />
        </TabsContent>

        <TabsContent value="history">
          <HistoryTab statusHistory={detail.statusHistory} actorLabels={userLabels} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
