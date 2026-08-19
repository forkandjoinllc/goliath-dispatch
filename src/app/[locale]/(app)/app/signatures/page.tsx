import Link from 'next/link'
import { notFound } from 'next/navigation'
import { FileSignature } from 'lucide-react'
import { isLocale } from '@/i18n/config'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator } from '@/i18n/translate'
import { loadFor } from '@/server/action'
import { getTenant, getTenantPolicy } from '@/server/context'
import { PageHeader } from '@/components/shell/page-header'
import { EmptyState } from '@/components/ui/feedback'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { filterRequestsForScope, listSignatureRequestsForActor } from '@/server/signatures/queries'
import { findRequestsNeedingResignature, listActiveTemplates } from '@/server/signatures/templates'
import type { SignatureRequest } from '@/db/schema'
import { RequestsTable, type RequestRow } from './_components/requests-table'

const STATUS_OPTIONS: SignatureRequest['status'][] = [
  'pending',
  'viewed',
  'signed',
  'declined',
  'expired',
  'voided',
  'superseded',
]

export default async function SignaturesIndexPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ status?: string }>
}) {
  const { locale } = await params
  if (!isLocale(locale)) notFound()
  const { status: statusParam } = await searchParams
  const status = STATUS_OPTIONS.find((s) => s === statusParam)

  const ctx = await loadFor('signature:request:read')
  const dictionary = await getDictionary(locale, ['signature', 'common'])
  const t = createTranslator(dictionary, locale)
  const [tenant, policy] = await Promise.all([getTenant(ctx.actor.tenantId), getTenantPolicy(ctx.actor.tenantId)])
  const timezone = tenant?.defaultTimezone ?? 'America/New_York'

  const [requests, templates] = await Promise.all([
    listSignatureRequestsForActor(ctx.db, ctx.actor, policy, status ? { status } : {}),
    listActiveTemplates(ctx.db),
  ])

  const needsResignatureLists = await Promise.all(
    templates.map(async (template) => ({
      template,
      requests: filterRequestsForScope(
        await findRequestsNeedingResignature(ctx.db, template.templateKey),
        ctx.actor,
        policy,
      ),
    })),
  )
  const needsResignatureRows: RequestRow[] = needsResignatureLists.flatMap(({ template, requests: stale }) =>
    stale.map((request) => toRow(request, template.titleEn, template.version)),
  )

  const rows: RequestRow[] = requests.map((request) =>
    toRow(request, request.template?.titleEn ?? request.templateId, request.templateVersion),
  )

  return (
    <div className="space-y-8">
      <PageHeader
        title={t('signature.index.title')}
        description={t('signature.index.description')}
        secondaryActions={
          <Button variant="secondary" asChild>
            <Link href={`/${locale}/app/signatures/templates`}>{t('signature.templates.title')}</Link>
          </Button>
        }
      />

      <nav className="flex flex-wrap gap-2" aria-label={t('signature.index.filterStatus')}>
        <FilterChip href={`/${locale}/app/signatures`} active={!status} label={t('signature.index.filterAllStatuses')} />
        {STATUS_OPTIONS.map((option) => (
          <FilterChip
            key={option}
            href={`/${locale}/app/signatures?status=${option}`}
            active={status === option}
            label={t(`signature.statuses.${option}`)}
          />
        ))}
      </nav>

      {rows.length === 0 ? (
        <EmptyState icon={FileSignature} title={t('signature.index.empty')} />
      ) : (
        <RequestsTable rows={rows} locale={locale} timezone={timezone} t={t} />
      )}

      <section className="space-y-3">
        <div>
          <h2 className="text-base font-bold text-carbon">{t('signature.index.needsResignature')}</h2>
          <p className="text-sm text-steel-600">{t('signature.index.needsResignatureDescription')}</p>
        </div>
        {needsResignatureRows.length === 0 ? (
          <p className="text-sm text-steel-500">{t('signature.index.needsResignatureEmpty')}</p>
        ) : (
          <RequestsTable rows={needsResignatureRows} locale={locale} timezone={timezone} t={t} />
        )}
      </section>
    </div>
  )
}

function toRow(
  request: SignatureRequest,
  templateTitle: string,
  templateVersion: number,
): RequestRow {
  return {
    id: request.id,
    signerEmail: request.signerEmail,
    subjectType: request.subjectType,
    status: request.status,
    templateTitle,
    templateVersion,
    requestedAt: request.requestedAt,
    completedAt: request.completedAt,
  }
}

function FilterChip({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      aria-current={active ? 'true' : undefined}
      className={cn(
        'rounded-full border px-3 py-1 text-xs font-semibold transition-colors',
        active
          ? 'border-navy-700 bg-navy-700 text-white'
          : 'border-steel-300 bg-white text-steel-700 hover:bg-steel-50',
      )}
    >
      {label}
    </Link>
  )
}
