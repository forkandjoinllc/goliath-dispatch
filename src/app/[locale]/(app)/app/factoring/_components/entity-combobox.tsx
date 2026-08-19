'use client'

import * as React from 'react'
import { Combobox, type ComboboxOption } from '@/components/ui/combobox'
import { useTranslate } from '@/components/providers/i18n-provider'

export interface EntityComboboxProps {
  id?: string
  value: string | null
  selectedLabel: string | null
  onChange: (value: string | null, label: string | null) => void
  search: (query: string) => Promise<ComboboxOption[]>
  placeholder?: string
  disabled?: boolean
  invalid?: boolean
  'aria-describedby'?: string
}

/**
 * A single-select id+label combobox backed by a server search action.
 * Renders the resolved label as read-only text with a "change" affordance
 * once something is selected, matching the masked-field pattern elsewhere.
 */
export function EntityCombobox({
  id,
  value,
  selectedLabel,
  onChange,
  search,
  placeholder,
  disabled,
  invalid,
  ...aria
}: EntityComboboxProps) {
  const t = useTranslate()
  const [query, setQuery] = React.useState('')

  if (value && selectedLabel) {
    return (
      <div className="flex items-center gap-2">
        <span className="flex-1 truncate rounded-md border border-steel-200 bg-steel-50 px-3 py-2 text-sm text-carbon">
          {selectedLabel}
        </span>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange(null, null)}
          className="shrink-0 text-xs font-semibold text-navy-700 underline underline-offset-2 hover:no-underline disabled:opacity-50"
        >
          {t('common.actions.clear')}
        </button>
      </div>
    )
  }

  return (
    <Combobox
      id={id}
      query={query}
      onQueryChange={setQuery}
      onSelect={(option: ComboboxOption) => onChange(option.value, option.label)}
      fetchOptions={search}
      placeholder={placeholder}
      disabled={disabled}
      invalid={invalid}
      noResultsLabel={t('common.states.noResults')}
      loadingLabel={t('common.states.loading')}
      {...aria}
    />
  )
}
