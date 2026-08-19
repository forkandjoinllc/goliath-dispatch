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
import { formatDateTime } from '@/i18n/translate'
import { useI18n } from '@/components/providers/i18n-provider'
import type { AuditEvent, Document, Trailer, Truck } from '@/db/schema'
import type { ComplianceResult } from '@/server/compliance'
import type { EquipmentVerification } from '@/db/schema'
import { EquipmentStatusActions } from './equipment-status-actions'
import { EquipmentCompliancePanel } from './equipment-compliance-panel'
import { EquipmentMediaPanel, type MediaItem } from './equipment-media-panel'

export interface EquipmentDetailViewProps {
  locale: string
  equipmentType: 'truck' | 'trailer'
  equipment: Truck | Trailer
  equipmentTypeLabel: string | null
  compliance: ComplianceResult
  verification: EquipmentVerification | null
  mediaItems: MediaItem[]
  missingAngles: string[]
  documents: Document[]
  history: AuditEvent[]
  permissions: {
    canEdit: boolean
    canManageStatus: boolean
    canUploadMedia: boolean
    canOverride: boolean
  }
}

export function EquipmentDetailView({
  locale,
  equipmentType,
  equipment,
  equipmentTypeLabel,
  compliance,
  verification,
  mediaItems,
  missingAngles,
  documents,
  history,
  permissions,
}: EquipmentDetailViewProps) {
  const t = useTranslate()
  const { locale: i18nLocale, timezone } = useI18n()
  const basePath = `/${locale}/app/equipment/${equipmentType === 'truck' ? 'trucks' : 'trailers'}`
  const isTrailer = equipmentType === 'trailer'
  const trailer = isTrailer ? (equipment as Trailer) : null

  const overviewItems: DetailItem[] = [
    { key: 'carrierId', label: t('equipment.fields.carrier'), value: equipment.carrierId },
    { key: 'equipmentType', label: t('equipment.fields.equipmentType'), value: equipmentTypeLabel ?? t('common.labels.none') },
    { key: 'vin', label: t('equipment.fields.vin'), value: <span className="font-mono">{equipment.vin}</span> },
    { key: 'year', label: t('equipment.fields.year'), value: equipment.year ?? t('common.labels.none') },
    { key: 'make', label: t('equipment.fields.make'), value: equipment.make ?? t('common.labels.none') },
    { key: 'model', label: t('equipment.fields.model'), value: equipment.model ?? t('common.labels.none') },
    { key: 'plateNumber', label: t('equipment.fields.plateNumber'), value: equipment.plateNumber ?? t('common.labels.none') },
    { key: 'plateState', label: t('equipment.fields.plateState'), value: equipment.plateState ?? t('common.labels.none') },
    {
      key: 'registrationExpiresAt',
      label: t('equipment.fields.registrationExpiresAt'),
      value: <ExpiryBadge date={equipment.registrationExpiresAt} />,
    },
    {
      key: 'nextInspectionDueAt',
      label: t('equipment.fields.nextInspectionDueAt'),
      value: <ExpiryBadge date={equipment.nextInspectionDueAt} />,
    },
    { key: 'notes', label: t('equipment.fields.notes'), value: equipment.notes ?? t('common.labels.none'), fullWidth: true },
  ]

  if (equipment.status === 'out_of_service' && equipment.outOfServiceReason) {
    overviewItems.splice(3, 0, {
      key: 'outOfServiceReason',
      label: t('equipment.fields.outOfServiceReason'),
      value: equipment.outOfServiceReason,
      fullWidth: true,
    })
  }

  if (trailer) {
    overviewItems.push(
      { key: 'lengthInches', label: t('equipment.fields.lengthInches'), value: trailer.lengthInches ?? t('common.labels.none') },
      { key: 'widthInches', label: t('equipment.fields.widthInches'), value: trailer.widthInches ?? t('common.labels.none') },
      { key: 'deckHeightInches', label: t('equipment.fields.deckHeightInches'), value: trailer.deckHeightInches ?? t('common.labels.none') },
      { key: 'capacityPounds', label: t('equipment.fields.capacityPounds'), value: trailer.capacityPounds ?? t('common.labels.none') },
      { key: 'axleCount', label: t('equipment.fields.axleCount'), value: trailer.axleCount ?? t('common.labels.none') },
      {
        key: 'removableGooseneck',
        label: t('equipment.fields.removableGooseneck'),
        value: trailer.removableGooseneck ? t('common.actions.confirm') : t('common.labels.no'),
      },
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t(equipmentType === 'truck' ? 'equipment.trucks.detail' : 'equipment.trailers.detail', {
          unitNumber: equipment.unitNumber,
        })}
        status={<StatusBadge kind="equipment" value={equipment.status} />}
        secondaryActions={<EquipmentStatusActions equipmentType={equipmentType} equipmentId={equipment.id} status={equipment.status} />}
        primaryAction={
          permissions.canEdit ? (
            <Button variant="secondary" asChild>
              <Link href={`${basePath}/${equipment.id}/edit`}>
                <Pencil aria-hidden="true" />
                {t('equipment.actions.edit')}
              </Link>
            </Button>
          ) : undefined
        }
      />

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">{t('equipment.tabs.overview')}</TabsTrigger>
          <TabsTrigger value="media">{t('equipment.tabs.media')}</TabsTrigger>
          <TabsTrigger value="compliance">{t('equipment.tabs.compliance')}</TabsTrigger>
          <TabsTrigger value="documents">{t('equipment.tabs.documents')}</TabsTrigger>
          <TabsTrigger value="history">{t('equipment.tabs.history')}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <DetailList items={overviewItems} />
        </TabsContent>

        <TabsContent value="media">
          <EquipmentMediaPanel
            equipmentType={equipmentType}
            equipmentId={equipment.id}
            items={mediaItems}
            missingAngles={missingAngles}
            canManage={permissions.canUploadMedia}
          />
        </TabsContent>

        <TabsContent value="compliance">
          <EquipmentCompliancePanel
            equipmentType={equipmentType}
            equipmentId={equipment.id}
            compliance={compliance}
            verification={verification}
            canOverride={permissions.canOverride}
          />
        </TabsContent>

        <TabsContent value="documents">
          {documents.length === 0 ? (
            <EmptyState title={t('equipment.media.empty')} />
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
        </TabsContent>

        <TabsContent value="history">
          {history.length === 0 ? (
            <EmptyState title={t('equipment.media.empty')} />
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
