import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Tailwind-aware class merge used by every UI primitive. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Stable, URL-safe slug for tenant subdomains and object keys. */
export function slugify(value: string, maxLength = 63): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
}

export function initialsOf(firstName?: string | null, lastName?: string | null): string {
  return `${firstName?.[0] ?? ''}${lastName?.[0] ?? ''}`.toUpperCase() || '—'
}

export function fullName(person: { firstName?: string | null; lastName?: string | null }): string {
  return [person.firstName, person.lastName].filter(Boolean).join(' ').trim()
}

/** Normalizes a US phone number to digits for storage and duplicate detection. */
export function normalizePhone(value: string | null | undefined): string | null {
  if (!value) return null
  const digits = value.replace(/\D/g, '')
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1)
  return digits.length >= 10 ? digits.slice(-10) : digits || null
}

export function formatPhone(value: string | null | undefined): string {
  const digits = normalizePhone(value)
  if (!digits || digits.length !== 10) return value ?? '—'
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
}

export function normalizeEmail(value: string | null | undefined): string | null {
  return value ? value.trim().toLowerCase() : null
}

/** Company-name normalization used by customer duplicate detection. */
export function normalizeCompanyName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\b(inc|llc|l\.l\.c|corp|corporation|company|co|ltd|limited|lp|llp|plc)\b\.?/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * VIN normalization. I, O and Q are not valid VIN characters; carriers routinely
 * type them for 1 and 0, so we fold them before comparing against a COI.
 */
export function normalizeVin(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .replace(/[IO]/g, '0')
    .replace(/Q/g, '0')
}

export function isValidVin(value: string): boolean {
  return /^[A-HJ-NPR-Z0-9]{17}$/.test(value.toUpperCase())
}

export function truncate(value: string, length: number): string {
  return value.length <= length ? value : `${value.slice(0, length - 1)}…`
}

export function bytesToHuman(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB']
  let size = bytes
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024
    unit += 1
  }
  return `${size % 1 === 0 ? size : size.toFixed(1)} ${units[unit]}`
}

export function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    const k = key(item)
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

export function groupBy<T>(items: T[], key: (item: T) => string): Record<string, T[]> {
  return items.reduce<Record<string, T[]>>((acc, item) => {
    const k = key(item)
    ;(acc[k] ??= []).push(item)
    return acc
  }, {})
}
