import Link from 'next/link'
import { notFound } from 'next/navigation'
import { FileText, Plus } from 'lucide-react'
import { isLocale } from '@/i18n/config'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator } from '@/i18n/translate'
import { loadFor } from '@/server/action'
import { can } from '@/lib/permissions'
import { PageHeader } from '@/components/shell/page-header'
import { EmptyState } from '@/components/ui/feedback'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { listActiveTemplates, listTemplateVersions } from '@/server/signatures/templates'

export default async function SignatureTemplatesPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  if (!isLocale(locale)) notFound()

  const ctx = await loadFor('signature:template:read')
  const dictionary = await getDictionary(locale, ['signature', 'common'])
  const t = createTranslator(dictionary, locale)
  const canManage = can(ctx.actor, 'signature:template:manage', { tenantId: ctx.actor.tenantId }).allowed

  const active = await listActiveTemplates(ctx.db)
  const rows = await Promise.all(
    active.map(async (template) => ({
      template,
      versionCount: (await listTemplateVersions(ctx.db, template.templateKey)).length,
    })),
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('signature.templates.title')}
        description={t('signature.templates.description')}
        secondaryActions={
          canManage ? (
            <Button variant="primary" asChild>
              <Link href={`/${locale}/app/signatures/templates/new`}>
                <Plus aria-hidden="true" />
                {t('signature.templates.create')}
              </Link>
            </Button>
          ) : undefined
        }
      />

      {rows.length === 0 ? (
        <EmptyState icon={FileText} title={t('signature.templates.empty')} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map(({ template, versionCount }) => (
            <Link key={template.id} href={`/${locale}/app/signatures/templates/${template.templateKey}`}>
              <Card className="h-full transition-colors hover:border-navy-400">
                <CardContent className="space-y-2 pt-6">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs text-steel-500">{template.templateKey}</span>
                    <Badge tone="success">{t('signature.templates.active')}</Badge>
                  </div>
                  <h3 className="text-sm font-bold text-carbon">
                    {locale === 'es' ? template.titleEs : template.titleEn}
                  </h3>
                  <p className="text-xs text-steel-600">
                    {t('signature.templates.version', { version: template.version })}
                    {' · '}
                    {t('signature.templates.versionHistory')} ({versionCount})
                  </p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
