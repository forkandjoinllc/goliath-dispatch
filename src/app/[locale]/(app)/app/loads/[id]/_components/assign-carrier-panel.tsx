'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Combobox, type ComboboxOption } from '@/components/ui/combobox'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { useTranslate } from '@/components/providers/i18n-provider'
import { assignCarrierAction, carrierAutocompleteAction } from '@/server/loads/actions'

export function AssignCarrierPanel({ loadId }: { loadId: string }) {
  const t = useTranslate()
  const router = useRouter()
  const { toast } = useToast()
  const [query, setQuery] = React.useState('')
  const [selected, setSelected] = React.useState<ComboboxOption | null>(null)
  const [isPending, setPending] = React.useState(false)

  async function handleAssign() {
    if (!selected) return
    setPending(true)
    const result = await assignCarrierAction({ loadId, carrierId: selected.value })
    setPending(false)
    if (result.ok) {
      toast({ tone: 'success', title: t('load.actions.assignCarrier') })
      router.refresh()
    } else {
      toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
    }
  }

  return (
    <div className="flex flex-wrap items-end gap-2 rounded-lg border border-steel-200 p-3">
      <div className="min-w-64 flex-1">
        <Combobox
          query={selected ? selected.label : query}
          onQueryChange={(next) => {
            setQuery(next)
            setSelected(null)
          }}
          onSelect={(option) => setSelected(option)}
          fetchOptions={async (q) => {
            const result = await carrierAutocompleteAction({ query: q })
            if (!result.ok) return []
            return result.data.map<ComboboxOption>((c) => ({
              value: c.id,
              label: c.legalName,
              description: [c.dotNumber ? `DOT ${c.dotNumber}` : null, c.mcNumber ? `MC ${c.mcNumber}` : null].filter(Boolean).join(' · '),
            }))
          }}
          placeholder={t('load.fields.carrier')}
          noResultsLabel={t('customer.autocomplete.noResults')}
          loadingLabel={t('common.states.loading')}
        />
      </div>
      <Button type="button" disabled={!selected} loading={isPending} onClick={handleAssign}>
        {t('load.actions.assignCarrier')}
      </Button>
    </div>
  )
}
