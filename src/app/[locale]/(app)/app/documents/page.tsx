import { notFound } from 'next/navigation'
import { isLocale } from '@/i18n/config'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator } from '@/i18n/translate'
import { loadFor } from '@/server/action'
import { getTenantPolicy } from '@/server/context'
import { can, scopeFilter } from '@/lib/permissions'
import { documentTypeEnum, documentReviewStatusEnum } from '@/db/schema/_shared'
import { PageHeader } from '@/components/shell/page-header'
import { listTenantDocuments, ownerLabelsFor } from './_lib/queries'
import { DocumentList } from './_components/document-list'

export default async function DocumentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{
    page?: string
    pageSize?: string
    search?: string
    documentType?: string
    ownerType?: string
    reviewStatus?: string
    expiringWithinDays?: string
  }>
}) {
  const { locale } = await params
  if (!isLocale(locale)) notFound()
  const query = await searchParams

  const ctx = await loadFor('document:read')
  const dictionary = await getDictionary(locale, ['document', 'common'])
  const t = createTranslator(dictionary, locale)

  const policy = await getTenantPolicy(ctx.actor.tenantId)
  const decision = can(ctx.actor, 'document:read', undefined, policy)
  const scope = scopeFilter(ctx.actor, decision.scope!)
  const canReview = can(ctx.actor, 'document:review', undefined, policy).allowed

  const page = Math.max(1, Number(query.page) || 1)
  const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 25))
  const search = query.search ?? ''
  const documentType = query.documentType ?? ''
  const ownerType = query.ownerType ?? ''
  const reviewStatus = query.reviewStatus ?? ''
  const expiringWithinDays = query.expiringWithinDays ?? ''

  const result = await listTenantDocuments(ctx.db, scope, {
    search: search || undefined,
    documentType: documentType || undefined,
    ownerType: ownerType || undefined,
    reviewStatus: reviewStatus || undefined,
    expiringWithinDays: expiringWithinDays ? Number(expiringWithinDays) : undefined,
    pagination: { page, pageSize },
  })

  const ownerLabels = await ownerLabelsFor(
    ctx.db,
    result.rows.map((r) => ({ ownerType: r.ownerType, ownerId: r.ownerId })),
  )

  return (
    <div className="space-y-6">
      <PageHeader title={t('document.list.title')} />
      <DocumentList
        locale={locale}
        rows={result.rows}
        ownerLabels={Object.fromEntries(ownerLabels)}
        total={result.total}
        page={page}
        pageSize={pageSize}
        search={search}
        documentType={documentType}
        ownerType={ownerType}
        reviewStatus={reviewStatus}
        expiringWithinDays={expiringWithinDays}
        documentTypes={documentTypeEnum.enumValues}
        reviewStatuses={documentReviewStatusEnum.enumValues}
        canReview={canReview}
      />
    </div>
  )
}
