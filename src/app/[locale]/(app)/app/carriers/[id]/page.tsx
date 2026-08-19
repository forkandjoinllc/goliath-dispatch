import { notFound } from 'next/navigation'
import { isLocale } from '@/i18n/config'
import { can, scopeFilter } from '@/lib/permissions'
import { loadFor } from '@/server/action'
import { getTenantPolicy } from '@/server/context'
import { getCarrierWithOnboarding, carrierComplianceSummary } from '@/server/carriers/queries'
import { missingRequiredDocuments } from '@/server/carriers/service'
import { listDocumentsForOwner } from '@/server/documents/queries'
import { listSignatureRequests } from '@/server/signatures/queries'
import { listTrucks, listTrailers } from '@/server/equipment/queries'
import { listDrivers } from '@/server/drivers/queries'
import {
  listCarrierOnboardingEvents,
  listDispatcherAssignments,
  listDispatcherCandidates,
  listFmcsaVerificationHistory,
  userNamesFor,
} from '../_lib/queries'
import { reviewsForDocuments } from '../../documents/_lib/queries'
import { CarrierDetailView } from '../_components/carrier-detail-view'

export default async function CarrierDetailPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params
  if (!isLocale(locale)) notFound()

  const resource = { carrierId: id }
  const ctx = await loadFor('carrier:read', resource)
  const policy = await getTenantPolicy(ctx.actor.tenantId)

  const { carrier, onboarding } = await getCarrierWithOnboarding(ctx.db, id)
  if (!onboarding) notFound()

  const equipmentDecision = can(ctx.actor, 'equipment:read', resource, policy)
  const driverDecision = can(ctx.actor, 'driver:read', resource, policy)

  const [
    compliance,
    missingDocuments,
    onboardingEvents,
    fmcsaHistory,
    documents,
    signatureRequests,
    trucksResult,
    trailersResult,
    driversResult,
    dispatcherAssignments,
    availableDispatchers,
  ] = await Promise.all([
    carrierComplianceSummary(ctx.db, id),
    missingRequiredDocuments(ctx.db, id),
    listCarrierOnboardingEvents(ctx.db, onboarding.id),
    listFmcsaVerificationHistory(ctx.db, id),
    listDocumentsForOwner(ctx.db, 'carrier', id),
    listSignatureRequests(ctx.db, { carrierId: id }),
    equipmentDecision.allowed
      ? listTrucks(ctx.db, scopeFilter(ctx.actor, equipmentDecision.scope!), { carrierId: id, pagination: { page: 1, pageSize: 200 } })
      : { rows: [], total: 0 },
    equipmentDecision.allowed
      ? listTrailers(ctx.db, scopeFilter(ctx.actor, equipmentDecision.scope!), { carrierId: id, pagination: { page: 1, pageSize: 200 } })
      : { rows: [], total: 0 },
    driverDecision.allowed
      ? listDrivers(ctx.db, scopeFilter(ctx.actor, driverDecision.scope!), { carrierId: id, pagination: { page: 1, pageSize: 200 } })
      : { rows: [], total: 0 },
    listDispatcherAssignments(ctx.db, id),
    listDispatcherCandidates(ctx.db),
  ])

  const documentIds = documents.map((d) => d.id)
  const reviewsByDocumentMap = await reviewsForDocuments(ctx.db, documentIds)
  const reviewsByDocument = Object.fromEntries(reviewsByDocumentMap)

  const userIdsToName = new Set<string>()
  for (const event of onboardingEvents) if (event.actorUserId) userIdsToName.add(event.actorUserId)
  for (const list of reviewsByDocumentMap.values()) for (const review of list) userIdsToName.add(review.reviewerUserId)
  for (const assignment of [...dispatcherAssignments.active, ...dispatcherAssignments.history]) {
    userIdsToName.add(assignment.dispatcherUserId)
  }
  const namesById = await userNamesFor(ctx.db, [...userIdsToName])
  const actorNames = Object.fromEntries(namesById)
  const reviewerNames = actorNames
  const dispatcherNames = actorNames

  const permissions = {
    canEditFee: can(ctx.actor, 'carrier:fee:update', resource, policy).allowed,
    canSubmitOnboarding: can(ctx.actor, 'carrier:onboarding:submit', resource, policy).allowed,
    canReviewOnboarding: can(ctx.actor, 'carrier:onboarding:review', resource, policy).allowed,
    canApproveOnboarding: can(ctx.actor, 'carrier:onboarding:approve', resource, policy).allowed,
    canSuspend: can(ctx.actor, 'carrier:onboarding:approve', resource, policy).allowed,
    canRunVerification: can(ctx.actor, 'carrier:verification:run', resource, policy).allowed,
    canOverrideVerification: can(ctx.actor, 'carrier:verification:override', resource, policy).allowed,
    canUploadDocument: can(ctx.actor, 'document:upload', resource, policy).allowed,
    canReviewDocument: can(ctx.actor, 'document:review', resource, policy).allowed,
    canSendSignature: can(ctx.actor, 'signature:request:create', resource, policy).allowed,
    canManageDispatchers: can(ctx.actor, 'assignment:manage', resource, policy).allowed,
  }

  return (
    <CarrierDetailView
      locale={locale}
      carrier={carrier}
      onboarding={onboarding}
      compliance={compliance}
      missingDocuments={missingDocuments}
      onboardingEvents={onboardingEvents}
      actorNames={actorNames}
      latestFmcsaVerification={fmcsaHistory[0] ?? null}
      fmcsaHistory={fmcsaHistory}
      documents={documents}
      reviewsByDocument={reviewsByDocument}
      reviewerNames={reviewerNames}
      signatureRequests={signatureRequests}
      trucks={trucksResult.rows}
      trailers={trailersResult.rows}
      drivers={driversResult.rows}
      activeDispatcherAssignments={dispatcherAssignments.active}
      dispatcherHistory={dispatcherAssignments.history}
      dispatcherNames={dispatcherNames}
      availableDispatchers={availableDispatchers}
      permissions={permissions}
    />
  )
}
