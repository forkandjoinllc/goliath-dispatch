'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Send } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/components/ui/toast'
import { useTranslate } from '@/components/providers/i18n-provider'
import type { Locale } from '@/i18n/config'
import {
  createSignatureRequestAction,
  listSignatureTemplatesForRequestAction,
  type SignatureTemplateOption,
} from '@/server/signatures/actions'

const EXPIRY_OPTIONS = [7, 14, 30, 90] as const

/**
 * Reusable "send for signature" dialog. Any owning page (a carrier record, a
 * load, a tenant-level settings screen) mounts this with the subject it
 * wants signed and the token values it already has on hand — the dialog
 * itself only knows how to pick an active template and collect whatever
 * `requiredTokens` that template still needs.
 */
export interface SendForSignatureDialogProps {
  subjectType: 'carrier' | 'load' | 'tenant'
  subjectId: string
  carrierId?: string | null
  defaultSignerEmail?: string
  defaultSignerName?: string
  defaultSignerUserId?: string | null
  defaultLocale?: Locale
  /** Pre-known token values (e.g. `carrierLegalName`, `carrierDotNumber`) keyed by token name. */
  defaultTokenValues?: Record<string, string>
  trigger?: React.ReactNode
}

export function SendForSignatureDialog({
  subjectType,
  subjectId,
  carrierId,
  defaultSignerEmail,
  defaultSignerName,
  defaultSignerUserId,
  defaultLocale,
  defaultTokenValues,
  trigger,
}: SendForSignatureDialogProps) {
  const t = useTranslate()
  const router = useRouter()
  const { toast } = useToast()

  const [open, setOpen] = React.useState(false)
  const [templates, setTemplates] = React.useState<SignatureTemplateOption[] | null>(null)
  const [loadingTemplates, startLoadTemplates] = React.useTransition()
  const [isPending, startTransition] = React.useTransition()

  const [templateKey, setTemplateKey] = React.useState('')
  const [signerEmail, setSignerEmail] = React.useState(defaultSignerEmail ?? '')
  const [locale, setLocale] = React.useState<Locale>(defaultLocale ?? 'en')
  const [expiresInDays, setExpiresInDays] = React.useState<number | null>(14)
  const [tokenValues, setTokenValues] = React.useState<Record<string, string>>(defaultTokenValues ?? {})

  React.useEffect(() => {
    if (!open) return
    startLoadTemplates(async () => {
      const result = await listSignatureTemplatesForRequestAction({ carrierId: carrierId ?? null })
      if (result.ok) {
        setTemplates(result.data)
        setTemplateKey((current) => current || (result.data[0]?.templateKey ?? ''))
      } else {
        toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const selectedTemplate = templates?.find((template) => template.templateKey === templateKey) ?? null

  function handleSubmit() {
    if (!selectedTemplate) return
    startTransition(async () => {
      const result = await createSignatureRequestAction({
        templateKey: selectedTemplate.templateKey,
        subjectType,
        subjectId,
        carrierId: carrierId ?? null,
        signerUserId: defaultSignerUserId ?? null,
        signerEmail,
        locale,
        tokenValues,
        expiresInDays: expiresInDays ?? undefined,
      })
      if (!result.ok) {
        toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
        return
      }
      toast({ tone: 'success', title: t('signature.sendDialog.success') })
      setOpen(false)
      router.refresh()
    })
  }

  const canSubmit = Boolean(selectedTemplate) && signerEmail.trim().length > 0 && !isPending

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="primary">
            <Send aria-hidden="true" />
            {t('signature.sendDialog.title')}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent closeLabel={t('common.actions.cancel')} className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('signature.sendDialog.title')}</DialogTitle>
          <DialogDescription>{t('signature.sendDialog.description')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-1.5">
            <Label htmlFor="send-signature-template">{t('signature.sendDialog.template')}</Label>
            {loadingTemplates || templates === null ? (
              <p className="text-sm text-steel-600">{t('common.states.loading')}</p>
            ) : templates.length === 0 ? (
              <p className="text-sm text-steel-600">{t('signature.sendDialog.noTemplatesAvailable')}</p>
            ) : (
              <Select value={templateKey} onValueChange={setTemplateKey}>
                <SelectTrigger id="send-signature-template">
                  <SelectValue placeholder={t('signature.sendDialog.selectTemplatePlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {templates.map((template) => (
                    <SelectItem key={template.templateKey} value={template.templateKey}>
                      {locale === 'es' ? template.titleEs : template.titleEn}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="send-signature-email">{t('signature.sendDialog.signerEmail')}</Label>
              <Input
                id="send-signature-email"
                type="email"
                value={signerEmail}
                onChange={(event) => setSignerEmail(event.target.value)}
                required
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="send-signature-name">{t('signature.sendDialog.signerName')}</Label>
              <Input
                id="send-signature-name"
                value={defaultSignerName ?? ''}
                readOnly={Boolean(defaultSignerName)}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="send-signature-locale">{t('signature.sendDialog.locale')}</Label>
              <Select value={locale} onValueChange={(value) => setLocale(value as Locale)}>
                <SelectTrigger id="send-signature-locale">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">{t('signature.sendDialog.localeOptions.en')}</SelectItem>
                  <SelectItem value="es">{t('signature.sendDialog.localeOptions.es')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="send-signature-expiry">{t('signature.sendDialog.expiresInDays')}</Label>
              <Select
                value={expiresInDays === null ? 'none' : String(expiresInDays)}
                onValueChange={(value) => setExpiresInDays(value === 'none' ? null : Number(value))}
              >
                <SelectTrigger id="send-signature-expiry">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EXPIRY_OPTIONS.map((days) => (
                    <SelectItem key={days} value={String(days)}>
                      {days}
                    </SelectItem>
                  ))}
                  <SelectItem value="none">{t('signature.sendDialog.noExpiry')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {selectedTemplate && selectedTemplate.requiredTokens.length > 0 ? (
            <fieldset className="space-y-3 rounded-lg border border-steel-200 p-3">
              <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-steel-600">
                {t('signature.sendDialog.tokenValues')}
              </legend>
              {selectedTemplate.requiredTokens.map((token) => (
                <div key={token} className="grid gap-1.5">
                  <Label htmlFor={`send-signature-token-${token}`} className="font-mono text-xs">
                    {token}
                  </Label>
                  <Input
                    id={`send-signature-token-${token}`}
                    value={tokenValues[token] ?? ''}
                    onChange={(event) =>
                      setTokenValues((current) => ({ ...current, [token]: event.target.value }))
                    }
                  />
                </div>
              ))}
            </fieldset>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={() => setOpen(false)} disabled={isPending}>
            {t('common.actions.cancel')}
          </Button>
          <Button variant="primary" onClick={handleSubmit} disabled={!canSubmit} loading={isPending}>
            {t('signature.sendDialog.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
