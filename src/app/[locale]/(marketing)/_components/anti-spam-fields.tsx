'use client'

import * as React from 'react'
import { useFormContext } from 'react-hook-form'

/**
 * The honeypot + timing fields every public marketing form submits, kept in
 * one component so the three forms (lead, quote, carrier signup) can't drift
 * out of sync with `src/server/marketing/spam.ts`'s `checkForSpam()`.
 *
 * `hpField` is visually and audibly hidden (`aria-hidden`, off-screen, not
 * keyboard-reachable) so a sighted or assistive-tech user never sees or fills
 * it, while a script that blindly fills every input on the page still will.
 * `renderedAt` is stamped with the real mount time so a submission faster
 * than `MIN_FORM_SECONDS` is rejected server-side.
 *
 * Typed loosely against the form context on purpose: every public form's
 * schema extends `antiSpamSchema` from `src/server/marketing/schema.ts`, so
 * the two field names below always exist, but there's no shared generic form
 * type across three otherwise-unrelated schemas worth threading through here.
 */
export function AntiSpamFields({ hiddenLabel }: { hiddenLabel: string }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { register, setValue } = useFormContext<any>()

  React.useEffect(() => {
    setValue('renderedAt', Date.now())
  }, [setValue])

  return (
    <div aria-hidden="true" className="absolute left-0 top-0 h-px w-px overflow-hidden opacity-0">
      <label htmlFor="company-url-confirm">{hiddenLabel}</label>
      <input id="company-url-confirm" type="text" tabIndex={-1} autoComplete="off" {...register('hpField')} />
      <input type="hidden" {...register('renderedAt')} />
    </div>
  )
}
