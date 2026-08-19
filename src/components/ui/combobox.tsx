'use client'

import * as React from 'react'
import { Loader2, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Input } from './input'

export interface ComboboxOption {
  value: string
  label: string
  description?: string
}

export interface ComboboxProps {
  id?: string
  /** Current free-typed text (controlled). */
  query: string
  onQueryChange: (query: string) => void
  onSelect: (option: ComboboxOption) => void
  /** Debounced async lookup. Rejections are swallowed and surfaced as empty. */
  fetchOptions: (query: string) => Promise<ComboboxOption[]>
  debounceMs?: number
  minChars?: number
  placeholder?: string
  noResultsLabel: string
  loadingLabel: string
  minCharsLabel?: string
  invalid?: boolean
  disabled?: boolean
  className?: string
  'aria-describedby'?: string
}

/**
 * ARIA 1.2 combobox pattern: `role="combobox"` input owns `aria-expanded`,
 * `aria-controls` and `aria-activedescendant`; the popup is `role="listbox"`
 * with `role="option"` children. This is what customer and address
 * autocomplete are built from — pass the network call in as `fetchOptions`.
 */
export function Combobox({
  id,
  query,
  onQueryChange,
  onSelect,
  fetchOptions,
  debounceMs = 250,
  minChars = 2,
  placeholder,
  noResultsLabel,
  loadingLabel,
  minCharsLabel,
  invalid,
  disabled,
  className,
  ...aria
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [options, setOptions] = React.useState<ComboboxOption[]>([])
  const [activeIndex, setActiveIndex] = React.useState(-1)
  const requestIdRef = React.useRef(0)
  const listId = React.useId()
  const generatedInputId = React.useId()
  const inputId = id ?? generatedInputId
  const containerRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (query.trim().length < minChars) {
      setOptions([])
      setLoading(false)
      return
    }
    const requestId = ++requestIdRef.current
    setLoading(true)
    const timer = setTimeout(() => {
      fetchOptions(query)
        .then((results) => {
          if (requestIdRef.current === requestId) {
            setOptions(results)
            setActiveIndex(results.length > 0 ? 0 : -1)
          }
        })
        .catch(() => {
          if (requestIdRef.current === requestId) setOptions([])
        })
        .finally(() => {
          if (requestIdRef.current === requestId) setLoading(false)
        })
    }, debounceMs)
    return () => clearTimeout(timer)
  }, [query, minChars, debounceMs, fetchOptions])

  React.useEffect(() => {
    function handleOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [])

  const showPanel = open && query.trim().length >= minChars
  const activeId = activeIndex >= 0 && options[activeIndex] ? `${listId}-${activeIndex}` : undefined

  function commit(option: ComboboxOption) {
    onSelect(option)
    setOpen(false)
    setOptions([])
  }

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-steel-500" aria-hidden="true" />
        <Input
          id={inputId}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={showPanel}
          aria-controls={listId}
          aria-activedescendant={activeId}
          invalid={invalid}
          disabled={disabled}
          placeholder={placeholder}
          value={query}
          className="pl-9"
          onChange={(event) => {
            onQueryChange(event.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (!showPanel) return
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setActiveIndex((i) => (options.length === 0 ? -1 : (i + 1) % options.length))
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              setActiveIndex((i) => (options.length === 0 ? -1 : (i - 1 + options.length) % options.length))
            } else if (event.key === 'Enter') {
              if (activeIndex >= 0 && options[activeIndex]) {
                event.preventDefault()
                commit(options[activeIndex]!)
              }
            } else if (event.key === 'Escape') {
              setOpen(false)
            }
          }}
          {...aria}
        />
        {loading ? (
          <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-steel-500" aria-hidden="true" />
        ) : null}
      </div>
      {showPanel ? (
        <div
          id={listId}
          role="listbox"
          className="absolute z-50 mt-1 max-h-72 w-full overflow-y-auto rounded-md border border-steel-200 bg-white p-1 shadow-[var(--shadow-raised)]"
        >
          {loading ? (
            <p className="px-3 py-2 text-sm text-steel-600">{loadingLabel}</p>
          ) : options.length === 0 ? (
            <p className="px-3 py-2 text-sm text-steel-600">{noResultsLabel}</p>
          ) : (
            options.map((option, index) => (
              <div
                key={option.value}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === activeIndex}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseDown={(event) => {
                  event.preventDefault()
                  commit(option)
                }}
                className={cn(
                  'cursor-pointer rounded-sm px-3 py-2 text-sm',
                  index === activeIndex ? 'bg-navy-50 text-navy-700' : 'text-carbon',
                )}
              >
                <div className="font-medium">{option.label}</div>
                {option.description ? <div className="text-xs text-steel-600">{option.description}</div> : null}
              </div>
            ))
          )}
        </div>
      ) : null}
      {query.trim().length > 0 && query.trim().length < minChars && minCharsLabel && open ? (
        <p className="absolute z-50 mt-1 w-full rounded-md border border-steel-200 bg-white px-3 py-2 text-sm text-steel-600 shadow-[var(--shadow-raised)]">
          {minCharsLabel}
        </p>
      ) : null}
    </div>
  )
}
