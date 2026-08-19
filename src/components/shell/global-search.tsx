'use client'

import * as React from 'react'
import { Loader2, Search } from 'lucide-react'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { useTranslate } from '@/components/providers/i18n-provider'

export type GlobalSearchGroupKey =
  | 'loads'
  | 'carriers'
  | 'customers'
  | 'drivers'
  | 'trucks'
  | 'trailers'
  | 'invoices'

export interface GlobalSearchResultItem {
  id: string
  label: string
  description?: string
  href: string
}

export type GlobalSearchResults = Partial<Record<GlobalSearchGroupKey, GlobalSearchResultItem[]>>

export interface GlobalSearchProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  search: (query: string) => Promise<GlobalSearchResults>
  onNavigate: (href: string) => void
  recentItems?: GlobalSearchResultItem[]
  debounceMs?: number
  closeLabel?: string
}

const GROUP_KEYS: GlobalSearchGroupKey[] = [
  'loads',
  'carriers',
  'customers',
  'drivers',
  'trucks',
  'trailers',
  'invoices',
]

/**
 * The `/`-triggered command palette. Debounced, grouped, keyboard-navigable
 * — the `search` function is supplied by the caller so this stays free of
 * any data-layer import.
 */
export function GlobalSearch({
  open,
  onOpenChange,
  search,
  onNavigate,
  recentItems,
  debounceMs = 250,
  closeLabel = 'Close',
}: GlobalSearchProps) {
  const t = useTranslate()
  const [query, setQuery] = React.useState('')
  const [results, setResults] = React.useState<GlobalSearchResults>({})
  const [loading, setLoading] = React.useState(false)
  const requestId = React.useRef(0)
  const inputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    if (!open) {
      setQuery('')
      setResults({})
    }
  }, [open])

  React.useEffect(() => {
    if (query.trim().length === 0) {
      setResults({})
      setLoading(false)
      return
    }
    const id = ++requestId.current
    setLoading(true)
    const timer = setTimeout(() => {
      search(query)
        .then((r) => {
          if (requestId.current === id) setResults(r)
        })
        .finally(() => {
          if (requestId.current === id) setLoading(false)
        })
    }, debounceMs)
    return () => clearTimeout(timer)
  }, [query, debounceMs, search])

  const hrefById = React.useMemo(() => {
    const map = new Map<string, string>()
    for (const group of GROUP_KEYS) {
      for (const item of results[group] ?? []) map.set(item.id, item.href)
    }
    for (const item of recentItems ?? []) map.set(item.id, item.href)
    return map
  }, [results, recentItems])

  const hasQuery = query.trim().length > 0
  const hasAnyResults = GROUP_KEYS.some((group) => (results[group]?.length ?? 0) > 0)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        closeLabel={closeLabel}
        className="top-[15%] max-w-xl translate-y-0 p-0"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          inputRef.current?.focus()
        }}
      >
        <Command onSelect={(id) => {
          const href = hrefById.get(id)
          if (href) {
            onNavigate(href)
            onOpenChange(false)
          }
        }}>
          <div className="relative">
            <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-steel-500" aria-hidden="true" />
            <CommandInput
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('nav.search.placeholder')}
              className="pl-11"
            />
            {loading ? (
              <Loader2 className="absolute right-4 top-1/2 size-4 -translate-y-1/2 animate-spin text-steel-500" aria-hidden="true" />
            ) : null}
          </div>
          <CommandList label={t('nav.search.placeholder')}>
            {!hasQuery && recentItems && recentItems.length > 0 ? (
              <CommandGroup heading={t('nav.search.recent')}>
                {recentItems.map((item) => (
                  <CommandItem key={item.id} id={item.id}>
                    <div>
                      <p className="font-medium">{item.label}</p>
                      {item.description ? <p className="text-xs text-steel-600">{item.description}</p> : null}
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
            {hasQuery && !loading && !hasAnyResults ? (
              <CommandEmpty>{t('nav.search.noResults', { query })}</CommandEmpty>
            ) : null}
            {hasQuery
              ? GROUP_KEYS.map((group) => {
                  const items = results[group]
                  if (!items || items.length === 0) return null
                  return (
                    <CommandGroup key={group} heading={t(`nav.search.groups.${group}`)}>
                      {items.map((item) => (
                        <CommandItem key={item.id} id={item.id}>
                          <div>
                            <p className="font-medium">{item.label}</p>
                            {item.description ? (
                              <p className="text-xs text-steel-600">{item.description}</p>
                            ) : null}
                          </div>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  )
                })
              : null}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  )
}
