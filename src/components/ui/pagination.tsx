'use client'

import * as React from 'react'
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from './button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './select'

export interface PaginationLabels {
  /** "Page {page} of {total}" already interpolated by the caller. */
  pageStatus: string
  /** "{count} results" already interpolated by the caller. */
  resultsStatus?: string
  firstPage: string
  previousPage: string
  nextPage: string
  lastPage: string
  rowsPerPage: string
}

export function Pagination({
  page,
  pageSize,
  totalCount,
  pageSizeOptions = [25, 50, 100],
  onPageChange,
  onPageSizeChange,
  labels,
  className,
}: {
  page: number
  pageSize: number
  totalCount: number
  pageSizeOptions?: number[]
  onPageChange: (page: number) => void
  onPageSizeChange?: (pageSize: number) => void
  labels: PaginationLabels
  className?: string
}) {
  const pageCount = Math.max(1, Math.ceil(totalCount / pageSize))
  const clampedPage = Math.min(Math.max(1, page), pageCount)

  return (
    <div
      className={cn(
        'flex flex-col gap-3 border-t border-steel-200 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between',
        className,
      )}
    >
      <div className="flex items-center gap-3 text-sm text-steel-600">
        <span className="tabular">{labels.resultsStatus ?? labels.pageStatus}</span>
        {onPageSizeChange ? (
          <span className="flex items-center gap-2">
            <span>{labels.rowsPerPage}</span>
            <Select value={String(pageSize)} onValueChange={(v) => onPageSizeChange(Number(v))}>
              <SelectTrigger className="h-8 w-20">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {pageSizeOptions.map((size) => (
                  <SelectItem key={size} value={String(size)}>
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </span>
        ) : null}
      </div>
      <nav aria-label={labels.pageStatus} className="flex items-center gap-1">
        <Button
          variant="secondary"
          size="iconSm"
          disabled={clampedPage <= 1}
          onClick={() => onPageChange(1)}
          aria-label={labels.firstPage}
        >
          <ChevronsLeft aria-hidden="true" />
        </Button>
        <Button
          variant="secondary"
          size="iconSm"
          disabled={clampedPage <= 1}
          onClick={() => onPageChange(clampedPage - 1)}
          aria-label={labels.previousPage}
        >
          <ChevronLeft aria-hidden="true" />
        </Button>
        <span className="tabular px-2 text-sm font-medium text-carbon" aria-live="polite">
          {labels.pageStatus}
        </span>
        <Button
          variant="secondary"
          size="iconSm"
          disabled={clampedPage >= pageCount}
          onClick={() => onPageChange(clampedPage + 1)}
          aria-label={labels.nextPage}
        >
          <ChevronRight aria-hidden="true" />
        </Button>
        <Button
          variant="secondary"
          size="iconSm"
          disabled={clampedPage >= pageCount}
          onClick={() => onPageChange(pageCount)}
          aria-label={labels.lastPage}
        >
          <ChevronsRight aria-hidden="true" />
        </Button>
      </nav>
    </div>
  )
}
