'use client'

import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import type { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@/components/data/data-table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { useToast } from '@/components/ui/toast'
import { useTranslate } from '@/components/providers/i18n-provider'
import { deleteFactoringCompanyAction } from '@/server/factoring/actions'
import { CompanyFormDialog } from './company-form-dialog'
import type { FactoringCompany } from '@/db/schema'

export function FactoringCompanyList({
  companies,
  canManage,
}: {
  companies: FactoringCompany[]
  canManage: boolean
}) {
  const t = useTranslate()
  const router = useRouter()
  const { toast } = useToast()
  const [isPending, startTransition] = useTransition()

  function remove(companyId: string) {
    startTransition(async () => {
      const result = await deleteFactoringCompanyAction({ companyId })
      if (result.ok) {
        toast({ tone: 'success', title: t('finance.factoring.companies.deleteSuccess') })
        router.refresh()
        return
      }
      toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
    })
  }

  const columns: ColumnDef<FactoringCompany, unknown>[] = [
    { accessorKey: 'name', header: t('finance.factoring.companies.fields.name') },
    { accessorKey: 'contactName', header: t('finance.factoring.companies.fields.contactName'), cell: ({ row }) => row.original.contactName ?? '—' },
    { accessorKey: 'email', header: t('finance.factoring.companies.fields.email'), cell: ({ row }) => row.original.email ?? '—' },
    { accessorKey: 'phone', header: t('finance.factoring.companies.fields.phone'), cell: ({ row }) => row.original.phone ?? '—' },
    {
      accessorKey: 'active',
      header: t('finance.factoring.companies.fields.active'),
      cell: ({ row }) => (
        <Badge tone={row.original.active ? 'success' : 'neutral'}>
          {row.original.active ? t('common.labels.yes') : t('common.labels.no')}
        </Badge>
      ),
    },
    ...(canManage
      ? [
          {
            id: 'actions',
            header: '',
            cell: ({ row }: { row: { original: FactoringCompany } }) => (
              <div className="flex justify-end gap-2">
                <CompanyFormDialog
                  company={row.original}
                  trigger={
                    <Button type="button" variant="secondary" size="sm">
                      {t('common.actions.edit')}
                    </Button>
                  }
                />
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button type="button" variant="ghost" size="iconSm" disabled={isPending} aria-label={t('common.actions.delete')}>
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>{t('finance.factoring.companies.deleteConfirmTitle')}</AlertDialogTitle>
                      <AlertDialogDescription>{t('finance.factoring.companies.deleteConfirmBody')}</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>{t('common.actions.cancel')}</AlertDialogCancel>
                      <AlertDialogAction onClick={() => remove(row.original.id)}>
                        {t('common.actions.delete')}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            ),
          } satisfies ColumnDef<FactoringCompany, unknown>,
        ]
      : []),
  ]

  return (
    <div className="space-y-4">
      {canManage ? (
        <div className="flex justify-end">
          <CompanyFormDialog
            trigger={
              <Button type="button">
                <Plus aria-hidden="true" />
                {t('finance.factoring.companies.new')}
              </Button>
            }
          />
        </div>
      ) : null}
      <DataTable
        caption={t('finance.factoring.companies.title')}
        columns={columns}
        data={companies}
        totalCount={companies.length}
        page={1}
        pageSize={Math.max(companies.length, 1)}
        onPageChange={() => {}}
        onPageSizeChange={() => {}}
        emptyState={{ title: t('finance.factoring.companies.empty') }}
        errorState={{ title: t('common.states.error'), description: t('common.states.errorHint') }}
        renderMobileCard={(row) => (
          <div className="rounded-lg border border-steel-200 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-carbon">{row.name}</span>
              <Badge tone={row.active ? 'success' : 'neutral'}>
                {row.active ? t('common.labels.yes') : t('common.labels.no')}
              </Badge>
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
            resultsStatus: t('common.labels.results', { count: companies.length }),
            firstPage: t('common.table.firstPage'),
            previousPage: t('common.table.previousPage'),
            nextPage: t('common.table.nextPage'),
            lastPage: t('common.table.lastPage'),
            rowsPerPage: t('common.table.rowsPerPage'),
          },
        }}
      />
    </div>
  )
}
