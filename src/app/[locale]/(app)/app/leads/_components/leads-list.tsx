'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import type { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@/components/data/data-table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/components/ui/toast'
import { useI18n, useTranslate } from '@/components/providers/i18n-provider'
import { formatDateTime } from '@/i18n/translate'
import { assignLeadAction, updateLeadStatusAction } from '@/server/leads/actions'
import type { CarrierSignupPayload } from '@/server/leads/queries'
import type { Lead } from '@/db/schema'
import { ConvertLeadDialog } from './convert-lead-dialog'

const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'converted', 'disqualified'] as const
const LEAD_SOURCES = ['contact_form', 'carrier_signup', 'quote_request', 'resources'] as const

export interface LeadsListProps {
  locale: string
  rows: Lead[]
  payloadsByLeadId: Record<string, CarrierSignupPayload | null>
  assignableUsers: { userId: string; name: string }[]
  status: string
  source: string
  permissions: { canConvert: boolean; canUpdate: boolean }
}

export function LeadsList({ locale, rows, payloadsByLeadId, assignableUsers, status, source, permissions }: LeadsListProps) {
  const t = useTranslate()
  const { locale: i18nLocale, timezone } = useI18n()
  const router = useRouter()
  const { toast } = useToast()
  const [isPending, startTransition] = React.useTransition()
  const [convertLead, setConvertLead] = React.useState<Lead | null>(null)
  const nameById = React.useMemo(() => new Map(assignableUsers.map((u) => [u.userId, u.name])), [assignableUsers])

  function pushParams(next: Record<string, string | undefined>) {
    const params = new URLSearchParams({ status, source })
    for (const [key, value] of Object.entries(next)) {
      if (value === undefined || value === '') params.delete(key)
      else params.set(key, value)
    }
    router.push(`?${params.toString()}`)
  }

  function handleStatusChange(leadId: string, nextStatus: (typeof LEAD_STATUSES)[number]) {
    startTransition(async () => {
      const result = await updateLeadStatusAction({ leadId, status: nextStatus })
      if (result.ok) {
        toast({ tone: 'success', title: t('carrier.leads.statusUpdated') })
        router.refresh()
        return
      }
      toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
    })
  }

  function handleAssign(leadId: string, userId: string) {
    startTransition(async () => {
      const result = await assignLeadAction({ leadId, assignedToUserId: userId === 'unassigned' ? null : userId })
      if (result.ok) {
        toast({ tone: 'success', title: t('carrier.leads.assigned') })
        router.refresh()
        return
      }
      toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
    })
  }

  const columns: ColumnDef<Lead, unknown>[] = [
    {
      accessorKey: 'name',
      header: t('common.labels.name'),
      cell: ({ row }) => (
        <div>
          <p className="font-semibold text-carbon">
            {row.original.firstName} {row.original.lastName}
          </p>
          <p className="text-xs text-steel-600">{row.original.companyName ?? row.original.email}</p>
        </div>
      ),
    },
    {
      accessorKey: 'source',
      header: t('carrier.leads.source'),
      cell: ({ row }) => <Badge tone="neutral">{t(`carrier.leads.sources.${row.original.source}`)}</Badge>,
    },
    {
      accessorKey: 'status',
      header: t('common.labels.status'),
      cell: ({ row }) =>
        permissions.canUpdate ? (
          <Select
            value={row.original.status}
            onValueChange={(value) => handleStatusChange(row.original.id, value as (typeof LEAD_STATUSES)[number])}
          >
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LEAD_STATUSES.map((option) => (
                <SelectItem key={option} value={option}>
                  {t(`carrier.leads.statuses.${option}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Badge tone="neutral">{t(`carrier.leads.statuses.${row.original.status}`)}</Badge>
        ),
    },
    {
      accessorKey: 'assignedToUserId',
      header: t('carrier.leads.assignedTo'),
      cell: ({ row }) =>
        permissions.canUpdate ? (
          <Select
            value={row.original.assignedToUserId ?? 'unassigned'}
            onValueChange={(value) => handleAssign(row.original.id, value)}
          >
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="unassigned">{t('onboarding.board.unassigned')}</SelectItem>
              {assignableUsers.map((option) => (
                <SelectItem key={option.userId} value={option.userId}>
                  {option.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <span>{row.original.assignedToUserId ? nameById.get(row.original.assignedToUserId) ?? row.original.assignedToUserId : t('onboarding.board.unassigned')}</span>
        ),
    },
    {
      accessorKey: 'createdAt',
      header: t('common.labels.createdAt'),
      cell: ({ row }) => formatDateTime(row.original.createdAt, i18nLocale, timezone),
    },
    {
      id: 'actions',
      header: t('common.labels.actions'),
      cell: ({ row }) =>
        permissions.canConvert && row.original.source === 'carrier_signup' && row.original.status !== 'converted' ? (
          <Button size="sm" variant="secondary" disabled={isPending} onClick={() => setConvertLead(row.original)}>
            {t('carrier.leads.convert')}
          </Button>
        ) : null,
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Select value={status || 'all'} onValueChange={(v) => pushParams({ status: v === 'all' ? undefined : v })}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('carrier.list.allStatuses')}</SelectItem>
            {LEAD_STATUSES.map((option) => (
              <SelectItem key={option} value={option}>
                {t(`carrier.leads.statuses.${option}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={source || 'all'} onValueChange={(v) => pushParams({ source: v === 'all' ? undefined : v })}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('carrier.leads.allSources')}</SelectItem>
            {LEAD_SOURCES.map((option) => (
              <SelectItem key={option} value={option}>
                {t(`carrier.leads.sources.${option}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <DataTable
        caption={t('carrier.leads.title')}
        columns={columns}
        data={rows}
        totalCount={rows.length}
        page={1}
        pageSize={Math.max(rows.length, 1)}
        onPageChange={() => {}}
        onPageSizeChange={() => {}}
        emptyState={{ title: t('carrier.leads.empty') }}
        errorState={{ title: t('common.states.error'), description: t('common.states.errorHint') }}
        renderMobileCard={(row) => (
          <div className="rounded-lg border border-steel-200 p-3">
            <p className="font-semibold text-carbon">
              {row.firstName} {row.lastName}
            </p>
            <p className="text-xs text-steel-600">{row.companyName ?? row.email}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Badge tone="neutral">{t(`carrier.leads.sources.${row.source}`)}</Badge>
              <Badge tone="neutral">{t(`carrier.leads.statuses.${row.status}`)}</Badge>
            </div>
          </div>
        )}
        labels={{
          columnsMenu: t('common.table.columnsMenu'),
          actionsMenu: t('common.table.actionsMenu'),
          selectAll: t('common.table.selectAll'),
          selectRow: t('common.table.selectRow'),
          sortAscending: t('common.table.sortAscending'),
          sortDescending: t('common.table.sortDescending'),
          loading: t('common.states.loading'),
          pagination: {
            pageStatus: t('common.labels.page', { page: 1, total: 1 }),
            resultsStatus: t('common.labels.results', { count: rows.length }),
            firstPage: t('common.table.firstPage'),
            previousPage: t('common.table.previousPage'),
            nextPage: t('common.table.nextPage'),
            lastPage: t('common.table.lastPage'),
            rowsPerPage: t('common.table.rowsPerPage'),
          },
        }}
      />

      <ConvertLeadDialog
        locale={locale}
        lead={convertLead}
        payload={convertLead ? payloadsByLeadId[convertLead.id] ?? null : null}
        onOpenChange={(open) => !open && setConvertLead(null)}
      />
    </div>
  )
}
