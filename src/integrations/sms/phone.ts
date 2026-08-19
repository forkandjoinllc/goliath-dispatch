/**
 * E.164 normalization for US (and US-territory, +1) numbers. This is the SMS
 * family's own helper because the shape SMS providers require (`+1XXXXXXXXXX`)
 * is stricter than `normalizePhone` in `src/lib/utils.ts`, which only
 * produces a bare 10-digit string for storage/search.
 */
export function toE164Us(value: string): string | null {
  const digits = value.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return null
}

export function isE164Us(value: string): boolean {
  return /^\+1[2-9]\d{9}$/.test(value)
}
