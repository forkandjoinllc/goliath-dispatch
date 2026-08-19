'use client'

import Link from 'next/link'
import { Pencil } from 'lucide-react'
import { PageHeader } from '@/components/shell/page-header'
import { StatusBadge } from '@/components/status/status-badge'
import { DetailList, type DetailItem } from '@/components/data/detail-list'
import { ExpiryBadge } from '@/components/status/expiry-badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/feedback'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useTranslate } from '@/components/providers/i18n-provider'
import { useI18n } from '@/components/providers/i18n-provider'
import { formatDateTime } from '@/i18n/translate'
import { Alert } from '@/components/ui/feedback'
import type { AuditEvent, Document, Driver } from '@/db/schema'
import type { DriverPortalAccess } from '@/server/drivers/queries'
import { DriverStatusActions } from './driver-status-actions'
import { DriverApprovalPanel } from './driver-approval-panel'
import { DriverCarrierRelationshipsPanel, type RelationshipRow } from './driver-carrier-relationships-panel'
import { DriverPortalAccessPanel } from './driver-portal-access-panel'
import { DocumentUploadDialog } from '../../documents/_components/document-upload-dialog'

/**
 * License/medical-card scans and any other driver-owned document. Mirrors
 * `ALL_ONBOARDING_DOCUMENT_TYPES` in `carrier-documents-panel.tsx` — the
 * carrier's Documents tab has always let staff attach the underlying files;
 * this tab only ever rendered a read-only list with nowhere to upload one.
 */
const DRIVER_DOCUMENT_TYPES = ['cdl_front', 'cdl_back', 'medical_card', 'driver_other'] as const

function ageFromDob(dateOfBirth: string | null): number | null {
  if (!dateOfBirth) return null
  const dob = new Date(dateOfBirth)
  if (Number.isNaN(dob.getTime())) return null
  const today = new Date()
  let age = today.getUTCFullYear() - dob.getUTCFullYear()
  const hasHadBirthdayThisYear =
    today.getUTCMonth() > dob.getUTCMonth() ||
    (today.getUTCMonth() === dob.getUTCMonth() && today.getUTCDate() >= dob.getUTCDate())
  if (!hasHadBirthdayThisYear) age -= 1
  return age
}

export interface DriverDetailViewProps {
  driver: Driver
  relationships: RelationshipRow[]
  availableCarriers: { value: string; label: string }[]
  reviewerName: string | null
  documents: Document[]
  history: AuditEvent[]
  portalAccess: DriverPortalAccess
  permissions: {
    canEdit: boolean
    canManageStatus: boolean
    canManageRelationships: boolean
    canApprove: boolean
    canInvitePortalUser: boolean
    canManagePortalLink: boolean
    canUpload: boolean
  }
  editHref: string
}

export function DriverDetailView({
  driver,
  relationships,
  availableCarriers,
  reviewerName,
  documents,
  history,
  portalAccess,
  permissions,
  editHref,
}: DriverDetailViewProps) {
  const t = useTranslate()
  const { locale: i18nLocale, timezone } = useI18n()
  const age = ageFromDob(driver.dateOfBirth)

  const overviewItems: DetailItem[] = [
    { key: 'email', label: t('driver.fields.email'), value: driver.email ?? t('common.labels.none') },
    { key: 'phone', label: t('driver.fields.phone'), value: driver.phone ?? t('common.labels.none') },
    { key: 'age', label: t('driver.fields.dateOfBirth'), value: age != null ? t('driver.fields.age', { age }) : t('common.labels.none') },
    { key: 'licenseState', label: t('driver.fields.licenseState'), value: driver.licenseState ?? t('common.labels.none') },
    {
      key: 'licenseNumber',
      label: t('driver.fields.licenseNumber'),
      value: driver.licenseNumberLast4 ? t('driver.fields.licenseNumberMasked', { last4: driver.licenseNumberLast4 }) : t('common.labels.none'),
      masked: Boolean(driver.licenseNumberLast4),
    },
    { key: 'cdlClass', label: t('driver.fields.cdlClass'), value: driver.cdlClass ? t(`driver.cdlClass.${driver.cdlClass}`) : t('common.labels.none') },
    {
      key: 'endorsements',
      label: t('driver.fields.endorsements'),
      value: driver.endorsements.length > 0 ? driver.endorsements.map((code) => t(`driver.endorsements.${code}`)).join(', ') : t('common.labels.none'),
      fullWidth: true,
    },
    {
      key: 'restrictions',
      label: t('driver.fields.restrictions'),
      value: driver.restrictions.length > 0 ? driver.restrictions.map((code) => t(`driver.restrictions.${code}`)).join(', ') : t('common.labels.none'),
      fullWidth: true,
    },
    { key: 'licenseExpiresAt', label: t('driver.fields.licenseExpiresAt'), value: <ExpiryBadge date={driver.licenseExpiresAt} /> },
    { key: 'medicalCardExpiresAt', label: t('driver.fields.medicalCardExpiresAt'), value: <ExpiryBadge date={driver.medicalCardExpiresAt} /> },
    { key: 'notes', label: t('driver.fields.notes'), value: driver.notes ?? t('common.labels.none'), fullWidth: true },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('driver.detail.title', { name: `${driver.firstName} ${driver.lastName}` })}
        status={<StatusBadge kind="driver" value={driver.status} />}
        secondaryActions={
          permissions.canManageStatus ? <DriverStatusActions driverId={driver.id} status={driver.status} /> : undefined
        }
        primaryAction={
          permissions.canEdit ? (
            <Link href={editHref}>
              <Button variant="secondary">
                <Pencil aria-hidden="true" />
                {t('driver.actions.edit')}
              </Button>
            </Link>
          ) : undefined
        }
      />

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">{t('driver.tabs.overview')}</TabsTrigger>
          <TabsTrigger value="carriers">{t('driver.tabs.carriers')}</TabsTrigger>
          <TabsTrigger value="documents">{t('driver.tabs.documents')}</TabsTrigger>
          <TabsTrigger value="compliance">{t('driver.tabs.compliance')}</TabsTrigger>
          <TabsTrigger value="approval">{t('driver.tabs.approval')}</TabsTrigger>
          <TabsTrigger value="portal">{t('driver.tabs.portal')}</TabsTrigger>
          <TabsTrigger value="history">{t('driver.tabs.history')}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <DetailList items={overviewItems} />
        </TabsContent>

        <TabsContent value="carriers">
          <DriverCarrierRelationshipsPanel
            driverId={driver.id}
            driverName={`${driver.firstName} ${driver.lastName}`}
            relationships={relationships}
            availableCarriers={availableCarriers}
            canManage={permissions.canManageRelationships}
          />
        </TabsContent>

        <TabsContent value="documents">
          <div className="space-y-4">
            {permissions.canUpload ? (
              <div className="flex justify-end">
                <DocumentUploadDialog ownerType="driver" ownerId={driver.id} documentTypes={DRIVER_DOCUMENT_TYPES} />
              </div>
            ) : null}
            {documents.length === 0 ? (
              <EmptyState title={t('driver.expiring.empty')} />
            ) : (
              <ul className="divide-y divide-steel-200 rounded-lg border border-steel-200">
                {documents.map((doc) => (
                  <li key={doc.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                    <span className="font-medium text-carbon">{doc.title ?? doc.documentType}</span>
                    <StatusBadge kind="documentReview" value={doc.reviewStatus} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </TabsContent>

        <TabsContent value="compliance">
          <div className="space-y-4">
            <div>
              <h3 className="text-base font-bold text-carbon">{t('driver.compliance.title')}</h3>
              <p className="text-sm text-steel-600">{t('driver.compliance.description')}</p>
            </div>
            {relationships.length === 0 ? (
              <EmptyState title={t('driver.carrierRelationships.empty')} />
            ) : (
              relationships.map(({ relationship, carrier, compliance }) => (
                <div key={relationship.id} className="space-y-2 rounded-lg border border-steel-200 p-4">
                  <p className="font-semibold text-carbon">{carrier.legalName}</p>
                  {compliance.ok ? (
                    <Alert tone="info">{t('driver.compliance.ok')}</Alert>
                  ) : (
                    <Alert tone="danger" title={t('driver.compliance.blocked', { count: compliance.blocking.length })}>
                      <ul className="list-inside list-disc space-y-1">
                        {compliance.blocking.map((reasonItem, index) => (
                          <li key={`${reasonItem.code}-${index}`}>{t(reasonItem.messageKey, reasonItem.params)}</li>
                        ))}
                      </ul>
                    </Alert>
                  )}
                </div>
              ))
            )}
          </div>
        </TabsContent>

        <TabsContent value="approval">
          <DriverApprovalPanel driver={driver} reviewerName={reviewerName} canApprove={permissions.canApprove} />
        </TabsContent>

        <TabsContent value="portal">
          <DriverPortalAccessPanel
            driverId={driver.id}
            driverEmail={driver.email}
            driverFirstName={driver.firstName}
            driverLastName={driver.lastName}
            portalAccess={portalAccess}
            canInvite={permissions.canInvitePortalUser}
            canManageLink={permissions.canManagePortalLink}
          />
        </TabsContent>

        <TabsContent value="history">
          {history.length === 0 ? (
            <EmptyState title={t('driver.expiring.empty')} />
          ) : (
            <ul className="divide-y divide-steel-200 rounded-lg border border-steel-200">
              {history.map((event) => (
                <li key={event.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                  <span>{event.action}</span>
                  <span className="text-steel-500">{formatDateTime(event.occurredAt, i18nLocale, timezone)}</span>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
