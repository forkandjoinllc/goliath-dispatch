'use client'

import Link from 'next/link'
import { Pencil } from 'lucide-react'
import { PageHeader } from '@/components/shell/page-header'
import { StatusBadge } from '@/components/status/status-badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useTranslate } from '@/components/providers/i18n-provider'
import type { Carrier, CarrierDispatcherAssignment, CarrierOnboarding, Driver, DocumentReview, Trailer, Truck } from '@/db/schema'
import type { ComplianceResult } from '@/server/compliance'
import type { DocumentWithCurrentVersion } from '@/server/documents/queries'
import type { SignatureRequestWithTemplate } from '@/server/signatures/queries'
import { CarrierOverviewTab } from './carrier-overview-tab'
import { CarrierOnboardingPanel } from './carrier-onboarding-panel'
import { CarrierVerificationPanel } from './carrier-verification-panel'
import { CarrierDocumentsPanel } from './carrier-documents-panel'
import { CarrierSignaturesPanel } from './carrier-signatures-panel'
import { CarrierEquipmentDriversPanel } from './carrier-equipment-drivers-panel'
import { CarrierDispatchersPanel, type DispatcherOption } from './carrier-dispatchers-panel'
import { CarrierCompliancePanel } from './carrier-compliance-panel'
import type { FmcsaVerification } from '@/db/schema'

interface OnboardingEventRow {
  id: string
  fromStatus: CarrierOnboarding['status'] | null
  toStatus: CarrierOnboarding['status']
  actorUserId: string | null
  reason: string | null
  createdAt: Date
}

export interface CarrierDetailViewProps {
  locale: string
  carrier: Carrier
  onboarding: CarrierOnboarding
  compliance: ComplianceResult
  missingDocuments: string[]
  onboardingEvents: OnboardingEventRow[]
  actorNames: Record<string, string>
  latestFmcsaVerification: FmcsaVerification | null
  fmcsaHistory: FmcsaVerification[]
  documents: DocumentWithCurrentVersion[]
  reviewsByDocument: Record<string, DocumentReview[]>
  reviewerNames: Record<string, string>
  signatureRequests: SignatureRequestWithTemplate[]
  trucks: Truck[]
  trailers: Trailer[]
  drivers: Driver[]
  activeDispatcherAssignments: CarrierDispatcherAssignment[]
  dispatcherHistory: CarrierDispatcherAssignment[]
  dispatcherNames: Record<string, string>
  availableDispatchers: DispatcherOption[]
  permissions: {
    canEditFee: boolean
    canSubmitOnboarding: boolean
    canReviewOnboarding: boolean
    canApproveOnboarding: boolean
    canSuspend: boolean
    canRunVerification: boolean
    canOverrideVerification: boolean
    canUploadDocument: boolean
    canReviewDocument: boolean
    canSendSignature: boolean
    canManageDispatchers: boolean
  }
}

export function CarrierDetailView({
  locale,
  carrier,
  onboarding,
  compliance,
  missingDocuments,
  onboardingEvents,
  actorNames,
  latestFmcsaVerification,
  fmcsaHistory,
  documents,
  reviewsByDocument,
  reviewerNames,
  signatureRequests,
  trucks,
  trailers,
  drivers,
  activeDispatcherAssignments,
  dispatcherHistory,
  dispatcherNames,
  availableDispatchers,
  permissions,
}: CarrierDetailViewProps) {
  const t = useTranslate()

  return (
    <div className="space-y-6">
      <PageHeader
        title={carrier.legalName}
        description={`${t('carrier.fields.dotNumber')} ${carrier.dotNumber}`}
        status={<StatusBadge kind="onboarding" value={carrier.onboardingStatus} />}
        primaryAction={
          permissions.canEditFee ? (
            <Button variant="secondary" asChild>
              <Link href={`/${locale}/app/carriers/${carrier.id}/edit`}>
                <Pencil aria-hidden="true" />
                {t('carrier.actions.edit')}
              </Link>
            </Button>
          ) : undefined
        }
      />

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">{t('carrier.tabs.overview')}</TabsTrigger>
          <TabsTrigger value="onboarding">{t('carrier.tabs.onboarding')}</TabsTrigger>
          <TabsTrigger value="verification">{t('carrier.tabs.verification')}</TabsTrigger>
          <TabsTrigger value="documents">{t('carrier.tabs.documents')}</TabsTrigger>
          <TabsTrigger value="signatures">{t('carrier.tabs.signatures')}</TabsTrigger>
          <TabsTrigger value="equipmentDrivers">{t('carrier.tabs.equipmentDrivers')}</TabsTrigger>
          <TabsTrigger value="dispatchers">{t('carrier.tabs.dispatchers')}</TabsTrigger>
          <TabsTrigger value="compliance">{t('carrier.tabs.compliance')}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <CarrierOverviewTab carrier={carrier} canSetFee={permissions.canEditFee} />
        </TabsContent>

        <TabsContent value="onboarding">
          <CarrierOnboardingPanel
            carrier={carrier}
            onboarding={onboarding}
            missingDocuments={missingDocuments}
            events={onboardingEvents}
            actorNames={actorNames}
            permissions={{
              canSubmit: permissions.canSubmitOnboarding,
              canReview: permissions.canReviewOnboarding,
              canApprove: permissions.canApproveOnboarding,
              canSuspend: permissions.canSuspend,
            }}
          />
        </TabsContent>

        <TabsContent value="verification">
          <CarrierVerificationPanel
            carrier={carrier}
            latest={latestFmcsaVerification}
            history={fmcsaHistory}
            canRun={permissions.canRunVerification}
            canOverride={permissions.canOverrideVerification}
          />
        </TabsContent>

        <TabsContent value="documents">
          <CarrierDocumentsPanel
            carrierId={carrier.id}
            documents={documents}
            requiredDocumentTypes={onboarding.requiredDocumentTypes}
            reviewsByDocument={reviewsByDocument}
            reviewerNames={reviewerNames}
            canUpload={permissions.canUploadDocument}
            canReview={permissions.canReviewDocument}
          />
        </TabsContent>

        <TabsContent value="signatures">
          <CarrierSignaturesPanel carrier={carrier} requests={signatureRequests} canSend={permissions.canSendSignature} />
        </TabsContent>

        <TabsContent value="equipmentDrivers">
          <CarrierEquipmentDriversPanel locale={locale} trucks={trucks} trailers={trailers} drivers={drivers} />
        </TabsContent>

        <TabsContent value="dispatchers">
          <CarrierDispatchersPanel
            carrierId={carrier.id}
            active={activeDispatcherAssignments}
            history={dispatcherHistory}
            dispatcherNames={dispatcherNames}
            availableDispatchers={availableDispatchers}
            canManage={permissions.canManageDispatchers}
          />
        </TabsContent>

        <TabsContent value="compliance">
          <CarrierCompliancePanel compliance={compliance} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
