'use client'

import { z } from 'zod'
import { useActionForm } from '@/components/forms/use-action-form'
import { Form } from '@/components/forms/form'
import { TextField, TextareaField, CheckboxField } from '@/components/forms/fields'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useTranslate } from '@/components/providers/i18n-provider'
import { updateContactAction } from '@/server/settings/actions'

const businessHourSchema = z.object({ day: z.number(), open: z.string().nullable(), close: z.string().nullable(), closed: z.boolean() })

const schema = z.object({
  contactPhone: z.string().trim().max(32),
  contactEmail: z.string().trim().max(255),
  supportEmail: z.string().trim().max(255),
  addressLine1: z.string().trim().max(200),
  addressLine2: z.string().trim().max(200),
  addressCity: z.string().trim().max(120),
  addressState: z.string().trim().max(2),
  addressPostalCode: z.string().trim().max(12),
  businessHours: z.array(businessHourSchema),
  socialLinksText: z.string(),
})

type FormValues = z.infer<typeof schema>

function parseSocialLinks(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const [key, ...rest] = line.split('=')
    const value = rest.join('=').trim()
    if (key && key.trim() && value) out[key.trim()] = value
  }
  return out
}

export function ContactForm({
  canUpdate,
  dayKeys,
  defaultValues,
}: {
  canUpdate: boolean
  dayKeys: readonly string[]
  defaultValues: FormValues
}) {
  const t = useTranslate()
  const { form, onSubmit, isPending } = useActionForm<FormValues, unknown>({
    schema,
    defaultValues,
    successMessageKey: 'settings.contact.saved',
    action: (values) =>
      updateContactAction({
        contactPhone: values.contactPhone || null,
        contactEmail: values.contactEmail || null,
        supportEmail: values.supportEmail || null,
        addressLine1: values.addressLine1 || null,
        addressLine2: values.addressLine2 || null,
        addressCity: values.addressCity || null,
        addressState: values.addressState || null,
        addressPostalCode: values.addressPostalCode || null,
        businessHours: values.businessHours,
        socialLinks: parseSocialLinks(values.socialLinksText),
      }),
  })

  return (
    <Form form={form} onSubmit={onSubmit}>
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>{t('settings.contact.contactTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <TextField<FormValues> name="contactPhone" label={t('settings.contact.phone')} disabled={!canUpdate} />
            <TextField<FormValues> name="contactEmail" label={t('settings.contact.email')} disabled={!canUpdate} />
            <TextField<FormValues> name="supportEmail" label={t('settings.contact.supportEmail')} disabled={!canUpdate} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('settings.contact.addressTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <TextField<FormValues> name="addressLine1" label={t('settings.contact.line1')} disabled={!canUpdate} className="sm:col-span-2" />
            <TextField<FormValues> name="addressLine2" label={t('settings.contact.line2')} disabled={!canUpdate} className="sm:col-span-2" />
            <TextField<FormValues> name="addressCity" label={t('settings.contact.city')} disabled={!canUpdate} />
            <TextField<FormValues> name="addressState" label={t('settings.contact.state')} disabled={!canUpdate} />
            <TextField<FormValues> name="addressPostalCode" label={t('settings.contact.postalCode')} disabled={!canUpdate} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('settings.contact.businessHoursTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {dayKeys.map((dayKey, index) => (
              <div key={dayKey} className="flex flex-wrap items-center gap-3">
                <span className="w-28 text-sm font-medium text-carbon">{t(`settings.contact.days.${dayKey}`)}</span>
                <CheckboxField<FormValues> name={`businessHours.${index}.closed`} label={t('settings.contact.closed')} disabled={!canUpdate} />
                <Input
                  type="time"
                  disabled={!canUpdate}
                  defaultValue={defaultValues.businessHours[index]?.open ?? ''}
                  onChange={(event) => form.setValue(`businessHours.${index}.open`, event.target.value)}
                  className="w-32"
                />
                <span className="text-xs text-steel-500">{t('report.filters.to')}</span>
                <Input
                  type="time"
                  disabled={!canUpdate}
                  defaultValue={defaultValues.businessHours[index]?.close ?? ''}
                  onChange={(event) => form.setValue(`businessHours.${index}.close`, event.target.value)}
                  className="w-32"
                />
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('settings.contact.socialLinksTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            <TextareaField<FormValues>
              name="socialLinksText"
              label={t('settings.contact.socialLinksLabel')}
              description={t('settings.contact.socialLinksHint')}
              disabled={!canUpdate}
            />
          </CardContent>
        </Card>

        {canUpdate ? (
          <CardFooter className="justify-end px-0">
            <Button type="submit" loading={isPending}>
              {t('settings.actions.save')}
            </Button>
          </CardFooter>
        ) : null}
      </div>
    </Form>
  )
}
