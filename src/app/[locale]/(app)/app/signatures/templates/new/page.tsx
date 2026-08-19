import { notFound } from 'next/navigation'
import { isLocale } from '@/i18n/config'
import { loadFor } from '@/server/action'
import { TemplateEditorForm } from '../_components/template-editor-form'

export default async function NewSignatureTemplatePage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  if (!isLocale(locale)) notFound()

  await loadFor('signature:template:manage')

  return (
    <div className="mx-auto max-w-3xl">
      <TemplateEditorForm locale={locale} mode="create" />
    </div>
  )
}
