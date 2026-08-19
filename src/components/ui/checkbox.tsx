'use client'

import * as React from 'react'
import * as CheckboxPrimitive from '@radix-ui/react-checkbox'
import { Check, Minus } from 'lucide-react'
import { cn } from '@/lib/utils'

export const Checkbox = React.forwardRef<
  React.ComponentRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root> & { invalid?: boolean }
>(function Checkbox({ className, invalid, ...props }, ref) {
  return (
    <CheckboxPrimitive.Root
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        'peer size-5 shrink-0 rounded-sm border border-steel-400 bg-white',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]',
        'data-[state=checked]:border-navy-700 data-[state=checked]:bg-navy-700 data-[state=checked]:text-white',
        'data-[state=indeterminate]:border-navy-700 data-[state=indeterminate]:bg-navy-700 data-[state=indeterminate]:text-white',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'aria-[invalid=true]:border-danger-500',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center text-current">
        {props.checked === 'indeterminate' ? (
          <Minus className="size-3.5" aria-hidden="true" />
        ) : (
          <Check className="size-3.5" aria-hidden="true" />
        )}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
})
