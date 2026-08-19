'use client'

import * as React from 'react'
import { useForm, type DefaultValues, type FieldValues, type UseFormReturn } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import type { ZodType } from 'zod'
import { useTransition } from 'react'
import { useToast } from '@/components/ui/toast'
import { useTranslate } from '@/components/providers/i18n-provider'

/**
 * Structural mirror of `ActionResult<T>` from `src/server/action.ts`. Defined
 * locally (not imported — components never import `src/server/**`) but
 * shaped identically, so any real server action's return value satisfies it
 * without a cast.
 */
export interface ActionResultSuccess<T> {
  ok: true
  data: T
}

export interface ActionResultFailure {
  ok: false
  error: { code: string; messageKey: string; params?: Record<string, string | number> }
  fieldErrors?: Record<string, string[]>
}

export type ActionResultLike<T> = ActionResultSuccess<T> | ActionResultFailure

export interface UseActionFormOptions<TFieldValues extends FieldValues, TOutput> {
  schema: ZodType<TFieldValues>
  defaultValues: DefaultValues<TFieldValues>
  action: (values: TFieldValues) => Promise<ActionResultLike<TOutput>>
  onSuccess?: (data: TOutput) => void
  /** i18n key for the success toast title. Omit to show no toast on success. */
  successMessageKey?: string
}

export interface UseActionFormResult<TFieldValues extends FieldValues> {
  form: UseFormReturn<TFieldValues>
  onSubmit: (event?: React.BaseSyntheticEvent) => void
  isPending: boolean
}

/**
 * The single bridge between the server-action harness and a React Hook Form.
 * It maps `fieldErrors` back onto the matching RHF fields (so the field's own
 * `<FormField>` renders the message), routes a top-level failure to a toast
 * via `error.messageKey`, and exposes `isPending` from `useTransition` so
 * submit buttons can show a busy state without extra plumbing.
 */
export function useActionForm<TFieldValues extends FieldValues, TOutput>({
  schema,
  defaultValues,
  action,
  onSuccess,
  successMessageKey,
}: UseActionFormOptions<TFieldValues, TOutput>): UseActionFormResult<TFieldValues> {
  const form = useForm<TFieldValues>({
    resolver: zodResolver(schema as never),
    defaultValues,
  })
  const [isPending, startTransition] = useTransition()
  const { toast } = useToast()
  const t = useTranslate()

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      const result = await action(values)
      if (result.ok) {
        if (successMessageKey) {
          toast({ tone: 'success', title: t(successMessageKey) })
        }
        onSuccess?.(result.data)
        return
      }

      if (result.fieldErrors) {
        for (const [path, messages] of Object.entries(result.fieldErrors)) {
          if (path === '_root' || !messages?.[0]) continue
          form.setError(path as never, { type: 'server', message: messages[0] })
        }
      }

      toast({
        tone: 'error',
        title: t(result.error.messageKey, result.error.params),
      })
    })
  })

  return { form, onSubmit, isPending }
}
