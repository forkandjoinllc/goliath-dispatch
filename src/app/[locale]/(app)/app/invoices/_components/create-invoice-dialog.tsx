'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { Plus } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { useToast } from '@/components/ui/toast'
import { useTranslate } from '@/components/providers/i18n-provider'
import { createInvoiceForLoadAction, searchLoadsForInvoiceAction } from '@/server/invoices/actions'
import { EntityCombobox } from './entity-combobox'

export function CreateInvoiceDialog({ locale }: { locale: string }) {
  const t = useTranslate()
  const router = useRouter()
  const { toast } = useToast()
  const [open, setOpen] = React.useState(false)
  const [loadId, setLoadId] = React.useState<string | null>(null)
  const [loadLabel, setLoadLabel] = React.useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function submit() {
    if (!loadId) return
    startTransition(async () => {
      const result = await createInvoiceForLoadAction({ loadId })
      if (result.ok) {
        setOpen(false)
        setLoadId(null)
        setLoadLabel(null)
        router.push(`/${locale}/app/invoices/${result.data.id}`)
        return
      }
      toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button">
          <Plus aria-hidden="true" />
          {t('finance.invoice.list.newInvoice')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('finance.invoice.list.newInvoice')}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label>{t('finance.invoice.fields.load')}</Label>
          <EntityCombobox
            value={loadId}
            selectedLabel={loadLabel}
            onChange={(value, label) => {
              setLoadId(value)
              setLoadLabel(label)
            }}
            search={async (query) => {
              const result = await searchLoadsForInvoiceAction({ query })
              return result.ok ? result.data : []
            }}
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
            {t('common.actions.cancel')}
          </Button>
          <Button type="button" disabled={!loadId || isPending} onClick={submit}>
            {t('common.actions.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
