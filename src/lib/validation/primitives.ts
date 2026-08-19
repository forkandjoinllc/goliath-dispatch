import { z } from 'zod'
import { stateCodeEnum } from '@/db/schema/_shared'
import { isValidVin, normalizeEmail, normalizePhone, normalizeVin } from '@/lib/utils'

/**
 * Reusable Zod primitives for domain values shared across the carrier,
 * compliance and verification surfaces.
 *
 * Every validation failure carries an i18n **key** from
 * `src/i18n/messages/{locale}/validation.json` as its `message` — never
 * English prose — so a Spanish user sees a Spanish field error. Values are
 * normalized in the schema (trim, case-fold, digit-strip) so the same shape
 * reaches the database from every entry point.
 */

const STATE_CODES = new Set<string>(stateCodeEnum.enumValues)

const digitsOnly = (value: string) => value.replace(/\D/g, '')

/** 5–8 digit USDOT number. Punctuation is stripped before the length check. */
export const dotNumberSchema = z
  .string()
  .trim()
  .transform(digitsOnly)
  .pipe(z.string().regex(/^\d{5,8}$/, { message: 'validation.dot' }))

/** 5–8 digit MC (docket) number. */
export const mcNumberSchema = z
  .string()
  .trim()
  .transform(digitsOnly)
  .pipe(z.string().regex(/^\d{5,8}$/, { message: 'validation.mc' }))

/** 9-digit EIN; accepts the conventional `XX-XXXXXXX` display format. */
export const einSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/[^0-9]/g, ''))
  .pipe(z.string().regex(/^\d{9}$/, { message: 'validation.ein' }))

/** 17-character VIN. Normalized (uppercased, I/O/Q folded) before validation. */
export const vinSchema = z
  .string()
  .trim()
  .transform((value) => normalizeVin(value))
  .pipe(
    z
      .string()
      .length(17, { message: 'validation.vin' })
      .refine((value) => isValidVin(value), { message: 'validation.vin' }),
  )

/** One of the 52 codes in `stateCodeEnum` (50 states + DC + PR). */
export const usStateSchema = z
  .string()
  .trim()
  .toUpperCase()
  .refine((value) => STATE_CODES.has(value), { message: 'validation.state' }) as z.ZodType<
  (typeof stateCodeEnum.enumValues)[number]
>

/** US 5 or 9 digit ZIP code (`12345` or `12345-6789`). */
export const postalCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{5}(-\d{4})?$/, { message: 'validation.postalCode' })

/** Normalizes to 10 digits (US/Canada numbering, +1 stripped). */
export const phoneSchema = z
  .string()
  .trim()
  .transform((value) => normalizePhone(value) ?? '')
  .pipe(z.string().length(10, { message: 'validation.phone' }))

/** Lowercased and trimmed before format validation. */
export const emailSchema = z
  .string()
  .trim()
  .transform((value) => normalizeEmail(value) ?? '')
  .pipe(z.string().email({ message: 'validation.email' }))

/** Non-negative integer cents. Never a float, never a numeric string. */
export const moneyCentsSchema = z
  .number()
  .int({ message: 'validation.integer' })
  .nonnegative({ message: 'validation.positive' })

/** Basis points, 0–10000 inclusive (0%–100%). */
export const bpsSchema = z
  .number()
  .int({ message: 'validation.integer' })
  .min(0, { message: 'validation.percentage' })
  .max(10_000, { message: 'validation.percentage' })

export const addressSchema = z.object({
  line1: z.string().trim().min(1, { message: 'validation.required' }).max(200),
  line2: z.string().trim().max(200).optional().nullable(),
  city: z.string().trim().min(1, { message: 'validation.required' }).max(120),
  state: usStateSchema,
  postalCode: postalCodeSchema,
  country: z.string().trim().length(2).default('US'),
  placeId: z.string().trim().max(255).optional().nullable(),
})

export type Address = z.infer<typeof addressSchema>

/** Application locale — mirrors `src/i18n/config.ts`'s `LOCALES`. */
export const localeSchema = z.enum(['en', 'es'], {
  errorMap: () => ({ message: 'validation.required' }),
})

export const uuidSchema = z.string().uuid({ message: 'validation.required' })

/**
 * A written reason, required everywhere an override, rejection, suspension or
 * deletion demands one. Ten characters is enough to reject a placeholder like
 * "n/a" while staying short enough for a one-line explanation.
 */
export const reasonSchema = z
  .string()
  .trim()
  .min(10, { message: 'validation.minLength' })
  .max(2000, { message: 'validation.maxLength' })

export const paginationSchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(200).default(25),
})

export type Pagination = z.infer<typeof paginationSchema>

export const dateRangeSchema = z
  .object({
    start: z.coerce.date(),
    end: z.coerce.date(),
  })
  .refine((value) => value.end.getTime() > value.start.getTime(), {
    message: 'validation.endAfterStart',
    path: ['end'],
  })

export type DateRange = z.infer<typeof dateRangeSchema>
