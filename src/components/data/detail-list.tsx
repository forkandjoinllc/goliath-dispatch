import * as React from 'react'
import { cn } from '@/lib/utils'

export interface DetailItem {
  key: string
  label: string
  value: React.ReactNode
  /** Renders the value with the masked treatment (dotted, monospace). */
  masked?: boolean
  fullWidth?: boolean
}

/** `<dl>`-based label/value grid used across every detail page. */
export function DetailList({ items, columns = 2, className }: { items: DetailItem[]; columns?: 2 | 3; className?: string }) {
  return (
    <dl
      className={cn(
        'grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2',
        columns === 3 && 'lg:grid-cols-3',
        className,
      )}
    >
      {items.map((item) => (
        <div key={item.key} className={cn(item.fullWidth && 'sm:col-span-2 lg:col-span-3')}>
          <dt className="text-xs font-semibold uppercase tracking-wide text-steel-600">{item.label}</dt>
          <dd
            className={cn(
              'mt-0.5 text-sm text-carbon',
              item.masked && 'font-mono tracking-wider text-steel-700',
            )}
          >
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}
