import * as React from 'react'
import { AlertTriangle, Info, Inbox, Lock, ShieldAlert, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * The four states every data surface must be able to render: loading, empty,
 * error and permission-denied. Having them as shared components is what makes
 * "no placeholder UI" enforceable — a screen either shows data or one of these.
 */

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('animate-pulse rounded bg-steel-200/70', className)}
      aria-hidden="true"
      {...props}
    />
  )
}

export function TableSkeleton({
  rows = 5,
  columns = 5,
  label = 'Loading',
}: {
  rows?: number
  columns?: number
  /** Screen-reader status text — callers with i18n access should pass `t('common.states.loading')`. */
  label?: string
}) {
  return (
    <div className="space-y-2 p-4" role="status" aria-busy="true">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={rowIndex} className="flex gap-3">
          {Array.from({ length: columns }).map((__, columnIndex) => (
            <Skeleton
              key={columnIndex}
              className={cn('h-8 flex-1', columnIndex === 0 && 'max-w-[180px]')}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

export function EmptyState({
  title,
  description,
  action,
  icon: Icon = Inbox,
  className,
}: {
  title: string
  description?: string
  action?: React.ReactNode
  icon?: React.ComponentType<{ className?: string }>
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-14 text-center', className)}>
      <div className="mb-4 grid size-12 place-items-center rounded-full bg-steel-100">
        <Icon className="size-6 text-steel-500" aria-hidden="true" />
      </div>
      <h3 className="text-base font-bold">{title}</h3>
      {description ? <p className="mt-1 max-w-md text-sm text-steel-600">{description}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  )
}

export function ErrorState({
  title,
  description,
  action,
  className,
}: {
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div
      role="alert"
      className={cn('flex flex-col items-center justify-center px-6 py-14 text-center', className)}
    >
      <div className="mb-4 grid size-12 place-items-center rounded-full bg-danger-50">
        <XCircle className="size-6 text-danger-700" aria-hidden="true" />
      </div>
      <h3 className="text-base font-bold">{title}</h3>
      {description ? <p className="mt-1 max-w-md text-sm text-steel-600">{description}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  )
}

export function PermissionDenied({
  title,
  description,
  className,
}: {
  title: string
  description?: string
  className?: string
}) {
  return (
    <div
      role="alert"
      className={cn('flex flex-col items-center justify-center px-6 py-14 text-center', className)}
    >
      <div className="mb-4 grid size-12 place-items-center rounded-full bg-steel-100">
        <Lock className="size-6 text-steel-600" aria-hidden="true" />
      </div>
      <h3 className="text-base font-bold">{title}</h3>
      {description ? <p className="mt-1 max-w-md text-sm text-steel-600">{description}</p> : null}
    </div>
  )
}

const ALERT_TONE = {
  info: { className: 'border-info-500/30 bg-info-50 text-info-700', Icon: Info },
  warning: { className: 'border-warning-500/30 bg-warning-50 text-warning-700', Icon: AlertTriangle },
  danger: { className: 'border-danger-500/30 bg-danger-50 text-danger-700', Icon: ShieldAlert },
} as const

export function Alert({
  tone = 'info',
  title,
  children,
  className,
}: {
  tone?: keyof typeof ALERT_TONE
  title?: string
  children?: React.ReactNode
  className?: string
}) {
  const { className: toneClass, Icon } = ALERT_TONE[tone]
  return (
    <div
      role={tone === 'info' ? 'note' : 'alert'}
      className={cn('flex gap-3 rounded-lg border p-4 text-sm', toneClass, className)}
    >
      <Icon className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
      <div className="space-y-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className="opacity-90">{children}</div> : null}
      </div>
    </div>
  )
}
