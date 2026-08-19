'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * A keyboard-navigable command list, built directly on a controlled popover
 * (no dependency added). The active item is tracked as a single index and
 * exposed to assistive tech through `aria-activedescendant` on the input —
 * the WAI-ARIA APG's alternative to DOM roving tabindex for a composite
 * widget whose focus stays on a filter input while the candidate list
 * reshapes on every keystroke. Focus never leaves the input; arrow keys,
 * Home/End and Enter all operate through it.
 */

export interface CommandItemDescriptor {
  id: string
  disabled?: boolean
}

interface CommandContextValue {
  activeId: string | null
  setActiveId: (id: string | null) => void
  register: (item: CommandItemDescriptor) => () => void
  listId: string
  onSelect: (id: string) => void
}

const CommandContext = React.createContext<CommandContextValue | null>(null)

function useCommandContext() {
  const ctx = React.useContext(CommandContext)
  if (!ctx) throw new Error('Command.* must be used inside <Command>')
  return ctx
}

export function Command({
  children,
  onSelect,
  className,
}: {
  children: React.ReactNode
  onSelect: (id: string) => void
  className?: string
}) {
  const listId = React.useId()
  const itemsRef = React.useRef<CommandItemDescriptor[]>([])
  const [activeId, setActiveId] = React.useState<string | null>(null)

  const register = React.useCallback((item: CommandItemDescriptor) => {
    itemsRef.current = [...itemsRef.current, item]
    return () => {
      itemsRef.current = itemsRef.current.filter((i) => i.id !== item.id)
    }
  }, [])

  const value = React.useMemo<CommandContextValue>(
    () => ({ activeId, setActiveId, register, listId, onSelect }),
    [activeId, register, listId, onSelect],
  )

  // Expose a helper for the input to move the active index without each
  // consumer re-deriving the enabled item list.
  ;(value as CommandContextValue & { __move?: (dir: 1 | -1 | 'home' | 'end') => void }).__move = (
    dir,
  ) => {
    const enabled = itemsRef.current.filter((i) => !i.disabled)
    if (enabled.length === 0) return setActiveId(null)
    const currentIndex = enabled.findIndex((i) => i.id === activeId)
    let nextIndex: number
    if (dir === 'home') nextIndex = 0
    else if (dir === 'end') nextIndex = enabled.length - 1
    else if (currentIndex === -1) nextIndex = dir === 1 ? 0 : enabled.length - 1
    else nextIndex = (currentIndex + dir + enabled.length) % enabled.length
    setActiveId(enabled[nextIndex]!.id)
  }

  return (
    <CommandContext.Provider value={value}>
      <div className={className}>{children}</div>
    </CommandContext.Provider>
  )
}

export const CommandInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function CommandInput({ className, onKeyDown, ...props }, ref) {
    const ctx = useCommandContext()
    const move = (ctx as CommandContextValue & { __move?: (dir: 1 | -1 | 'home' | 'end') => void }).__move

    return (
      <input
        ref={ref}
        role="combobox"
        aria-expanded="true"
        aria-controls={ctx.listId}
        aria-activedescendant={ctx.activeId ?? undefined}
        autoComplete="off"
        className={cn(
          'w-full border-0 border-b border-steel-200 bg-transparent px-4 py-3 text-sm text-carbon outline-none placeholder:text-steel-500',
          'focus-visible:border-safety-500',
          className,
        )}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            move?.(1)
          } else if (event.key === 'ArrowUp') {
            event.preventDefault()
            move?.(-1)
          } else if (event.key === 'Home') {
            move?.('home')
          } else if (event.key === 'End') {
            move?.('end')
          } else if (event.key === 'Enter') {
            event.preventDefault()
            if (ctx.activeId) ctx.onSelect(ctx.activeId)
          }
          onKeyDown?.(event)
        }}
        {...props}
      />
    )
  },
)

export function CommandList({
  children,
  label,
  className,
}: {
  children: React.ReactNode
  label: string
  className?: string
}) {
  const ctx = useCommandContext()
  return (
    <div
      id={ctx.listId}
      role="listbox"
      aria-label={label}
      className={cn('max-h-80 overflow-y-auto p-1', className)}
    >
      {children}
    </div>
  )
}

export function CommandGroup({
  heading,
  children,
  className,
}: {
  heading: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div role="group" aria-label={heading} className={cn('py-1', className)}>
      <div className="px-3 py-1 text-xs font-semibold uppercase tracking-wide text-steel-500">{heading}</div>
      {children}
    </div>
  )
}

export function CommandItem({
  id,
  disabled,
  children,
  className,
  onMouseEnter,
}: {
  id: string
  disabled?: boolean
  children: React.ReactNode
  className?: string
  onMouseEnter?: () => void
}) {
  const ctx = useCommandContext()
  React.useEffect(() => ctx.register({ id, disabled }), [ctx, id, disabled])
  const active = ctx.activeId === id
  const itemRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (active) itemRef.current?.scrollIntoView({ block: 'nearest' })
  }, [active])

  return (
    <div
      ref={itemRef}
      id={id}
      role="option"
      aria-selected={active}
      aria-disabled={disabled || undefined}
      onMouseEnter={() => {
        if (!disabled) ctx.setActiveId(id)
        onMouseEnter?.()
      }}
      onMouseDown={(event) => {
        // Prevent the input from losing focus when clicking an option.
        event.preventDefault()
        if (!disabled) ctx.onSelect(id)
      }}
      className={cn(
        'flex cursor-pointer items-center gap-2 rounded-sm px-3 py-2 text-sm text-carbon',
        active && 'bg-navy-50 text-navy-700',
        disabled && 'pointer-events-none opacity-50',
        className,
      )}
    >
      {children}
    </div>
  )
}

export function CommandEmpty({ children }: { children: React.ReactNode }) {
  return (
    <div role="status" className="px-3 py-6 text-center text-sm text-steel-600">
      {children}
    </div>
  )
}
