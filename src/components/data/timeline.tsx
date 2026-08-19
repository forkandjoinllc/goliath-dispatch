import * as React from 'react'
import { cn } from '@/lib/utils'

export interface TimelineEvent {
  id: string
  /** Already formatted for display (caller applies `formatDateTime`). */
  time: string
  actor?: string
  description: React.ReactNode
  icon?: React.ComponentType<{ className?: string }>
  tone?: 'neutral' | 'success' | 'warning' | 'danger'
}

const TONE_DOT: Record<NonNullable<TimelineEvent['tone']>, string> = {
  neutral: 'bg-steel-400',
  success: 'bg-success-500',
  warning: 'bg-warning-500',
  danger: 'bg-danger-500',
}

/** Vertical event timeline — load status history, signature audit events. */
export function Timeline({ events, className }: { events: TimelineEvent[]; className?: string }) {
  return (
    <ol className={cn('relative space-y-6 border-l border-steel-200 pl-6', className)}>
      {events.map((event) => {
        const Icon = event.icon
        return (
          <li key={event.id} className="relative">
            <span
              aria-hidden="true"
              className={cn(
                'absolute -left-[1.65rem] top-0.5 flex size-4 items-center justify-center rounded-full ring-4 ring-white',
                TONE_DOT[event.tone ?? 'neutral'],
              )}
            >
              {Icon ? <Icon className="size-2.5 text-white" /> : null}
            </span>
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <time className="tabular text-xs font-semibold text-steel-600">{event.time}</time>
              {event.actor ? <span className="text-xs font-medium text-navy-700">{event.actor}</span> : null}
            </div>
            <div className="mt-0.5 text-sm text-carbon">{event.description}</div>
          </li>
        )
      })}
    </ol>
  )
}
