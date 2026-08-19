'use client'

import * as React from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslate } from '@/components/providers/i18n-provider'

export interface BreadcrumbItem {
  label: string
  href?: string
}

/**
 * Presentational only — the caller supplies an `<a>`-compatible `LinkComponent`
 * (typically Next's `Link`) so this stays free of app-router imports.
 */
export function Breadcrumb({
  items,
  homeLabel,
  homeHref,
  LinkComponent = 'a',
  className,
}: {
  items: BreadcrumbItem[]
  homeLabel?: string
  homeHref?: string
  LinkComponent?: React.ElementType
  className?: string
}) {
  const t = useTranslate()
  const allItems = homeLabel ? [{ label: homeLabel, href: homeHref ?? '/' }, ...items] : items
  return (
    <nav aria-label={t('nav.breadcrumb.nav')} className={cn('flex', className)}>
      <ol className="flex flex-wrap items-center gap-1.5 text-sm text-steel-600">
        {allItems.map((item, index) => {
          const isLast = index === allItems.length - 1
          return (
            <li key={`${item.label}-${index}`} className="flex items-center gap-1.5">
              {index > 0 ? <ChevronRight className="size-3.5 shrink-0 text-steel-400" aria-hidden="true" /> : null}
              {item.href && !isLast ? (
                <LinkComponent
                  href={item.href}
                  className="rounded transition-colors hover:text-navy-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
                >
                  {item.label}
                </LinkComponent>
              ) : (
                <span className={cn(isLast && 'font-semibold text-carbon')} aria-current={isLast ? 'page' : undefined}>
                  {item.label}
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
