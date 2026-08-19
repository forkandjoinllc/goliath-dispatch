import { z } from 'zod'
import {
  dotNumberSchema,
  einSchema,
  emailSchema,
  localeSchema,
  mcNumberSchema,
  phoneSchema,
  postalCodeSchema,
  usStateSchema,
} from '@/lib/validation'

/**
 * Public form schemas for the marketing site.
 *
 * These are intentionally separate from `src/lib/validation/primitives.ts`'s
 * consumers inside the authenticated app: every field here comes from an
 * anonymous visitor, so optional fields are truly optional (an unauthenticated
 * carrier prospect may not know their MC number yet) and every schema carries
 * the honeypot + timing fields every submission must include.
 */

/** Feet + inches, as a heavy-haul dispatcher actually thinks about a load's dimensions. */
export const feetInchesSchema = z.object({
  feet: z.coerce.number().int().min(0).max(200),
  inches: z.coerce.number().int().min(0).max(11),
})

export function feetInchesToInches(value: { feet: number; inches: number }): number {
  return value.feet * 12 + value.inches
}

export function inchesToFeetInches(totalInches: number | null | undefined): { feet: number; inches: number } {
  const total = Math.max(0, Math.round(totalInches ?? 0))
  return { feet: Math.floor(total / 12), inches: total % 12 }
}

/**
 * Anti-spam fields present on every public form. `hpField` is the honeypot
 * (real visitors never see or fill it — see `src/server/marketing/spam.ts`'s
 * CSS class); it is deliberately not named "website" or "url" because the
 * carrier-signup form has a genuine company-website field and a bot targeting
 * common honeypot names should still be caught by the real field staying
 * unaffected. `renderedAt` is the epoch millisecond the form mounted, used for
 * the minimum-time-on-form check.
 */
export const antiSpamSchema = z.object({
  // Not `.optional()`/`.default()`: both would make this schema's Zod
  // "input" type diverge from its "output" type (`string | undefined` vs
  // `string`), which breaks `useActionForm`'s `schema: ZodType<TFieldValues>`
  // constraint (see `src/components/forms/use-action-form.ts`). The empty
  // starting value is instead supplied once, by every form, via RHF's
  // `defaultValues: { hpField: '' }`.
  hpField: z.string().max(200),
  renderedAt: z.coerce.number().int().nonnegative(),
})

export const optionalTrimmed = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined))

export const leadFormSchema = antiSpamSchema.extend({
  firstName: z.string().trim().min(1, { message: 'validation.required' }).max(100),
  lastName: z.string().trim().min(1, { message: 'validation.required' }).max(100),
  email: emailSchema,
  phone: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined))
    .pipe(phoneSchema.optional()),
  companyName: optionalTrimmed(200),
  dotNumber: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined))
    .pipe(dotNumberSchema.optional()),
  mcNumber: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined))
    .pipe(mcNumberSchema.optional()),
  message: z.string().trim().min(1, { message: 'validation.required' }).max(4000),
  locale: localeSchema,
  consent: z.literal(true, { errorMap: () => ({ message: 'validation.required' }) }),
  sourcePath: z.string().trim().max(255).optional(),
})

export type LeadFormInput = z.infer<typeof leadFormSchema>

export const quoteFormSchema = antiSpamSchema.extend({
  contactName: z.string().trim().min(1, { message: 'validation.required' }).max(200),
  email: emailSchema,
  phone: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined))
    .pipe(phoneSchema.optional()),
  companyName: optionalTrimmed(200),
  commodity: z.string().trim().min(1, { message: 'validation.required' }).max(200),
  weightPounds: z.coerce.number().int().positive().max(500_000),
  length: feetInchesSchema,
  width: feetInchesSchema,
  height: feetInchesSchema,
  originCity: z.string().trim().min(1, { message: 'validation.required' }).max(120),
  originState: usStateSchema,
  destinationCity: z.string().trim().min(1, { message: 'validation.required' }).max(120),
  destinationState: usStateSchema,
  readyDate: z.coerce.date().optional(),
  equipmentPreference: optionalTrimmed(80),
  isOversizeSuspected: z.boolean(),
  notes: optionalTrimmed(4000),
  locale: localeSchema,
  consent: z.literal(true, { errorMap: () => ({ message: 'validation.required' }) }),
})

export type QuoteFormInput = z.infer<typeof quoteFormSchema>

const carrierAddressSchema = z.object({
  line1: z.string().trim().min(1, { message: 'validation.required' }).max(200),
  line2: optionalTrimmed(200),
  city: z.string().trim().min(1, { message: 'validation.required' }).max(120),
  state: usStateSchema,
  postalCode: postalCodeSchema,
})

export const carrierSignupFormSchema = antiSpamSchema.extend({
  legalName: z.string().trim().min(1, { message: 'validation.required' }).max(200),
  dba: optionalTrimmed(200),
  contactFirstName: z.string().trim().min(1, { message: 'validation.required' }).max(100),
  contactLastName: z.string().trim().min(1, { message: 'validation.required' }).max(100),
  email: emailSchema,
  phone: phoneSchema,
  dotNumber: dotNumberSchema,
  mcNumber: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined))
    .pipe(mcNumberSchema.optional()),
  ein: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined))
    .pipe(einSchema.optional()),
  physicalAddress: carrierAddressSchema,
  mailingSameAsPhysical: z.boolean(),
  mailingAddress: carrierAddressSchema.optional(),
  website: z.string().trim().url({ message: 'validation.url' }).optional().or(z.literal('')),
  preferredLocale: localeSchema,
  factoringApplies: z.boolean(),
  privacyConsent: z.literal(true, { errorMap: () => ({ message: 'validation.required' }) }),
  termsConsent: z.literal(true, { errorMap: () => ({ message: 'validation.required' }) }),
})

export type CarrierSignupFormInput = z.infer<typeof carrierSignupFormSchema>
