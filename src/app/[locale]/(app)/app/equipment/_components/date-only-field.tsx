'use client'

import { Controller, type FieldPath, type FieldValues } from 'react-hook-form'
import { FormField, useFormContext } from '@/components/forms/form'
import { Input } from '@/components/ui/input'

/**
 * A plain `<input type="date">` bound through RHF, storing a `Date` (or
 * `null`) in form state. The design system's `DatePicker` needs a full set
 * of calendar-chrome labels (weekday names, month nav, etc.) that no other
 * screen in this module needs yet; a native date input is the pragmatic
 * choice for the handful of expiry/inspection dates on equipment and driver
 * forms, at no loss of correctness.
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
