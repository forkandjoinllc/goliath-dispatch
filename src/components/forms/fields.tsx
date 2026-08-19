'use client'

import * as React from 'react'
import { Controller, type FieldPath, type FieldValues } from 'react-hook-form'
import { Eye, EyeOff } from 'lucide-react'
import { useFormContext } from './form'
import { FormField } from './form'
import { Input, Textarea } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { DatePicker, type DatePickerProps } from '@/components/ui/date-picker'
import { DateTimePicker, type DateTimePickerProps } from '@/components/ui/date-time-picker'
import { FileDrop, type FileDropItem, type FileDropLabels } from '@/components/ui/file-drop'
import { Combobox, type ComboboxOption } from '@/components/ui/combobox'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/components/providers/i18n-provider'
import { cn } from '@/lib/utils'

interface CommonProps<TFieldValues extends FieldValues> {
  name: FieldPath<TFieldValues>
  label?: string
  description?: string
  required?: boolean
  disabled?: boolean
  className?: string
}

/* ── Text ─────────────────────────────────────────────────────────────── */

export function TextField<TFieldValues extends FieldValues>({
  name,
  label,
  description,
  required,
  disabled,
  className,
  placeholder,
  type = 'text',
  autoComplete,
}: CommonProps<TFieldValues> & {
  placeholder?: string
  type?: 'text' | 'email' | 'url' | 'password'
  autoComplete?: string
}) {
  const { control } = useFormContext<TFieldValues>()
  const [revealed, setRevealed] = React.useState(false)
  const isPassword = type === 'password'
  return (
    <FormField<TFieldValues>
      name={name}
      label={label}
      description={description}
      required={required}
      className={className}
      render={(bind) => (
        <Controller
          control={control}
          name={name}
          render={({ field }) => (
            <div className={isPassword ? 'relative' : undefined}>
              <Input
                {...bind}
                {...field}
                value={field.value ?? ''}
                type={isPassword ? (revealed ? 'text' : 'password') : type}
                placeholder={placeholder}
                disabled={disabled}
                autoComplete={autoComplete}
                className={isPassword ? 'pr-10' : undefined}
              />
              {isPassword ? (
                <button
                  type="button"
                  onClick={() => setRevealed((r) => !r)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-steel-500 hover:text-carbon focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
                  aria-label={revealed ? 'Hide' : 'Show'}
                >
                  {revealed ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
                </button>
              ) : null}
            </div>
          )}
        />
      )}
    />
  )
}

export function TextareaField<TFieldValues extends FieldValues>({
  name,
  label,
  description,
  required,
  disabled,
  className,
  placeholder,
  rows,
}: CommonProps<TFieldValues> & { placeholder?: string; rows?: number }) {
  const { control } = useFormContext<TFieldValues>()
  return (
    <FormField<TFieldValues>
      name={name}
      label={label}
      description={description}
      required={required}
      className={className}
      render={(bind) => (
        <Controller
          control={control}
          name={name}
          render={({ field }) => (
            <Textarea
              {...bind}
              {...field}
              value={field.value ?? ''}
              placeholder={placeholder}
              disabled={disabled}
              rows={rows}
            />
          )}
        />
      )}
    />
  )
}

/* ── Select ───────────────────────────────────────────────────────────── */

export interface SelectFieldOption {
  value: string
  label: string
}

export function SelectField<TFieldValues extends FieldValues>({
  name,
  label,
  description,
  required,
  disabled,
  className,
  options,
  placeholder,
}: CommonProps<TFieldValues> & { options: SelectFieldOption[]; placeholder?: string }) {
  const { control } = useFormContext<TFieldValues>()
  return (
    <FormField<TFieldValues>
      name={name}
      label={label}
      description={description}
      required={required}
      className={className}
      render={(bind) => (
        <Controller
          control={control}
          name={name}
          render={({ field }) => (
            <Select value={field.value ?? undefined} onValueChange={field.onChange} disabled={disabled}>
              <SelectTrigger id={bind.id} invalid={bind.invalid} aria-describedby={bind['aria-describedby']}>
                <SelectValue placeholder={placeholder} />
              </SelectTrigger>
              <SelectContent>
                {options.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      )}
    />
  )
}

/* ── Checkbox / Radio / Switch ────────────────────────────────────────── */

export function CheckboxField<TFieldValues extends FieldValues>({
  name,
  label,
  description,
  disabled,
  className,
}: CommonProps<TFieldValues>) {
  const { control } = useFormContext<TFieldValues>()
  return (
    <FormField<TFieldValues>
      name={name}
      description={description}
      className={className}
      render={(bind) => (
        <Controller
          control={control}
          name={name}
          render={({ field }) => (
            <div className="flex items-center gap-2">
              <Checkbox
                id={bind.id}
                checked={Boolean(field.value)}
                onCheckedChange={field.onChange}
                disabled={disabled}
                invalid={bind.invalid}
                aria-describedby={bind['aria-describedby']}
              />
              {label ? (
                <Label htmlFor={bind.id} className="font-normal">
                  {label}
                </Label>
              ) : null}
            </div>
          )}
        />
      )}
    />
  )
}

export function RadioField<TFieldValues extends FieldValues>({
  name,
  label,
  description,
  required,
  disabled,
  className,
  options,
}: CommonProps<TFieldValues> & { options: SelectFieldOption[] }) {
  const { control } = useFormContext<TFieldValues>()
  return (
    <FormField<TFieldValues>
      name={name}
      label={label}
      description={description}
      required={required}
      className={className}
      render={(bind) => (
        <Controller
          control={control}
          name={name}
          render={({ field }) => (
            <RadioGroup
              value={field.value}
              onValueChange={field.onChange}
              disabled={disabled}
              aria-describedby={bind['aria-describedby']}
            >
              {options.map((option) => {
                const itemId = `${bind.id}-${option.value}`
                return (
                  <div key={option.value} className="flex items-center gap-2">
                    <RadioGroupItem id={itemId} value={option.value} />
                    <Label htmlFor={itemId} className="font-normal">
                      {option.label}
                    </Label>
                  </div>
                )
              })}
            </RadioGroup>
          )}
        />
      )}
    />
  )
}

export function SwitchField<TFieldValues extends FieldValues>({
  name,
  label,
  description,
  disabled,
  className,
}: CommonProps<TFieldValues>) {
  const { control } = useFormContext<TFieldValues>()
  return (
    <FormField<TFieldValues>
      name={name}
      description={description}
      className={className}
      render={(bind) => (
        <Controller
          control={control}
          name={name}
          render={({ field }) => (
            <div className="flex items-center gap-2">
              <Switch
                id={bind.id}
                checked={Boolean(field.value)}
                onCheckedChange={field.onChange}
                disabled={disabled}
                aria-describedby={bind['aria-describedby']}
              />
              {label ? <Label htmlFor={bind.id}>{label}</Label> : null}
            </div>
          )}
        />
      )}
    />
  )
}

/* ── Date / DateTime ──────────────────────────────────────────────────── */

export function DateField<TFieldValues extends FieldValues>({
  name,
  label,
  description,
  required,
  disabled,
  className,
  pickerLabels,
  timeZone,
}: CommonProps<TFieldValues> & {
  timeZone: string
  pickerLabels: Omit<DatePickerProps, 'value' | 'onChange' | 'timeZone' | 'localeTag' | 'id' | 'disabled' | 'invalid'>
}) {
  const { control } = useFormContext<TFieldValues>()
  const { locale } = useI18n()
  return (
    <FormField<TFieldValues>
      name={name}
      label={label}
      description={description}
      required={required}
      className={className}
      render={(bind) => (
        <Controller
          control={control}
          name={name}
          render={({ field }) => (
            <DatePicker
              {...pickerLabels}
              id={bind.id}
              value={field.value ?? null}
              onChange={field.onChange}
              timeZone={timeZone}
              localeTag={locale}
              disabled={disabled}
              invalid={bind.invalid}
              aria-describedby={bind['aria-describedby']}
            />
          )}
        />
      )}
    />
  )
}

export function DateTimeField<TFieldValues extends FieldValues>({
  name,
  label,
  description,
  required,
  disabled,
  className,
  pickerLabels,
  timeZone,
}: CommonProps<TFieldValues> & {
  timeZone: string
  pickerLabels: Omit<
    DateTimePickerProps,
    'value' | 'onChange' | 'timeZone' | 'localeTag' | 'id' | 'disabled' | 'invalid'
  >
}) {
  const { control } = useFormContext<TFieldValues>()
  const { locale } = useI18n()
  return (
    <FormField<TFieldValues>
      name={name}
      label={label}
      description={description}
      required={required}
      className={className}
      render={(bind) => (
        <Controller
          control={control}
          name={name}
          render={({ field }) => (
            <DateTimePicker
              {...pickerLabels}
              id={bind.id}
              value={field.value ?? null}
              onChange={field.onChange}
              timeZone={timeZone}
              localeTag={locale}
              disabled={disabled}
              invalid={bind.invalid}
              aria-describedby={bind['aria-describedby']}
            />
          )}
        />
      )}
    />
  )
}

/* ── Money / Percent / Phone ──────────────────────────────────────────── */

function parseDecimal(raw: string): number | null {
  const cleaned = raw.replace(/[^0-9.-]/g, '')
  if (cleaned.trim() === '' || cleaned === '-') return null
  const value = Number(cleaned)
  return Number.isFinite(value) ? value : null
}

/** Types dollars, submits integer cents. Never routes a float through state. */
export function MoneyField<TFieldValues extends FieldValues>({
  name,
  label,
  description,
  required,
  disabled,
  className,
  placeholder,
}: CommonProps<TFieldValues> & { placeholder?: string }) {
  const { control } = useFormContext<TFieldValues>()
  const { locale } = useI18n()

  return (
    <FormField<TFieldValues>
      name={name}
      label={label}
      description={description}
      required={required}
      className={className}
      render={(bind) => (
        <Controller
          control={control}
          name={name}
          render={({ field }) => (
            <MoneyInput
              bind={bind}
              value={field.value}
              onChange={field.onChange}
              onFieldBlur={field.onBlur}
              locale={locale}
              disabled={disabled}
              placeholder={placeholder}
            />
          )}
        />
      )}
    />
  )
}

function MoneyInput({
  bind,
  value,
  onChange,
  onFieldBlur,
  locale,
  disabled,
  placeholder,
}: {
  bind: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }
  value: number | null | undefined
  onChange: (cents: number | null) => void
  onFieldBlur: () => void
  locale: string
  disabled?: boolean
  placeholder?: string
}) {
  const [text, setText] = React.useState<string>(() => centsToDisplay(value, locale))
  const lastCommittedCents = React.useRef<number | null | undefined>(value)

  React.useEffect(() => {
    if (value !== lastCommittedCents.current) {
      setText(centsToDisplay(value, locale))
      lastCommittedCents.current = value
    }
  }, [value, locale])

  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-steel-500">
        $
      </span>
      <Input
        {...bind}
        className="pl-6 text-right tabular"
        inputMode="decimal"
        disabled={disabled}
        placeholder={placeholder}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => {
          const dollars = parseDecimal(text)
          const cents = dollars === null ? null : Math.round(dollars * 100)
          lastCommittedCents.current = cents
          onChange(cents)
          setText(centsToDisplay(cents, locale))
          onFieldBlur()
        }}
      />
    </div>
  )
}

function centsToDisplay(cents: number | null | undefined, locale: string): string {
  if (cents === null || cents === undefined) return ''
  return new Intl.NumberFormat(locale === 'es' ? 'es-US' : 'en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100)
}

/** Types a percentage, submits basis points (10.5 → 1050). */
export function PercentField<TFieldValues extends FieldValues>({
  name,
  label,
  description,
  required,
  disabled,
  className,
  placeholder,
}: CommonProps<TFieldValues> & { placeholder?: string }) {
  const { control } = useFormContext<TFieldValues>()

  return (
    <FormField<TFieldValues>
      name={name}
      label={label}
      description={description}
      required={required}
      className={className}
      render={(bind) => (
        <Controller
          control={control}
          name={name}
          render={({ field }) => (
            <PercentInput
              bind={bind}
              value={field.value}
              onChange={field.onChange}
              onFieldBlur={field.onBlur}
              disabled={disabled}
              placeholder={placeholder}
            />
          )}
        />
      )}
    />
  )
}

function PercentInput({
  bind,
  value,
  onChange,
  onFieldBlur,
  disabled,
  placeholder,
}: {
  bind: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }
  value: number | null | undefined
  onChange: (bps: number | null) => void
  onFieldBlur: () => void
  disabled?: boolean
  placeholder?: string
}) {
  const [text, setText] = React.useState<string>(() => bpsToDisplay(value))
  const lastCommitted = React.useRef<number | null | undefined>(value)

  React.useEffect(() => {
    if (value !== lastCommitted.current) {
      setText(bpsToDisplay(value))
      lastCommitted.current = value
    }
  }, [value])

  return (
    <div className="relative">
      <Input
        {...bind}
        className="pr-7 text-right tabular"
        inputMode="decimal"
        disabled={disabled}
        placeholder={placeholder}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => {
          const percent = parseDecimal(text)
          const bps = percent === null ? null : Math.round(percent * 100)
          lastCommitted.current = bps
          onChange(bps)
          setText(bpsToDisplay(bps))
          onFieldBlur()
        }}
      />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-steel-500">
        %
      </span>
    </div>
  )
}

function bpsToDisplay(bps: number | null | undefined): string {
  if (bps === null || bps === undefined) return ''
  const percent = bps / 100
  return Number.isInteger(percent) ? String(percent) : percent.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
}

function formatPhoneAsTyped(digits: string): string {
  const d = digits.slice(0, 10)
  if (d.length <= 3) return d
  if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
}

/** Formats as typed, submits raw digits only. */
export function PhoneField<TFieldValues extends FieldValues>({
  name,
  label,
  description,
  required,
  disabled,
  className,
  placeholder,
}: CommonProps<TFieldValues> & { placeholder?: string }) {
  const { control } = useFormContext<TFieldValues>()
  return (
    <FormField<TFieldValues>
      name={name}
      label={label}
      description={description}
      required={required}
      className={className}
      render={(bind) => (
        <Controller
          control={control}
          name={name}
          render={({ field }) => (
            <Input
              {...bind}
              type="tel"
              inputMode="tel"
              disabled={disabled}
              placeholder={placeholder}
              value={formatPhoneAsTyped(field.value ?? '')}
              onChange={(event) => field.onChange(event.target.value.replace(/\D/g, '').slice(0, 10))}
              onBlur={field.onBlur}
            />
          )}
        />
      )}
    />
  )
}

/* ── Masked (EIN / tax ID / licence) ──────────────────────────────────── */

/**
 * Shows `••••1234` for an existing value and only sends a new value once the
 * user actively clicks to replace it and types something — leaving the field
 * untouched must not overwrite the stored secret with the mask itself.
 */
export function MaskedField<TFieldValues extends FieldValues>({
  name,
  label,
  description,
  required,
  disabled,
  className,
  maskedDisplay,
  replaceLabel,
  cancelLabel,
  placeholder,
}: CommonProps<TFieldValues> & {
  /** e.g. "••••1234". Omit when there is no existing value to protect. */
  maskedDisplay?: string
  replaceLabel: string
  cancelLabel: string
  placeholder?: string
}) {
  const { control } = useFormContext<TFieldValues>()
  const [editing, setEditing] = React.useState(!maskedDisplay)

  return (
    <FormField<TFieldValues>
      name={name}
      label={label}
      description={description}
      required={required}
      className={className}
      render={(bind) => (
        <Controller
          control={control}
          name={name}
          render={({ field }) =>
            editing ? (
              <div className="flex gap-2">
                <Input
                  {...bind}
                  {...field}
                  value={field.value ?? ''}
                  disabled={disabled}
                  placeholder={placeholder}
                  autoFocus={Boolean(maskedDisplay)}
                />
                {maskedDisplay ? (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      field.onChange(undefined)
                      setEditing(false)
                    }}
                  >
                    {cancelLabel}
                  </Button>
                ) : null}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Input value={maskedDisplay ?? ''} disabled readOnly className="tabular" />
                <Button type="button" variant="secondary" onClick={() => setEditing(true)}>
                  {replaceLabel}
                </Button>
              </div>
            )
          }
        />
      )}
    />
  )
}

/* ── File ─────────────────────────────────────────────────────────────── */

export function FileField<TFieldValues extends FieldValues>({
  name,
  label,
  description,
  required,
  disabled,
  className,
  accept,
  maxSizeBytes,
  multiple,
  labels,
  files,
  onRemove,
  onRetry,
}: CommonProps<TFieldValues> & {
  accept?: string[]
  maxSizeBytes?: number
  multiple?: boolean
  labels: FileDropLabels
  files?: FileDropItem[]
  onRemove?: (id: string) => void
  onRetry?: (id: string) => void
}) {
  const { control } = useFormContext<TFieldValues>()
  return (
    <FormField<TFieldValues>
      name={name}
      label={label}
      description={description}
      required={required}
      className={className}
      render={(bind) => (
        <Controller
          control={control}
          name={name}
          render={({ field }) => (
            <FileDrop
              id={bind.id}
              accept={accept}
              maxSizeBytes={maxSizeBytes}
              multiple={multiple}
              disabled={disabled}
              invalid={bind.invalid}
              aria-describedby={bind['aria-describedby']}
              labels={labels}
              files={files}
              onRemove={onRemove}
              onRetry={onRetry}
              onFilesSelected={(selected) => {
                const next = multiple ? [...(field.value ?? []), ...selected] : selected
                field.onChange(next)
              }}
            />
          )}
        />
      )}
    />
  )
}

/* ── Address ──────────────────────────────────────────────────────────── */

export interface AddressValue {
  line1: string
  line2?: string
  city: string
  state: string
  postalCode: string
}

export interface AddressSuggestion extends AddressValue {
  id: string
  label: string
}

/**
 * Composes the geo autocomplete combobox with an always-visible manual
 * fallback: selecting a suggestion fills the structured fields, but every
 * field stays directly editable, so a stop with no geocoder match can still
 * be entered by hand.
 */
export function AddressField<TFieldValues extends FieldValues>({
  name,
  label,
  description,
  required,
  disabled,
  className,
  fetchSuggestions,
  searchLabel,
  searchPlaceholder,
  noResultsLabel,
  loadingLabel,
  fieldLabels,
  stateOptions,
}: CommonProps<TFieldValues> & {
  fetchSuggestions: (query: string) => Promise<AddressSuggestion[]>
  searchLabel: string
  searchPlaceholder?: string
  noResultsLabel: string
  loadingLabel: string
  fieldLabels: { line1: string; line2: string; city: string; state: string; postalCode: string }
  stateOptions: SelectFieldOption[]
}) {
  const { setValue } = useFormContext<TFieldValues>()
  const [query, setQuery] = React.useState('')
  const searchId = React.useId()

  return (
    // A fieldset + legend groups the six address inputs into one named region,
    // so a screen reader announces "Physical address" once rather than leaving
    // "City" and "State" floating without context.
    <fieldset className={cn('space-y-3 border-0 p-0', className)}>
      <legend className="mb-1 text-sm font-medium text-carbon">
        {label}
        {required ? (
          <span className="ml-0.5 text-danger-700" aria-hidden="true">
            *
          </span>
        ) : null}
      </legend>
      {description ? <p className="text-sm text-steel-600">{description}</p> : null}
      <div className="grid gap-1.5">
        <Label htmlFor={searchId}>{searchLabel}</Label>
        <Combobox
          id={searchId}
          query={query}
          onQueryChange={setQuery}
          placeholder={searchPlaceholder}
          noResultsLabel={noResultsLabel}
          loadingLabel={loadingLabel}
          fetchOptions={async (q) => {
            const suggestions = await fetchSuggestions(q)
            return suggestions.map<ComboboxOption>((s) => ({
              value: s.id,
              label: s.label,
              description: [s.city, s.state, s.postalCode].filter(Boolean).join(', '),
            }))
          }}
          onSelect={async (option) => {
            const suggestions = await fetchSuggestions(query)
            const match = suggestions.find((s) => s.id === option.value)
            if (!match) return
            setValue(`${name}.line1` as FieldPath<TFieldValues>, match.line1 as never, { shouldDirty: true })
            setValue(`${name}.line2` as FieldPath<TFieldValues>, (match.line2 ?? '') as never, {
              shouldDirty: true,
            })
            setValue(`${name}.city` as FieldPath<TFieldValues>, match.city as never, { shouldDirty: true })
            setValue(`${name}.state` as FieldPath<TFieldValues>, match.state as never, { shouldDirty: true })
            setValue(`${name}.postalCode` as FieldPath<TFieldValues>, match.postalCode as never, {
              shouldDirty: true,
            })
            setQuery(match.label)
          }}
        />
      </div>

      <TextField<TFieldValues>
        name={`${name}.line1` as FieldPath<TFieldValues>}
        label={fieldLabels.line1}
        required={required}
        disabled={disabled}
      />
      <TextField<TFieldValues>
        name={`${name}.line2` as FieldPath<TFieldValues>}
        label={fieldLabels.line2}
        disabled={disabled}
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <TextField<TFieldValues>
          name={`${name}.city` as FieldPath<TFieldValues>}
          label={fieldLabels.city}
          required={required}
          disabled={disabled}
        />
        <SelectField<TFieldValues>
          name={`${name}.state` as FieldPath<TFieldValues>}
          label={fieldLabels.state}
          required={required}
          disabled={disabled}
          options={stateOptions}
        />
        <TextField<TFieldValues>
          name={`${name}.postalCode` as FieldPath<TFieldValues>}
          label={fieldLabels.postalCode}
          required={required}
          disabled={disabled}
        />
      </div>
      {description ? <p className="text-xs text-steel-600">{description}</p> : null}
    </fieldset>
  )
}
