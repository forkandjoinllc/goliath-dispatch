'use client'

import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { CreditCard } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/ui/feedback'
import { useToast } from '@/components/ui/toast'
import { useI18n, useTranslate } from '@/components/providers/i18n-provider'
import { formatMoney } from '@/i18n/translate'
import { payInvoiceWithMockCardAction } from '@/server/invoices/actions'

/**
 * Carrier-facing "Pay now" panel. Drives the mock Stripe integration end to
 * end through the real webhook route — see
 * `payInvoiceWithMockCardAction` for why this only works against the mock
 * payment provider (`STRIPE_DRIVER!=live`).
 */
export function PayNowPanel({ invoiceId, balanceCents }: { invoiceId: string; balanceCents: number }) {
  const t = useTranslate()
  const { locale } = useI18n()
  const router = useRouter()
  const { toast } = useToast()
  const [isPending, startTransition] = useTransition()

  function pay() {
    startTransition(async () => {
      const result = await payInvoiceWithMockCardAction({ invoiceId })
      if (result.ok) {
        toast({ tone: 'success', title: t('finance.invoice.payment.success') })
        router.refresh()
        return
      }
      toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('finance.invoice.payment.panelTitle')}</CardTitle>
        <CardDescription>
          {t('finance.invoice.payment.panelDescription', { balance: formatMoney(balanceCents, locale) })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Alert tone="info">{t('finance.invoice.payment.mockNotice')}</Alert>
        <Button type="button" disabled={isPending} onClick={pay}>
          <CreditCard aria-hidden="true" />
          {isPending ? t('finance.invoice.payment.processing') : t('finance.invoice.payment.mockSubmit')}
        </Button>
      </CardContent>
    </Card>
  )
}
