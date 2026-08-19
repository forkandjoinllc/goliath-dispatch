'use client'

import * as React from 'react'
import {
  Controller,
  FormProvider,
  useFormContext,
  useFormState,
  type Control,
  type FieldPath,
  type FieldValues,
  type UseFormReturn,
} from 'react-hook-form'
import { AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Label } from '@/components/ui/label'
import { useTranslate } from '@/components/providers/i18n-provider'

/**
 * `<Form>` is the RHF provider plus the field-context wiring every field
 * component in this directory depends on for `aria-describedby` /
 * `aria-invalid`. No visual output of its own.
 */
export function Form<TFieldValues extends FieldValues>({
  form,
  children,
  ...props
}: {
  form: UseFormReturn<TFieldValues>
  children: React.ReactNode
} & Omit<React.FormHTMLAttributes<HTMLFormElement>, 'onSubmit'> & {
    onSubmit?: React.FormEventHandler<HTMLFormElement>
  }) {
  return (
    <FormProvider {...form}>
      <form noValidate {...props}>
        {children}
      </form>
    </FormProvider>
  )
}

interface FieldContextValue {
  id: string
  name: string
  descriptionId: string
  errorId: string
  invalid: boolean
}

const FieldContext = React.createContext<FieldContextValue | null>(null)

export function useFieldContext(): FieldContextValue {
  const ctx = React.useContext(FieldContext)
  if (!ctx) throw new Error('Field controls must be used inside <FormField>')
  return ctx
}

export interface FormFieldProps<TFieldValues extends FieldValues> {
  name: FieldPath<TFieldValues>
  label?: string
  description?: string
  required?: boolean
  hideLabel?: boolean
  className?: string
  /** Render prop receiving the bound control props to spread onto the input. */
  render: (bind: {
    id: string
    name: string
    invalid: boolean
    'aria-describedby': string | undefined
    'aria-invalid': boolean | undefined
  }) => React.ReactNode
}

/**
 * Wires a label, control, description and error together with the correct
 * `aria-describedby` / `aria-invalid` relationships. Every typed field below
 * (`TextField`, `MoneyField`, …) is built on top of this.
 */
export function FormField<TFieldValues extends FieldValues>({
  name,
  label,
  description,
  required,
  hideLabel,
  className,
  render,
}: FormFieldProps<TFieldValues>) {
  const t = useTranslate()
  const id = React.useId()
  const descriptionId = `${id}-description`
  const errorId = `${id}-error`
  const {
    formState: { errors },
  } = useFormContext<TFieldValues>()
  const rawError = getFieldError(errors, name)
  // RHF/zod store the message-key string (e.g. `validation.required`), never
  // raw English — this is what resolves it to display text in the user's
  // locale instead of leaking the key itself.
  const error = rawError ? t(rawError) : undefined
  const invalid = Boolean(rawError)

  const describedBy =
    [description ? descriptionId : null, invalid ? errorId : null].filter(Boolean).join(' ') || undefined

  return (
    <FieldContext.Provider value={{ id, name, descriptionId, errorId, invalid }}>
      <div className={cn('grid gap-1.5', className)}>
        {label && !hideLabel ? (
          <Label htmlFor={id} required={required}>
            {label}
          </Label>
        ) : null}
        {render({
          id,
          name,
          invalid,
          'aria-describedby': describedBy,
          'aria-invalid': invalid || undefined,
        })}
        {description ? (
          <p id={descriptionId} className="text-xs text-steel-600">
            {description}
          </p>
        ) : null}
        {error ? (
          <p id={errorId} role="alert" className="text-xs font-medium text-danger-700">
            {error}
          </p>
        ) : null}
      </div>
    </FieldContext.Provider>
  )
}

function getFieldError(errors: Record<string, unknown>, name: string): string | undefined {
  const segments = name.split('.')
  let node: unknown = errors
  for (const segment of segments) {
    if (typeof node !== 'object' || node === null) return undefined
    node = (node as Record<string, unknown>)[segment]
  }
  if (node && typeof node === 'object' && 'message' in node && typeof node.message === 'string') {
    return node.message
  }
  return undefined
}

export { Controller, useFormContext, useFormState }
export type { Control, FieldPath, FieldValues }

/**
 * Focus-on-submit-failure error summary. Renders one link per invalid field
 * so a keyboard/screen-reader user can jump straight to it, and moves focus
 * to itself the moment validation fails.
 */
export function FormErrorSummary<TFieldValues extends FieldValues>({
  title,
  className,
}: {
  title: string
  className?: string
}) {
  const t = useTranslate()
  const {
    formState: { errors, submitCount },
  } = useFormContext<TFieldValues>()
  const headingRef = React.useRef<HTMLDivElement>(null)
  const entries = flattenErrors(errors).map((entry) => ({ ...entry, message: t(entry.message) }))

  React.useEffect(() => {
    if (submitCount > 0 && entries.length > 0) {
      headingRef.current?.focus()
    }
  }, [submitCount]) // eslint-disable-line react-hooks/exhaustive-deps

  if (entries.length === 0) return null

  return (
    <div
      ref={headingRef}
      tabIndex={-1}
      role="alert"
      className={cn(
        'rounded-lg border border-danger-500/40 bg-danger-50 p-4 text-sm text-danger-700 outline-none',
        className,
      )}
    >
      <p className="flex items-center gap-2 font-semibold">
        <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
        {title}
      </p>
      <ul className="mt-2 list-inside list-disc space-y-1">
        {entries.map(({ name, message }) => (
          <li key={name}>
            <a
              href={`#${cssEscape(name)}`}
              className="underline underline-offset-2 hover:no-underline"
              onClick={(event) => {
                event.preventDefault()
                document.getElementById(name)?.focus()
              }}
            >
              {message}
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}

function flattenErrors(
  errors: Record<string, unknown>,
  prefix = '',
): Array<{ name: string; message: string }> {
  const out: Array<{ name: string; message: string }> = []
  for (const [key, value] of Object.entries(errors)) {
    if (!value || typeof value !== 'object') continue
    const path = prefix ? `${prefix}.${key}` : key
    if ('message' in value && typeof (value as { message?: unknown }).message === 'string') {
      out.push({ name: path, message: (value as { message: string }).message })
    } else {
      out.push(...flattenErrors(value as Record<string, unknown>, path))
    }
  }
  return out
}

function cssEscape(value: string): string {
  return value.replace(/[.#[\]]/g, '\\$&')
}
