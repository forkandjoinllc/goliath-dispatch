'use client'

import * as React from 'react'
import { Line, LineChart, ResponsiveContainer } from 'recharts'
import { ArrowDown, ArrowUp, Minus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Card } from '@/components/ui/card'

export interface StatCardDelta {
  direction: 'up' | 'down' | 'flat'
  /** Already formatted, e.g. "+4.2%". */
  value: string
  /** Accessible description of what the delta means, e.g. "up 4.2% versus last week". */
  description: string
  /** Whether an increase is good news for this metric (colours the delta). */
  positiveIsGood?: boolean
}

export interface StatCardProps {
  label: string
  value: string
  delta?: StatCardDelta
  sparkline?: number[]
  className?: string
}

const DELTA_ICON = { up: ArrowUp, down: ArrowDown, flat: Minus } as const

export function StatCard({ label, value, delta, sparkline, className }: StatCardProps) {
  const DeltaIcon = delta ? DELTA_ICON[delta.direction] : null
  const deltaIsGood =
    delta &&
    (delta.direction === 'flat'
      ? true
      : (delta.direction === 'up') === (delta.positiveIsGood ?? true))

  return (
    <Card className={cn('p-4', className)}>
      <p className="text-xs font-semibold uppercase tracking-wide text-steel-600">{label}</p>
      <div className="mt-1 flex items-end justify-between gap-3">
        <p className="tabular text-2xl font-bold text-carbon">{value}</p>
        {sparkline && sparkline.length > 1 ? (
          <div className="h-10 w-24" aria-hidden="true">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={sparkline.map((v, i) => ({ i, v }))}>
                <Line type="monotone" dataKey="v" stroke="#062B5C" strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : null}
      </div>
      {delta ? (
        <p
          className={cn(
            'mt-2 flex items-center gap-1 text-xs font-semibold',
            deltaIsGood ? 'text-success-700' : 'text-danger-700',
          )}
        >
          {DeltaIcon ? <DeltaIcon className="size-3.5" aria-hidden="true" /> : null}
          <span aria-hidden="true">{delta.value}</span>
          <span className="sr-only">{delta.description}</span>
        </p>
      ) : null}
    </Card>
  )
}
