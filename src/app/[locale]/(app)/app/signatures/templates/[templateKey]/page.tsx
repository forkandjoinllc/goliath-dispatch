import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Plus } from 'lucide-react'
import { isLocale } from '@/i18n/config'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator, formatDateTime } from '@/i18n/translate'
import { loadFor } from '@/server/action'
import { getTenant } from '@/server/context'
import { can } from '@/lib/permissions'
import { PageHeader } from '@/components/shell/page-header'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DetailList } from '@/components/data/detail-list'
import { Button } from '@/components/ui/button'
import { listTemplateVersions } from '@/server/signatures/templates'
import { RetireTemplateButton } from '../_components/retire-template-button'

export default async function SignatureTemplateDetailPage({
  params,
}: {
  params: Promise<{ locale: string; templateKey: string }>
}) {
  const { locale, templateKey } = await params
  if (!isLocale(locale)) notFound()

  const ctx = await loadFor('signature:template:read')
  const dictionary = await getDictionary(locale, ['signature', 'common'])
  const t = createTranslator(dictionary, locale)
  const tenant = await getTenant(ctx.actor.tenantId)
  const timezone = tenant?.defaultTimezone ?? 'America/New_York'
  const canManage = can(ctx.actor, 'signature:template:manage', { tenantId: ctx.actor.tenantId }).allowed

  const versions = await listTemplateVersions(ctx.db, templateKey)
  if (versions.length === 0) notFound()
  const current = versions.find((v) => v.active) ?? versions[0]!

  return (
    <div className="space-y-6">
      <Link
        href={`/${locale}/app/signatures/templates`}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-navy-700 hover:underline"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        {t('signature.templates.title')}
      </Link>

      <PageHeader
        title={locale === 'es' ? current.titleEs : current.titleEn}
        description={templateKey}
        status={
          <Badge tone={current.active ? 'success' : 'neutral'}>
            {current.active ? t('signature.templates.active') : t('signature.templates.retired')}
          </Badge>
        }
        secondaryActions={
          canManage ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" asChild>
                <Link href={`/${locale}/app/signatures/templates/${templateKey}/new-version`}>
                  <Plus aria-hidden="true" />
                  {t('signature.templates.createVersion')}
                </Link>
              </Button>
              {current.active ? <RetireTemplateButton templateKey={templateKey} /> : null}
            </div>
          ) : undefined
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>{t('signature.templates.version', { version: current.version })}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <DetailList
            items={[
              { key: 'titleEn', label: t('signature.templates.fields.titleEn'), value: current.titleEn },
              { key: 'titleEs', label: t('signature.templates.fields.titleEs'), value: current.titleEs },
              {
                key: 'requiredTokens',
                label: t('signature.templates.fields.requiredTokens'),
                value: current.requiredTokens.length > 0 ? current.requiredTokens.join(', ') : '—',
                fullWidth: true,
              },
              {
                key: 'contentHash',
                label: t('signature.templates.fields.contentHash'),
                value: current.contentHash,
                masked: true,
                fullWidth: true,
              },
            ]}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-steel-600">
                {t('signature.templates.fields.bodyEn')}
              </h3>
              <p className="mt-1 whitespace-pre-wrap rounded-lg border border-steel-200 bg-steel-50 p-3 text-sm text-carbon">
                {current.bodyEn}
              </p>
            </div>
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-steel-600">
                {t('signature.templates.fields.bodyEs')}
              </h3>
              <p className="mt-1 whitespace-pre-wrap rounded-lg border border-steel-200 bg-steel-50 p-3 text-sm text-carbon">
                {current.bodyEs}
              </p>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-steel-600">
                {t('signature.templates.fields.consentCopyEn')}
              </h3>
              <p className="mt-1 whitespace-pre-wrap rounded-lg border border-steel-200 bg-steel-50 p-3 text-sm text-carbon">
                {current.consentCopyEn}
              </p>
            </div>
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-steel-600">
                {t('signature.templates.fields.consentCopyEs')}
              </h3>
              <p className="mt-1 whitespace-pre-wrap rounded-lg border border-steel-200 bg-steel-50 p-3 text-sm text-carbon">
                {current.consentCopyEs}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('signature.templates.versionHistory')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {versions.map((version) => (
            <div
              key={version.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-steel-200 p-3 text-sm"
            >
              <div className="flex items-center gap-2">
                <span className="font-semibold text-carbon">
                  {t('signature.templates.version', { version: version.version })}
                </span>
                <Badge tone={version.active ? 'success' : 'neutral'}>
                  {version.active ? t('signature.templates.active') : t('signature.templates.retired')}
                </Badge>
              </div>
              <span className="text-xs text-steel-600">
                {version.retiredAt
                  ? formatDateTime(version.retiredAt, locale, timezone)
                  : formatDateTime(version.createdAt, locale, timezone)}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
