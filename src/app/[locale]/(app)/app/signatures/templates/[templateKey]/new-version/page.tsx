import { notFound } from 'next/navigation'
import { isLocale } from '@/i18n/config'
import { loadFor } from '@/server/action'
import { requireActiveTemplate } from '@/server/signatures/templates'
import { TemplateEditorForm } from '../../_components/template-editor-form'

export default async function NewSignatureTemplateVersionPage({
  params,
}: {
  params: Promise<{ locale: string; templateKey: string }>
}) {
  const { locale, templateKey } = await params
  if (!isLocale(locale)) notFound()

  const ctx = await loadFor('signature:template:manage')
  const current = await requireActiveTemplate(ctx.db, templateKey)

  return (
    <div className="mx-auto max-w-3xl">
      <TemplateEditorForm
        locale={locale}
        mode="version"
        templateKeyLocked={templateKey}
        initialValues={{
          templateKey,
          titleEn: current.titleEn,
          titleEs: current.titleEs,
          bodyEn: current.bodyEn,
          bodyEs: current.bodyEs,
          consentCopyEn: current.consentCopyEn,
          consentCopyEs: current.consentCopyEs,
          requiredTokensText: current.requiredTokens.join(', '),
        }}
      />
    </div>
  )
}
