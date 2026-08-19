'use client'

import { Controller, type FieldPath, type FieldValues } from 'react-hook-form'
import { useFormContext, FormField } from '@/components/forms/form'
import { Input } from '@/components/ui/input'

/**
 * A plain integer field. `@/components/forms/fields` deliberately has no
 * generic `NumberField` (only `MoneyField`/`PercentField`, which encode
 * cents/bps semantics this settings module doesn't need — these are counts
 * of days, sequence prefixes' numeric siblings, hours), so this is the one
 * small addition local to the settings route tree rather than a change to
 * the shared, off-limits `src/components/forms/**`.
 */
export function NumberField<TFieldValues extends FieldValues>({
  name,
  label,
  description,
  disabled,
  min,
  max,
  className,
}: {
  name: FieldPath<TFieldValues>
  label?: string
  description?: string
  disabled?: boolean
  min?: number
  max?: number
  className?: string
}) {
  const { control } = useFormContext<TFieldValues>()
  return (
    <FormField<TFieldValues>
      name={name}
      label={label}
      description={description}
      className={className}
      render={(bind) => (
        <Controller
          control={control}
          name={name}
          render={({ field }) => (
            <Input
              {...bind}
              type="number"
              inputMode="numeric"
              min={min}
              max={max}
              disabled={disabled}
              value={field.value ?? ''}
              onChange={(event) => field.onChange(event.target.value === '' ? null : Number(event.target.value))}
              onBlur={field.onBlur}
              className="tabular text-right"
            />
          )}
        />
      )}
    />
  )
}
