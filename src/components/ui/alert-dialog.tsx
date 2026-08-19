'use client'

import * as React from 'react'
import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog'
import { cn } from '@/lib/utils'
import { Button, type ButtonProps } from './button'
import { Label } from './label'
import { Textarea } from './input'

export const AlertDialog = AlertDialogPrimitive.Root
export const AlertDialogTrigger = AlertDialogPrimitive.Trigger
export const AlertDialogPortal = AlertDialogPrimitive.Portal

export const AlertDialogOverlay = React.forwardRef<
  React.ComponentRef<typeof AlertDialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Overlay>
>(function AlertDialogOverlay({ className, ...props }, ref) {
  return (
    <AlertDialogPrimitive.Overlay
      ref={ref}
      className={cn(
        'fixed inset-0 z-50 bg-navy-950/40 backdrop-blur-[1px]',
        'data-[state=open]:animate-in data-[state=open]:fade-in data-[state=closed]:animate-out data-[state=closed]:fade-out',
        className,
      )}
      {...props}
    />
  )
})

export const AlertDialogContent = React.forwardRef<
  React.ComponentRef<typeof AlertDialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Content>
>(function AlertDialogContent({ className, ...props }, ref) {
  return (
    <AlertDialogPortal>
      <AlertDialogOverlay />
      <AlertDialogPrimitive.Content
        ref={ref}
        className={cn(
          'fixed left-1/2 top-1/2 z-50 grid w-full max-w-md -translate-x-1/2 -translate-y-1/2 gap-4',
          'max-h-[90dvh] overflow-y-auto rounded-lg border border-steel-200 bg-white p-6 shadow-[var(--shadow-overlay)]',
          'data-[state=open]:animate-in data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:zoom-out-95',
          className,
        )}
        {...props}
      />
    </AlertDialogPortal>
  )
})

export function AlertDialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col gap-1.5', className)} {...props} />
}

export function AlertDialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)} {...props} />
  )
}

export const AlertDialogTitle = React.forwardRef<
  React.ComponentRef<typeof AlertDialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Title>
>(function AlertDialogTitle({ className, ...props }, ref) {
  return (
    <AlertDialogPrimitive.Title ref={ref} className={cn('text-lg font-bold tracking-tight', className)} {...props} />
  )
})

export const AlertDialogDescription = React.forwardRef<
  React.ComponentRef<typeof AlertDialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Description>
>(function AlertDialogDescription({ className, ...props }, ref) {
  return (
    <AlertDialogPrimitive.Description ref={ref} className={cn('text-sm text-steel-600', className)} {...props} />
  )
})

export const AlertDialogAction = React.forwardRef<
  HTMLButtonElement,
  ButtonProps
>(function AlertDialogAction({ className, variant = 'primary', ...props }, ref) {
  return (
    <AlertDialogPrimitive.Action asChild>
      <Button ref={ref} variant={variant} className={className} {...props} />
    </AlertDialogPrimitive.Action>
  )
})

export const AlertDialogCancel = React.forwardRef<HTMLButtonElement, ButtonProps>(
  function AlertDialogCancel({ className, variant = 'secondary', ...props }, ref) {
    return (
      <AlertDialogPrimitive.Cancel asChild>
        <Button ref={ref} variant={variant} className={className} {...props} />
      </AlertDialogPrimitive.Cancel>
    )
  },
)

/**
 * Destructive actions and compliance overrides must be justified. This variant
 * disables the confirm action until a non-empty reason is entered, and the
 * reason is what callers pass on to the audit trail via `onConfirm`.
 */
export interface ReasonAlertDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  reasonLabel: string
  reasonPlaceholder?: string
  reasonHint?: string
  cancelLabel: string
  confirmLabel: string
  destructive?: boolean
  isPending?: boolean
  onConfirm: (reason: string) => void
}

export function ReasonAlertDialog({
  open,
  onOpenChange,
  title,
  description,
  reasonLabel,
  reasonPlaceholder,
  reasonHint,
  cancelLabel,
  confirmLabel,
  destructive = true,
  isPending = false,
  onConfirm,
}: ReasonAlertDialogProps) {
  const [reason, setReason] = React.useState('')
  const reasonId = React.useId()
  const hintId = React.useId()
  const trimmed = reason.trim()

  React.useEffect(() => {
    if (!open) setReason('')
  }, [open])

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description ? <AlertDialogDescription>{description}</AlertDialogDescription> : null}
        </AlertDialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor={reasonId} required>
            {reasonLabel}
          </Label>
          <Textarea
            id={reasonId}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={reasonPlaceholder}
            aria-describedby={reasonHint ? hintId : undefined}
            aria-required="true"
            rows={3}
          />
          {reasonHint ? (
            <p id={hintId} className="text-xs text-steel-600">
              {reasonHint}
            </p>
          ) : null}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>{cancelLabel}</AlertDialogCancel>
          <Button
            type="button"
            variant={destructive ? 'destructive' : 'primary'}
            disabled={trimmed.length === 0}
            loading={isPending}
            onClick={() => onConfirm(trimmed)}
          >
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
