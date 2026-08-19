'use client'

import { z } from 'zod'
import { useRouter } from 'next/navigation'
import { useActionForm } from '@/components/forms/use-action-form'
import { Form, FormErrorSummary } from '@/components/forms/form'
import { TextField, TextareaField } from '@/components/forms/fields'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { useTranslate } from '@/components/providers/i18n-provider'
import type { Locale } from '@/i18n/config'
import {
  createSignatureTemplateAction,
  createSignatureTemplateVersionAction,
} from '@/server/signatures/actions'

const schema = z.object({
  templateKey: z
    .string()
    .trim()
    .min(1, 'validation.required')
    .max(60)
    .regex(/^[a-z0-9_]+$/, 'signature.templates.fields.templateKeyInvalid'),
  titleEn: z.string().trim().min(1, 'validation.required').max(200),
  titleEs: z.string().trim().min(1, 'validation.required').max(200),
  bodyEn: z.string().trim().min(1, 'validation.required'),
  bodyEs: z.string().trim().min(1, 'validation.required'),
  consentCopyEn: z.string().trim().min(1, 'validation.required'),
  consentCopyEs: z.string().trim().min(1, 'validation.required'),
  requiredTokensText: z.string(),
})

export interface TemplateEditorFormProps {
  locale: Locale
  mode: 'create' | 'version'
  templateKeyLocked?: string
  initialValues?: Partial<z.infer<typeof schema>>
}

function tokensToText(tokens: readonly string[] = []): string {
  return tokens.join(', ')
}

function textToTokens(text: string): string[] {
  return [...new Set(text.split(',').map((t) => t.trim()).filter((t) => t.length > 0))]
}

export function TemplateEditorForm({ locale, mode, templateKeyLocked, initialValues }: TemplateEditorFormProps) {
  const t = useTranslate()
  const router = useRouter()

  const { form, onSubmit, isPending } = useActionForm({
    schema,
    defaultValues: {
      templateKey: templateKeyLocked ?? '',
      titleEn: '',
      titleEs: '',
      bodyEn: '',
      bodyEs: '',
      consentCopyEn: '',
      consentCopyEs: '',
      requiredTokensText: tokensToText([]),
      ...initialValues,
    },
    action: (values) => {
      const fields = {
        titleEn: values.titleEn,
        titleEs: values.titleEs,
        bodyEn: values.bodyEn,
        bodyEs: values.bodyEs,
        consentCopyEn: values.consentCopyEn,
        consentCopyEs: values.consentCopyEs,
        requiredTokens: textToTokens(values.requiredTokensText),
      }
      return mode === 'create'
        ? createSignatureTemplateAction({ templateKey: values.templateKey, ...fields })
        : createSignatureTemplateVersionAction({ templateKey: templateKeyLocked ?? values.templateKey, ...fields })
    },
    onSuccess: () => {
      router.push(`/${locale}/app/signatures/templates/${templateKeyLocked ?? form.getValues('templateKey')}`)
      router.refresh()
    },
    successMessageKey: mode === 'create' ? 'signature.templates.created' : 'signature.templates.versionCreated',
  })

  return (
    <Form form={form} onSubmit={onSubmit}>
      <Card>
        <CardHeader>
          <CardTitle>
            {mode === 'create' ? t('signature.templates.create') : t('signature.templates.createVersion')}
          </CardTitle>
          <CardDescription>{t('signature.templates.viewOnly')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <FormErrorSummary title={t('errors.validationFailed')} />
          <TextField
            name="templateKey"
            label={t('signature.templates.fields.templateKey')}
            description={t('signature.templates.fields.templateKeyHint')}
            disabled={mode === 'version'}
            required
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField name="titleEn" label={t('signature.templates.fields.titleEn')} required />
            <TextField name="titleEs" label={t('signature.templates.fields.titleEs')} required />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextareaField name="bodyEn" label={t('signature.templates.fields.bodyEn')} rows={8} required />
            <TextareaField name="bodyEs" label={t('signature.templates.fields.bodyEs')} rows={8} required />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextareaField name="consentCopyEn" label={t('signature.templates.fields.consentCopyEn')} rows={4} required />
            <TextareaField name="consentCopyEs" label={t('signature.templates.fields.consentCopyEs')} rows={4} required />
          </div>
          <TextField
            name="requiredTokensText"
            label={t('signature.templates.fields.requiredTokens')}
            description={t('signature.templates.fields.requiredTokensHint')}
          />
        </CardContent>
        <CardFooter>
          <Button type="submit" loading={isPending} loadingLabel={t('common.states.saving')}>
            {mode === 'create' ? t('signature.templates.create') : t('signature.templates.createVersion')}
          </Button>
        </CardFooter>
      </Card>
    </Form>
  )
}
