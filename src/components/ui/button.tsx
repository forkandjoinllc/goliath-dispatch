import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * The only button in the system. Variants map to intent, not colour, so a
 * destructive action looks the same everywhere it appears.
 */
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)] disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'bg-navy-700 text-white hover:bg-navy-600 active:bg-navy-800',
        // safety-500 (the brand's vivid accent orange) is 3.13:1 against
        // white text — below the 4.5:1 AA text-contrast floor. safety-700 is
        // 5.67:1; using it (rather than white-on-500) keeps the fix to the
        // token, not the accent hue itself, which is still used at -500 for
        // borders/icons/highlights where the 3:1 non-text threshold applies.
        accent: 'bg-safety-700 text-white hover:bg-safety-800 active:bg-safety-900',
        secondary: 'bg-white text-navy-700 border border-steel-300 hover:bg-steel-50',
        ghost: 'text-navy-700 hover:bg-navy-50',
        destructive: 'bg-danger-700 text-white hover:bg-danger-500',
        link: 'text-navy-700 underline-offset-4 hover:underline p-0 h-auto font-medium',
      },
      size: {
        sm: 'h-8 px-3 text-xs',
        md: 'h-10 px-4',
        lg: 'h-11 px-6 text-base',
        icon: 'h-10 w-10 p-0',
        iconSm: 'h-8 w-8 p-0',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
  loading?: boolean
  /** Announced to assistive tech while `loading` is true. */
  loadingLabel?: string
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, asChild = false, loading = false, loadingLabel, children, disabled, ...props },
  ref,
) {
  const Comp = asChild ? Slot : 'button'
  return (
    <Comp
      ref={ref}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? (
        <>
          <Loader2 className="animate-spin" aria-hidden="true" />
          <span className="sr-only">{loadingLabel ?? 'Loading'}</span>
          {children}
        </>
      ) : (
        children
      )}
    </Comp>
  )
})

export { buttonVariants }
