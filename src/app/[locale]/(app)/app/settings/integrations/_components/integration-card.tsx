'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { z } from 'zod'
import { CheckCircle2, PlugZap, XCircle } from 'lucide-react'
import { useActionForm } from '@/components/forms/use-action-form'
import { Form, FormErrorSummary } from '@/components/forms/form'
import { SwitchField, TextField } from '@/components/forms/fields'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert } from '@/components/ui/feedback'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useToast } from '@/components/ui/toast'
import { useI18n, useTranslate } from '@/components/providers/i18n-provider'
import { formatDateTime } from '@/i18n/translate'
import type { IntegrationCategory, IntegrationConnectionSummary } from '@/server/tracking/integrations'
import { testIntegrationConnectionAction, upsertIntegrationConnectionAction } from '@/server/tracking/actions'

const formSchema = z.object({
  displayName: z.string().trim().max(120),
  enabled: z.boolean(),
  apiKey: z.string().trim().max(500),
})
type FormValues = z.infer<typeof formSchema>

export function IntegrationCard({
  connection,
  canManage,
}: {
  connection: IntegrationConnectionSummary
  canManage: boolean
}) {
  const t = useTranslate()
  const { locale, timezone } = useI18n()
  const router = useRouter()
  const { toast } = useToast()
  const [testPending, startTest] = useTransition()

  const { form, onSubmit, isPending } = useActionForm<FormValues, { id: string | null }>({
    schema: formSchema,
    defaultValues: { displayName: connection.displayName ?? '', enabled: connection.enabled, apiKey: '' },
    action: (values) =>
      upsertIntegrationConnectionAction({
        category: connection.category as IntegrationCategory,
        provider: connection.provider,
        displayName: values.displayName.trim() || null,
        enabled: values.enabled,
        credentials: values.apiKey.trim() ? { apiKey: values.apiKey.trim() } : null,
      }),
    onSuccess: () => router.refresh(),
    successMessageKey: 'tracking.integrations.saveSuccess',
  })

  function testConnection() {
    startTest(async () => {
      const result = await testIntegrationConnectionAction({
        category: connection.category as IntegrationCategory,
        provider: connection.provider,
      })
      if (result.ok) {
        toast({ tone: result.data.ok ? 'success' : 'info', title: t(result.data.messageKey) })
      } else {
        toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
      }
      router.refresh()
    })
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <PlugZap className="size-4" aria-hidden="true" />
          {connection.provider}
        </CardTitle>
        <div className="flex items-center gap-2">
          {connection.isActiveDriver ? <Badge tone="info">{t('tracking.integrations.activeDriverBadge')}</Badge> : null}
          {connection.interfaceOnly ? <Badge tone="warning">{t('tracking.integrations.interfaceOnlyBadge')}</Badge> : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-3 text-xs text-steel-600">
          <span>{connection.hasCredentials ? t('tracking.integrations.hasCredentialsLabel') : t('tracking.integrations.noCredentialsLabel')}</span>
          {connection.lastCheckedAt ? (
            <span>{t('tracking.integrations.lastCheckedAt', { date: formatDateTime(connection.lastCheckedAt, locale, timezone) })}</span>
          ) : null}
        </div>

        {connection.lastErrorMessage ? (
          <Alert tone="info">{t('tracking.integrations.lastError', { message: t.optional(connection.lastErrorMessage) ?? connection.lastErrorMessage })}</Alert>
        ) : null}

        {canManage ? (
          <Form form={form} onSubmit={onSubmit} className="space-y-3">
            <FormErrorSummary title={t('errors.validationFailed')} />
            <TextField name="displayName" label={t('tracking.integrations.displayNameField')} />
            <TextField name="apiKey" label={t('tracking.integrations.credentialsField')} type="password" />
            <p className="text-xs text-steel-500">{t('tracking.integrations.credentialsHint')}</p>
            <SwitchField name="enabled" label={t('tracking.integrations.enabledLabel')} />
            <div className="flex gap-2">
              <Button type="submit" size="sm" loading={isPending}>
                {t('tracking.integrations.saveButton')}
              </Button>
              <Button type="button" size="sm" variant="secondary" onClick={testConnection} loading={testPending}>
                {connection.healthStatus === 'healthy' ? (
                  <CheckCircle2 className="size-4" aria-hidden="true" />
                ) : connection.healthStatus === 'failing' ? (
                  <XCircle className="size-4" aria-hidden="true" />
                ) : null}
                {t('tracking.integrations.testButton')}
              </Button>
            </div>
          </Form>
        ) : null}
      </CardContent>
    </Card>
  )
}
