import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Semantic table primitives. `caption` is required by `DataTable` so every
 * table has an accessible name; numeric cells set `data-numeric` to pick up
 * tabular figures and right alignment.
 */

export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn('w-full caption-bottom border-collapse text-sm', className)} {...props} />
    </div>
  )
}

export function TableHeader({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn('border-b border-steel-200 bg-steel-50', className)} {...props} />
}

export function TableBody({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn('divide-y divide-steel-100', className)} {...props} />
}

export function TableFooter({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <tfoot
      className={cn('border-t border-steel-200 bg-steel-50 font-semibold', className)}
      {...props}
    />
  )
}

export function TableRow({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn(
        'transition-colors hover:bg-navy-50/50 data-[state=selected]:bg-navy-50',
        className,
      )}
      {...props}
    />
  )
}

export function TableHead({
  className,
  numeric,
  ...props
}: React.ThHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <th
      scope="col"
      data-numeric={numeric || undefined}
      className={cn(
        'px-3 py-2.5 text-left align-middle text-xs font-semibold uppercase tracking-wide text-steel-600',
        numeric && 'text-right',
        className,
      )}
      {...props}
    />
  )
}

export function TableCell({
  className,
  numeric,
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <td
      data-numeric={numeric || undefined}
      className={cn('px-3 py-2.5 align-middle', numeric && 'text-right', className)}
      {...props}
    />
  )
}

export function TableCaption({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return <caption className={cn('sr-only', className)} {...props} />
}
