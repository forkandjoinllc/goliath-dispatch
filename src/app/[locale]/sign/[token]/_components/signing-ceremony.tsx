'use client'

import * as React from 'react'
import { ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/components/ui/toast'
import { useTranslate } from '@/components/providers/i18n-provider'
import { SignaturePad, type SignaturePadHandle } from '@/components/ui/signature-pad'
import type { Locale } from '@/i18n/config'
import {
  declineSignatureAction,
  recordSignatureViewAction,
  submitSignatureAction,
} from '@/server/signatures/actions'
import { DeclineDialog } from './decline-dialog'
import { DeclinedScreen } from './declined-screen'
import { SuccessScreen } from './success-screen'

export interface SigningCeremonyProps {
  token: string
  locale: Locale
  tenantName: string
  title: string
  body: string
  consentCopy: string
  signerEmail: string
}

type Phase = 'ceremony' | 'success' | 'declined'

export function SigningCeremony({ token, tenantName, title, body, consentCopy, signerEmail }: SigningCeremonyProps) {
  const t = useTranslate()
  const { toast } = useToast()

  const [phase, setPhase] = React.useState<Phase>('ceremony')
  const [scrolledToEnd, setScrolledToEnd] = React.useState(false)
  const [consentAccepted, setConsentAccepted] = React.useState(false)
  const [legalName, setLegalName] = React.useState('')
  const [signerTitle, setSignerTitle] = React.useState('')
  const [padState, setPadState] = React.useState({ mode: 'draw' as 'draw' | 'type', hasContent: false, typedName: '' })
  const [submitting, setSubmitting] = React.useState(false)
  const [declineOpen, setDeclineOpen] = React.useState(false)
  const [declining, setDeclining] = React.useState(false)
  const padRef = React.useRef<SignaturePadHandle>(null)
  const bodyRef = React.useRef<HTMLDivElement>(null)
  const viewedRecorded = React.useRef(false)

  React.useEffect(() => {
    void recordSignatureViewAction({ token, eventType: 'opened' })
  }, [token])

  function handleScroll() {
    const el = bodyRef.current
    if (!el || viewedRecorded.current) return
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 8) {
      viewedRecorded.current = true
      setScrolledToEnd(true)
      void recordSignatureViewAction({ token, eventType: 'viewed' })
    }
  }

  const canSubmit = consentAccepted && legalName.trim().length > 0 && padState.hasContent && !submitting

  async function handleSubmit() {
    setSubmitting(true)
    const dataUrl = padRef.current?.toDataUrl() ?? null
    const result = await submitSignatureAction({
      token,
      signerLegalName: legalName.trim(),
      signerTitle: signerTitle.trim() || undefined,
      method: padState.mode === 'type' ? 'typed' : 'drawn',
      signatureDataUrl: dataUrl,
      typedName: padState.mode === 'type' ? padState.typedName : null,
      hasDrawnStrokes: padState.mode === 'draw' ? padState.hasContent : false,
      consentAccepted,
    })
    setSubmitting(false)
    if (!result.ok) {
      toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
      return
    }
    setPhase('success')
  }

  async function handleDecline(reason: string) {
    setDeclining(true)
    const result = await declineSignatureAction({ token, reason })
    setDeclining(false)
    if (!result.ok) {
      toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
      return
    }
    setDeclineOpen(false)
    setPhase('declined')
  }

  if (phase === 'success') return <SuccessScreen token={token} signerEmail={signerEmail} />
  if (phase === 'declined') return <DeclinedScreen />

  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-6 p-4 sm:p-8">
      <header className="flex items-center gap-3 border-b border-steel-200 pb-4">
        <ShieldCheck className="size-8 shrink-0 text-navy-700" aria-hidden="true" />
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold uppercase tracking-wide text-steel-500">{tenantName}</p>
          <h1 className="truncate text-lg font-bold text-carbon">{title}</h1>
        </div>
      </header>

      <div
        ref={bodyRef}
        onScroll={handleScroll}
        className="max-h-[45vh] overflow-y-auto rounded-md border border-steel-200 bg-white p-4"
      >
        {body.split('\n\n').map((paragraph, index) => (
          <p key={index} className="mb-3 text-sm leading-relaxed text-carbon last:mb-0">
            {paragraph}
          </p>
        ))}
      </div>
      <p className="-mt-4 text-xs text-steel-500" aria-live="polite">
        {scrolledToEnd ? t('signature.ceremony.scrolledToEnd') : t('signature.ceremony.scrollHint')}
      </p>

      <section className="space-y-3 rounded-md border border-steel-200 bg-steel-50 p-4">
        <h2 className="text-sm font-bold text-carbon">{t('signature.ceremony.consentHeading')}</h2>
        <p className="text-xs text-steel-600">{consentCopy}</p>
        <div className="flex items-start gap-2">
          <Checkbox
            id="consent-accepted"
            checked={consentAccepted}
            onCheckedChange={(checked) => setConsentAccepted(Boolean(checked))}
          />
          <Label htmlFor="consent-accepted" className="font-normal">
            {t('signature.ceremony.consentCheckbox')}
          </Label>
        </div>
        <p className="text-xs italic text-steel-500">{t('signature.ceremony.legalNotice')}</p>
      </section>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="signer-legal-name">{t('signature.ceremony.legalNameLabel')}</Label>
          <Input
            id="signer-legal-name"
            value={legalName}
            onChange={(event) => setLegalName(event.target.value)}
            placeholder={t('signature.ceremony.legalNamePlaceholder')}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="signer-title">{t('signature.ceremony.titleLabel')}</Label>
          <Input
            id="signer-title"
            value={signerTitle}
            onChange={(event) => setSignerTitle(event.target.value)}
            placeholder={t('signature.ceremony.titlePlaceholder')}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>{t('signature.ceremony.signatureHeading')}</Label>
        <SignaturePad
          ref={padRef}
          labels={{
            drawTab: t('signature.pad.drawTab'),
            typeTab: t('signature.pad.typeTab'),
            clear: t('signature.pad.clear'),
            undo: t('signature.pad.undo'),
            canvasLabel: t('signature.ceremony.signHere'),
            typedPlaceholder: t('signature.ceremony.legalNamePlaceholder'),
            typedPreviewLabel: t('signature.ceremony.signHere'),
          }}
          onChange={(state) => setPadState(state)}
        />
      </div>

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
        <Button type="button" variant="ghost" onClick={() => setDeclineOpen(true)} disabled={submitting}>
          {t('signature.ceremony.decline')}
        </Button>
        <Button type="button" onClick={() => void handleSubmit()} disabled={!canSubmit}>
          {submitting ? t('signature.ceremony.submitting') : t('signature.ceremony.submit')}
        </Button>
      </div>

      <DeclineDialog
        open={declineOpen}
        onOpenChange={setDeclineOpen}
        onConfirm={handleDecline}
        submitting={declining}
      />
    </div>
  )
}
