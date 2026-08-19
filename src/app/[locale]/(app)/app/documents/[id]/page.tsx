import { notFound } from 'next/navigation'
import { isLocale } from '@/i18n/config'
import { loadFor } from '@/server/action'
import { getTenantPolicy, requireActor } from '@/server/context'
import { can } from '@/lib/permissions'
import { getDocumentDetail, resolveDocumentResourceContext } from '@/server/documents/queries'
import { getDocumentDownloadUrl } from '@/server/documents/actions'
import { tenantDb } from '@/db/tenant-db'
import { accessLogFor, ownerLabelKey, ownerLabelsFor } from '../_lib/queries'
import { userNamesFor } from '../../carriers/_lib/queries'
import { DocumentDetailView } from '../_components/document-detail-view'

export default async function DocumentDetailPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params
  if (!isLocale(locale)) notFound()

  // `document:read`'s scope check must be pinned to this document's real
  // owner, exactly like the download route — resolved before `ctx.db` exists.
  const actorPreview = await requireActor()
  if (!actorPreview.tenantId) notFound()
  const resource = await resolveDocumentResourceContext(tenantDb(actorPreview.tenantId), id)
  const ctx = await loadFor('document:read', resource)

  const { document, versions, reviews } = await getDocumentDetail(ctx.db, id)
  const policy = await getTenantPolicy(ctx.actor.tenantId)

  const [ownerLabels, accessLog, reviewerNames] = await Promise.all([
    ownerLabelsFor(ctx.db, [{ ownerType: document.ownerType, ownerId: document.ownerId }]),
    accessLogFor(ctx.db, id),
    userNamesFor(ctx.db, reviews.map((r) => r.reviewerUserId)),
  ])

  let preview: { url: string; contentType: string } | null = null
  if (document.currentVersionId) {
    const currentVersion = versions.find((v) => v.id === document.currentVersionId)
    const result = await getDocumentDownloadUrl({ documentId: id })
    if (result.ok && currentVersion) {
      preview = { url: result.data.url, contentType: currentVersion.contentType }
    }
  }

  const canReview = can(ctx.actor, 'document:review', resource, policy).allowed
  const canDownload = can(ctx.actor, 'document:download', resource, policy).allowed
  const canUpload = can(ctx.actor, 'document:upload', resource, policy).allowed

  return (
    <DocumentDetailView
      document={document}
      versions={versions}
      reviews={reviews}
      reviewerNames={Object.fromEntries(reviewerNames)}
      ownerLabel={ownerLabels.get(ownerLabelKey(document.ownerType, document.ownerId)) ?? document.ownerId}
      accessLog={accessLog}
      preview={preview}
      permissions={{ canReview, canDownload, canUpload }}
    />
  )
}
