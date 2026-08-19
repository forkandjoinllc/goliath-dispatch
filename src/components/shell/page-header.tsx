import * as React from 'react'
import { cn } from '@/lib/utils'
import { Breadcrumb, type BreadcrumbItem } from '@/components/ui/breadcrumb'

export interface PageHeaderProps {
  title: string
  description?: string
  breadcrumb?: BreadcrumbItem[]
  homeLabel?: string
  homeHref?: string
  LinkComponent?: React.ElementType
  /** e.g. a StatusBadge or ComplianceBadge. */
  status?: React.ReactNode
  primaryAction?: React.ReactNode
  secondaryActions?: React.ReactNode
  className?: string
}

/** The consistent top-of-page block: breadcrumb, title, status, actions. */
export function PageHeader({
  title,
  description,
  breadcrumb,
  homeLabel,
  homeHref,
  LinkComponent,
  status,
  primaryAction,
  secondaryActions,
  className,
}: PageHeaderProps) {
  return (
    <header className={cn('flex flex-col gap-3 border-b border-steel-200 pb-4', className)}>
      {breadcrumb && breadcrumb.length > 0 ? (
        <Breadcrumb items={breadcrumb} homeLabel={homeLabel} homeHref={homeHref} LinkComponent={LinkComponent} />
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-carbon">{title}</h1>
            {status}
          </div>
          {description ? <p className="mt-1 max-w-2xl text-sm text-steel-600">{description}</p> : null}
        </div>
        {(primaryAction || secondaryActions) ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {secondaryActions}
            {primaryAction}
          </div>
        ) : null}
      </div>
    </header>
  )
}
