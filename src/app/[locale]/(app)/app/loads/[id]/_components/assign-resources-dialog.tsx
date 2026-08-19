'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Alert, EmptyState } from '@/components/ui/feedback'
import { useToast } from '@/components/ui/toast'
import { useTranslate } from '@/components/providers/i18n-provider'
import type { Trailer, Truck, Driver } from '@/db/schema'
import { fullName } from '@/lib/utils'
import {
  assignResourcesAction,
  listAssignmentCandidatesAction,
  type AssignmentCandidates,
} from '@/server/loads/actions'

interface CandidateRow {
  id: string
  label: string
  ok: boolean
  reasons: { code: string; messageKey: string; params?: Record<string, string | number> }[]
}

function equipmentRows(items: AssignmentCandidates['trucks'] | AssignmentCandidates['trailers']): CandidateRow[] {
  return items.map((item) => ({
    id: item.equipment.id,
    label: (item.equipment as Truck | Trailer).unitNumber,
    ok: item.compliance.ok,
    reasons: item.compliance.blocking,
  }))
}

function driverRows(items: AssignmentCandidates['drivers']): CandidateRow[] {
  return items.map((item) => ({
    id: item.driver.id,
    label: fullName(item.driver as Driver),
    ok: item.compliance.ok,
    reasons: item.compliance.blocking,
  }))
}

function CandidateSection({
  title,
  rows,
  selected,
  onToggle,
  emptyLabel,
}: {
  title: string
  rows: CandidateRow[]
  selected: Set<string>
  onToggle: (id: string) => void
  emptyLabel: string
}) {
  const t = useTranslate()
  if (rows.length === 0) return null
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-bold text-carbon">{title}</h4>
      <ul className="space-y-2">
        {rows.map((row) => {
          const id = `candidate-${row.id}`
          return (
            <li key={row.id} className="rounded-lg border border-steel-200 p-2">
              <div className="flex items-center gap-2">
                <Checkbox id={id} checked={selected.has(row.id)} disabled={!row.ok} onCheckedChange={() => onToggle(row.id)} />
                <Label htmlFor={id} className="font-normal">
                  {row.label}
                </Label>
                {!row.ok ? <span className="text-xs font-semibold text-danger-700">{t('load.assignments.dialog.blocked')}</span> : null}
              </div>
              {!row.ok ? (
                <ul className="mt-1 list-inside list-disc pl-6 text-xs text-danger-700">
                  {row.reasons.map((reason, index) => (
                    <li key={`${reason.code}-${index}`}>{t(reason.messageKey, reason.params)}</li>
                  ))}
                </ul>
              ) : null}
            </li>
          )
        })}
      </ul>
      {rows.length === 0 ? <EmptyState title={emptyLabel} /> : null}
    </div>
  )
}

export function AssignResourcesDialog({
  loadId,
  hasCarrier,
  open,
  onOpenChange,
}: {
  loadId: string
  hasCarrier: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const t = useTranslate()
  const router = useRouter()
  const { toast } = useToast()
  const [loading, setLoading] = React.useState(false)
  const [candidates, setCandidates] = React.useState<AssignmentCandidates | null>(null)
  const [selectedTrucks, setSelectedTrucks] = React.useState<Set<string>>(new Set())
  const [selectedTrailers, setSelectedTrailers] = React.useState<Set<string>>(new Set())
  const [selectedDrivers, setSelectedDrivers] = React.useState<Set<string>>(new Set())
  const [isPending, setPending] = React.useState(false)

  React.useEffect(() => {
    if (!open || !hasCarrier) return
    setLoading(true)
    setSelectedTrucks(new Set())
    setSelectedTrailers(new Set())
    setSelectedDrivers(new Set())
    listAssignmentCandidatesAction({ loadId }).then((result) => {
      setLoading(false)
      if (result.ok) setCandidates(result.data)
      else toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
    })
  }, [open, hasCarrier, loadId, t, toast])

  function toggle(set: Set<string>, setSet: (s: Set<string>) => void, id: string) {
    const next = new Set(set)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSet(next)
  }

  async function handleSubmit() {
    setPending(true)
    const result = await assignResourcesAction({
      loadId,
      truckIds: [...selectedTrucks],
      trailerIds: [...selectedTrailers],
      driverIds: [...selectedDrivers],
    })
    setPending(false)
    if (!result.ok) {
      toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
      return
    }
    if (result.data.status === 'blocked') {
      toast({ tone: 'error', title: t('load.assignments.dialog.allBlockedWarning') })
      return
    }
    onOpenChange(false)
    router.refresh()
  }

  const hasSelection = selectedTrucks.size + selectedTrailers.size + selectedDrivers.size > 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('common.actions.close')} className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('load.assignments.dialog.title')}</DialogTitle>
          {!hasCarrier ? <DialogDescription>{t('load.assignments.dialog.carrierRequired')}</DialogDescription> : null}
        </DialogHeader>

        {!hasCarrier ? (
          <Alert tone="warning">{t('load.assignments.dialog.carrierRequired')}</Alert>
        ) : loading || !candidates ? (
          <p className="text-sm text-steel-600">{t('common.states.loading')}</p>
        ) : equipmentRows(candidates.trucks).length + equipmentRows(candidates.trailers).length + driverRows(candidates.drivers).length === 0 ? (
          <EmptyState title={t('load.assignments.dialog.noneAvailable')} />
        ) : (
          <div className="max-h-[50vh] space-y-4 overflow-y-auto">
            <CandidateSection
              title={t('load.assignments.dialog.trucks')}
              rows={equipmentRows(candidates.trucks)}
              selected={selectedTrucks}
              onToggle={(id) => toggle(selectedTrucks, setSelectedTrucks, id)}
              emptyLabel={t('load.assignments.dialog.noneAvailable')}
            />
            <CandidateSection
              title={t('load.assignments.dialog.trailers')}
              rows={equipmentRows(candidates.trailers)}
              selected={selectedTrailers}
              onToggle={(id) => toggle(selectedTrailers, setSelectedTrailers, id)}
              emptyLabel={t('load.assignments.dialog.noneAvailable')}
            />
            <CandidateSection
              title={t('load.assignments.dialog.drivers')}
              rows={driverRows(candidates.drivers)}
              selected={selectedDrivers}
              onToggle={(id) => toggle(selectedDrivers, setSelectedDrivers, id)}
              emptyLabel={t('load.assignments.dialog.noneAvailable')}
            />
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            {t('load.assignments.dialog.cancel')}
          </Button>
          <Button type="button" disabled={!hasCarrier || !hasSelection} loading={isPending} onClick={handleSubmit}>
            {t('load.assignments.dialog.assign')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
