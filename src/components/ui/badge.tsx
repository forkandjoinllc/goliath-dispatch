import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold whitespace-nowrap',
  {
    variants: {
      tone: {
        neutral: 'border-steel-200 bg-steel-50 text-steel-700',
        navy: 'border-navy-200 bg-navy-50 text-navy-700',
        accent: 'border-safety-200 bg-safety-50 text-safety-700',
        success: 'border-success-500/30 bg-success-50 text-success-700',
        warning: 'border-warning-500/30 bg-warning-50 text-warning-700',
        danger: 'border-danger-500/30 bg-danger-50 text-danger-700',
        info: 'border-info-500/30 bg-info-50 text-info-700',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  /** Renders a leading dot; useful where colour alone would carry meaning. */
  dot?: boolean
}

export function Badge({ className, tone, dot, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ tone }), className)} {...props}>
      {dot ? <span className="size-1.5 rounded-full bg-current" aria-hidden="true" /> : null}
      {children}
    </span>
  )
}

export { badgeVariants }
