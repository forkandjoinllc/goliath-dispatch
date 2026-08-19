'use client'

import { Controller, type FieldPath, type FieldValues } from 'react-hook-form'
import { FormField, useFormContext } from '@/components/forms/form'
import { Input } from '@/components/ui/input'

/**
 * A plain `<input type="date">` bound through RHF, storing a `Date` (or
 * `null`) in form state. Mirrors the equivalent equipment-module field
 * (`equipment/_components/date-only-field.tsx`) rather than importing across
 * a feature boundary — the design system's full `DatePicker` needs a large
 * set of calendar-chrome labels that a document's issue/expiration date does
 * not need.
 */
export function DateOnlyField<TFieldValues extends FieldValues>({
  name,
  label,
  description,
  required,
  disabled,
  className,
}: {
  name: FieldPath<TFieldValues>
  label?: string
  description?: string
  required?: boolean
  disabled?: boolean
  className?: string
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
            <Input
              {...bind}
              type="date"
              disabled={disabled}
              value={toDateInputValue(field.value)}
              onChange={(event) => field.onChange(event.target.value ? new Date(`${event.target.value}T00:00:00Z`) : null)}
              onBlur={field.onBlur}
            />
          )}
        />
      )}
    />
  )
}

function toDateInputValue(value: unknown): string {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(value as string)
  if (Number.isNaN(date.getTime())) return ''
  return date.toISOString().slice(0, 10)
}
