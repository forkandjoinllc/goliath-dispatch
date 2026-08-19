'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { Plus, Trash2 } from 'lucide-react'
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
import { deleteExpenseCategoryAction } from '@/server/finance/actions'
import { CategoryFormDialog } from './category-form-dialog'
import type { ExpenseCategory } from '@/db/schema'

export function CategoryList({ locale, categories }: { locale: string; categories: ExpenseCategory[] }) {
  const t = useTranslate()
  const router = useRouter()
  const { toast } = useToast()
  const [isPending, startTransition] = useTransition()

  function remove(categoryId: string) {
    startTransition(async () => {
      const result = await deleteExpenseCategoryAction({ categoryId })
      if (result.ok) {
        toast({ tone: 'success', title: t('finance.expense.category.deleteSuccess') })
        router.refresh()
        return
      }
      toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
    })
  }

  const columns: ColumnDef<ExpenseCategory, unknown>[] = [
    {
      accessorKey: 'label',
      header: t('finance.expense.category.title'),
      cell: ({ row }) => (
        <span className="flex items-center gap-2 font-semibold text-carbon">
          {locale === 'es' ? row.original.labelEs : row.original.labelEn}
          {row.original.isSystem ? <Badge tone="navy">{t('finance.expense.category.systemBadge')}</Badge> : null}
        </span>
      ),
    },
    {
      accessorKey: 'code',
      header: t('finance.expense.category.code'),
      cell: ({ row }) => <span className="font-mono text-xs text-steel-600">{row.original.code}</span>,
    },
    {
      accessorKey: 'treatment',
      header: t('finance.expense.category.treatment'),
      cell: ({ row }) => <span>{t(`finance.expenseTreatment.${row.original.treatment}`)}</span>,
    },
    {
      accessorKey: 'requiresReceipt',
      header: t('finance.expense.category.requiresReceipt'),
      cell: ({ row }) => (row.original.requiresReceipt ? t('common.labels.yes') : t('common.labels.no')),
    },
    {
      accessorKey: 'active',
      header: t('finance.expense.category.active'),
      cell: ({ row }) => (
        <Badge tone={row.original.active ? 'success' : 'neutral'}>
          {row.original.active ? t('common.labels.yes') : t('common.labels.no')}
        </Badge>
      ),
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <div className="flex justify-end gap-2">
          <CategoryFormDialog
            category={row.original}
            trigger={
              <Button type="button" variant="secondary" size="sm">
                {t('common.actions.edit')}
              </Button>
            }
          />
          {!row.original.isSystem ? (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button type="button" variant="ghost" size="iconSm" disabled={isPending} aria-label={t('common.actions.delete')}>
                  <Trash2 aria-hidden="true" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t('finance.expense.category.deleteConfirmTitle')}</AlertDialogTitle>
                  <AlertDialogDescription>{t('finance.expense.category.deleteConfirmBody')}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t('common.actions.cancel')}</AlertDialogCancel>
                  <AlertDialogAction onClick={() => remove(row.original.id)}>
                    {t('common.actions.delete')}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : null}
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <CategoryFormDialog
          trigger={
            <Button type="button">
              <Plus aria-hidden="true" />
              {t('finance.expense.category.new')}
            </Button>
          }
        />
      </div>
      <DataTable
        caption={t('finance.expense.category.title')}
        columns={columns}
        data={categories}
        totalCount={categories.length}
        page={1}
        pageSize={Math.max(categories.length, 1)}
        onPageChange={() => {}}
        onPageSizeChange={() => {}}
        emptyState={{ title: t('common.states.empty') }}
        errorState={{ title: t('common.states.error'), description: t('common.states.errorHint') }}
        renderMobileCard={(row) => (
          <div className="rounded-lg border border-steel-200 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-carbon">{locale === 'es' ? row.labelEs : row.labelEn}</span>
              <Badge tone={row.active ? 'success' : 'neutral'}>
                {row.active ? t('common.labels.yes') : t('common.labels.no')}
              </Badge>
            </div>
            <div className="mt-1 text-xs text-steel-600">{t(`finance.expenseTreatment.${row.treatment}`)}</div>
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
            resultsStatus: t('common.labels.results', { count: categories.length }),
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
