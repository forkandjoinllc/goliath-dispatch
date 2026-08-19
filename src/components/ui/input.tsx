import * as React from 'react'
import { cn } from '@/lib/utils'

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Renders the error state and wires aria-invalid without extra plumbing. */
  invalid?: boolean
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, type = 'text', invalid, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      type={type}
      aria-invalid={invalid || undefined}
      className={cn(
        'flex h-10 w-full rounded-md border border-steel-300 bg-white px-3 py-2 text-sm text-carbon',
        'placeholder:text-steel-500',
        'focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-[var(--focus-ring)] focus-visible:border-safety-500',
        'disabled:cursor-not-allowed disabled:bg-steel-50 disabled:text-steel-500',
        'aria-[invalid=true]:border-danger-500 aria-[invalid=true]:focus-visible:outline-danger-500',
        'file:border-0 file:bg-transparent file:text-sm file:font-medium',
        className,
      )}
      {...props}
    />
  )
})

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }
>(function Textarea({ className, invalid, rows = 4, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      aria-invalid={invalid || undefined}
      className={cn(
        'flex w-full rounded-md border border-steel-300 bg-white px-3 py-2 text-sm text-carbon',
        'placeholder:text-steel-500',
        'focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-[var(--focus-ring)] focus-visible:border-safety-500',
        'disabled:cursor-not-allowed disabled:bg-steel-50',
        'aria-[invalid=true]:border-danger-500',
        className,
      )}
      {...props}
    />
  )
})
