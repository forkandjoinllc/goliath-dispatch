'use client'

import * as React from 'react'
import { z } from 'zod'
import { useActionForm } from '@/components/forms/use-action-form'
import { Form, FormField, Controller, useFormContext } from '@/components/forms/form'
import { TextField } from '@/components/forms/fields'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useTranslate } from '@/components/providers/i18n-provider'
import { updateBrandingAction } from '@/server/settings/actions'
import { contrastRatioAgainstWhite, passesAA } from './contrast'

const hexColor = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, 'validation.hexColor')

const schema = z.object({
  primaryColor: hexColor,
  accentColor: hexColor,
  neutralColor: hexColor,
  surfaceColor: hexColor,
  inkColor: hexColor,
  headingFont: z.string().trim().min(1).max(80),
  bodyFont: z.string().trim().min(1).max(80),
})

type FormValues = z.infer<typeof schema>

function ColorField({ name, label, checkContrast }: { name: keyof FormValues; label: string; checkContrast?: boolean }) {
  const { control, watch } = useFormContext<FormValues>()
  const t = useTranslate()
  const value = watch(name)
  const ratio = checkContrast ? contrastRatioAgainstWhite(value) : null

  return (
    <FormField<FormValues>
      name={name}
      label={label}
      render={(bind) => (
        <Controller
          control={control}
          name={name}
          render={({ field }) => (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={/^#[0-9a-fA-F]{6}$/.test(field.value) ? field.value : '#000000'}
                  onChange={(event) => field.onChange(event.target.value)}
                  className="h-10 w-10 shrink-0 rounded border border-steel-300"
                  aria-label={label}
                />
                <input
                  {...bind}
                  value={field.value}
                  onChange={(event) => field.onChange(event.target.value)}
                  className="h-10 flex-1 rounded-md border border-steel-300 px-3 font-mono text-sm"
                />
              </div>
              {checkContrast ? (
                <Badge tone={passesAA(value) ? 'success' : 'danger'}>
                  {ratio ? t('settings.branding.contrastRatio', { ratio: ratio.toFixed(2) }) : t('settings.branding.contrastUnknown')}
                  {' · '}
                  {passesAA(value) ? t('settings.branding.contrastPass') : t('settings.branding.contrastFail')}
                </Badge>
              ) : null}
            </div>
          )}
        />
      )}
    />
  )
}

export function BrandingForm({ canUpdate, defaultValues }: { canUpdate: boolean; defaultValues: FormValues }) {
  const t = useTranslate()
  const { form, onSubmit, isPending } = useActionForm<FormValues, unknown>({
    schema,
    defaultValues,
    successMessageKey: 'settings.branding.saved',
    action: updateBrandingAction,
  })

  const values = form.watch()

  return (
    <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
      <Card>
        <Form form={form} onSubmit={onSubmit}>
          <CardContent className="grid gap-5 sm:grid-cols-2">
            <ColorField name="primaryColor" label={t('settings.branding.primaryColor')} checkContrast />
            <ColorField name="accentColor" label={t('settings.branding.accentColor')} checkContrast />
            <ColorField name="inkColor" label={t('settings.branding.inkColor')} checkContrast />
            <ColorField name="neutralColor" label={t('settings.branding.neutralColor')} />
            <ColorField name="surfaceColor" label={t('settings.branding.surfaceColor')} />
            <TextField<FormValues> name="headingFont" label={t('settings.branding.headingFont')} disabled={!canUpdate} />
            <TextField<FormValues> name="bodyFont" label={t('settings.branding.bodyFont')} disabled={!canUpdate} />
          </CardContent>
          {canUpdate ? (
            <CardFooter className="justify-end">
              <Button type="submit" loading={isPending}>
                {t('settings.actions.save')}
              </Button>
            </CardFooter>
          ) : null}
        </Form>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('settings.branding.previewTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border border-steel-200 p-4" style={{ backgroundColor: values.surfaceColor || '#FFFFFF' }}>
            <p className="text-lg font-bold" style={{ color: values.primaryColor, fontFamily: values.headingFont }}>
              {t('settings.branding.previewHeading')}
            </p>
            <p className="mt-1 text-sm" style={{ color: values.inkColor, fontFamily: values.bodyFont }}>
              {t('settings.branding.previewBody')}
            </p>
            <span
              className="mt-3 inline-block rounded-md px-3 py-1.5 text-sm font-semibold text-white"
              style={{ backgroundColor: values.accentColor }}
            >
              {t('settings.branding.previewButton')}
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
