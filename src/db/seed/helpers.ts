import 'server-only'
import { deflateSync, crc32 } from 'node:zlib'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { unsafeDb } from '@/db/client'
import { hashPassword } from '@/lib/auth/password'
import { normalizeEmail } from '@/lib/utils'
import { users, userTenantMemberships } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { tenantDb } from '@/db/tenant-db'
import type { Role } from '@/lib/permissions'
import type { Actor } from '@/lib/permissions'
import type { Locale } from '@/i18n/config'
import { drain } from '@/jobs/runner'
import { linkExistingUserToDriver } from '@/server/drivers/service'

/**
 * Shared infrastructure for `src/db/seed/*` — determinism (PRNG + fixed
 * "now"), name/contact generation with no real PII, minimal PDF fixtures,
 * user/actor construction, and a couple of small orchestration helpers
 * (`runJobsToCompletion`, `logStep`) every tenant module reuses.
 *
 * Determinism note: row *ids* are still real `gen_random_uuid()` primary
 * keys (this is what every service function in the app already assumes —
 * rewriting id generation across the service layer to accept an injected id
 * is out of scope for a seed script). What is deterministic is everything a
 * human actually looks at: names, dates relative to `SEED_NOW`, dollar
 * amounts, statuses, and the PRNG-driven choices between them. Re-running
 * the seed against the same (empty) database twice in a row therefore
 * produces byte-identical *content*, just with fresh ids — which is exactly
 * what `docs/demo-credentials.md` depends on staying true (every credential
 * in it is an email + a fixed password, never an id).
 */

/* ── Determinism ─────────────────────────────────────────────────────────── */

/** Fixed "today" the entire seed is built relative to — never `new Date()`. */
export const SEED_NOW = new Date('2026-08-15T15:00:00Z')

export function daysAgo(days: number, from: Date = SEED_NOW): Date {
  return new Date(from.getTime() - days * 86_400_000)
}

export function daysFromNow(days: number, from: Date = SEED_NOW): Date {
  return new Date(from.getTime() + days * 86_400_000)
}

export function hoursAgo(hours: number, from: Date = SEED_NOW): Date {
  return new Date(from.getTime() - hours * 3_600_000)
}

/**
 * A small, seedable PRNG (mulberry32) — deterministic across runs and
 * platforms, unlike `Math.random()`. Every tenant module creates its own
 * `Rng` from a fixed numeric seed so tenant-a's draws never depend on how
 * many draws tenant-b made first.
 */
export type Rng = () => number

export function makeRng(seed: number): Rng {
  let a = seed >>> 0
  return function rng() {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)]!
}

export function pickMany<T>(rng: Rng, items: readonly T[], count: number): T[] {
  const pool = [...items]
  const out: T[] = []
  for (let i = 0; i < count && pool.length > 0; i += 1) {
    const index = Math.floor(rng() * pool.length)
    out.push(pool.splice(index, 1)[0]!)
  }
  return out
}

export function intBetween(rng: Rng, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min
}

/* ── Names (bilingual, ~1/3 Spanish, never real people) ─────────────────── */

export interface SeedName {
  firstName: string
  lastName: string
  locale: Locale
}

// English-leaning first/last names.
const EN_FIRST = ['James', 'Mary', 'Robert', 'Patricia', 'John', 'Linda', 'Michael', 'Barbara', 'William', 'Susan', 'David', 'Karen', 'Richard', 'Nancy', 'Joseph', 'Betty', 'Thomas', 'Sandra', 'Charles', 'Ashley']
const EN_LAST = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Wilson', 'Anderson', 'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Walker', 'Hall', 'Young', 'King', 'Wright']

// Spanish-leaning first/last names — roughly one in three seeded people.
const ES_FIRST = ['José', 'María', 'Luis', 'Carmen', 'Carlos', 'Rosa', 'Jorge', 'Guadalupe', 'Miguel', 'Alejandra', 'Francisco', 'Elena', 'Raúl', 'Verónica', 'Ramón', 'Patricia', 'Eduardo', 'Marisol', 'Fernando', 'Yolanda']
const ES_LAST = ['Rodríguez', 'Hernández', 'González', 'Pérez', 'Sánchez', 'Ramírez', 'Torres', 'Flores', 'Rivera', 'Gómez', 'Díaz', 'Reyes', 'Morales', 'Cruz', 'Ortiz', 'Gutiérrez', 'Chávez', 'Ramos', 'Vega', 'Castillo']

/** Deterministically draws a name; roughly 1-in-3 draws are Spanish-named with `preferredLocale: 'es'`. */
export function seedName(rng: Rng): SeedName {
  const isSpanish = rng() < 1 / 3
  if (isSpanish) {
    return { firstName: pick(rng, ES_FIRST), lastName: pick(rng, ES_LAST), locale: 'es' }
  }
  return { firstName: pick(rng, EN_FIRST), lastName: pick(rng, EN_LAST), locale: 'en' }
}

let emailCounter = 0
/** Every seeded email lives under `@example.com` — never a real, deliverable address. */
export function seedEmail(localPart: string): string {
  emailCounter += 1
  const safe = localPart
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
  return `${safe}.${emailCounter}@example.com`
}

let phoneCounter = 1000
/** Every seeded phone number uses the reserved 555 exchange — never a real, dialable number. */
export function seedPhone(areaCode = '210'): string {
  phoneCounter += 1
  return `${areaCode}555${String(phoneCounter).padStart(4, '0')}`
}

let dotCounter = 4_000_000
/** Invented USDOT numbers, well outside the real FMCSA mock fixtures' `100000x` range. */
export function seedDot(): string {
  dotCounter += 1
  return String(dotCounter)
}

let mcCounter = 900_000
export function seedMc(): string {
  mcCounter += 1
  return `MC-${mcCounter}`
}

let einCounter = 10_000_000
/** A syntactically valid 9-digit EIN, never a real one. */
export function seedEin(): string {
  einCounter += 1
  return String(einCounter)
}

let licenseCounter = 500_000
export function seedLicenseNumber(state = 'TX'): string {
  licenseCounter += 1
  return `${state}${licenseCounter}`
}

/* ── VINs ────────────────────────────────────────────────────────────────── */

import { computeVinCheckDigit } from '@/server/equipment/vin'

const VIN_ALPHABET = '0123456789ABCDEFGHJKLMNPRSTUVWXYZ'
let vinCounter = 0

/**
 * Builds a syntactically valid 17-character VIN with a correct check digit
 * (position 9) — real trucks and trailers, never a real-world VIN. Position
 * 10 (model year) and position 7 (cycle disambiguator) are chosen so
 * `decodeModelYear` resolves to `modelYear`.
 */
export function seedVin(modelYear: number, wmi = '1FU'): string {
  vinCounter += 1
  const yearChar = yearToPositionTenChar(modelYear)
  const cycleChar = modelYear >= 2010 ? 'A' : '1' // position 7: alpha ⇒ 2010s+, numeric ⇒ 1980s/2000s
  const serial = String(vinCounter).padStart(6, '0')
  // Layout: WMI(3) + VDS(5, filler+cycle char at position 7) + check(1, placeholder) + year(1) + plant(1) + serial(6)
  const vdsFiller = 'XX'
  const body17 =
    wmi +
    vdsFiller +
    cycleChar +
    'X' + // position 8 (filler)
    '0' + // position 9 placeholder, replaced below
    yearChar +
    'G' + // position 11, plant code (arbitrary, valid alphabet char)
    serial

  const withoutCheck = body17
  const checkDigit = computeVinCheckDigit(withoutCheck.slice(0, 8) + '0' + withoutCheck.slice(9)) ?? '0'
  const vin =
    withoutCheck.slice(0, 8) +
    checkDigit +
    withoutCheck.slice(9)
  // Guard: every character must be in the valid VIN alphabet (no I/O/Q).
  return [...vin].map((c) => (VIN_ALPHABET.includes(c) ? c : '0')).join('')
}

function yearToPositionTenChar(year: number): string {
  const table: Record<number, string> = {
    2018: 'J', 2019: 'K', 2020: 'L', 2021: 'M', 2022: 'N', 2023: 'P', 2024: 'R', 2025: 'S', 2026: 'T',
  }
  return table[year] ?? 'R'
}

/* ── Actors & users ──────────────────────────────────────────────────────── */

export interface SeedUserResult {
  userId: string
  email: string
  password: string
}

/**
 * Creates a real `users` row + `user_tenant_memberships` row (there is no
 * dedicated "invite a user" service module in this codebase — every such
 * screen goes through the auth invitation flow's email/token dance, which a
 * non-interactive seed cannot drive — so this is a direct, documented
 * insert, exactly the "fall back to direct inserts only where necessary"
 * carve-out the task calls for). The password is always `SEED_DEMO_PASSWORD`
 * (see `src/lib/env.ts`), real-hashed with the same `hashPassword()` the
 * signup flow uses, so every seeded account logs in exactly like a real one.
 */
export async function createSeedUser(
  tenantId: string | null,
  input: {
    firstName: string
    lastName: string
    email: string
    role: Role
    locale?: Locale
    password: string
    carrierId?: string | null
    driverId?: string | null
    status?: 'active' | 'pending_verification'
  },
): Promise<SeedUserResult> {
  const emailNormalized = normalizeEmail(input.email) ?? input.email.toLowerCase()
  const existing = await unsafeDb.select({ id: users.id }).from(users).where(eq(users.emailNormalized, emailNormalized)).limit(1)
  if (existing[0]) {
    return { userId: existing[0].id, email: input.email, password: input.password }
  }

  const passwordHash = await hashPassword(input.password)
  const [user] = await unsafeDb
    .insert(users)
    .values({
      email: input.email,
      emailNormalized,
      passwordHash,
      firstName: input.firstName,
      lastName: input.lastName,
      locale: input.locale ?? 'en',
      status: input.status ?? 'active',
      emailVerifiedAt: SEED_NOW,
    })
    .returning()

  if (tenantId) {
    await unsafeDb.insert(userTenantMemberships).values({
      tenantId,
      userId: user!.id,
      role: input.role,
      status: 'active',
      isPrimaryContact: false,
      carrierId: input.carrierId ?? null,
      // For a driver, the membership's `driverId` and `drivers.userId` are
      // set together immediately below, through the same real service
      // (`linkExistingUserToDriver`) `acceptInvitation` uses for a driver who
      // came through the real invitation flow — not left null here.
      driverId: input.role === 'driver' ? null : (input.driverId ?? null),
      acceptedAt: SEED_NOW,
    })

    if (input.role === 'driver' && input.driverId) {
      await linkExistingUserToDriver(tenantDb(tenantId), { userId: user!.id }, { driverId: input.driverId, userId: user!.id })
    }
  }

  return { userId: user!.id, email: input.email, password: input.password }
}

/** Builds a full `Actor` for a seeded user — the shape every `Actor`-typed service function requires. */
export function actorFor(
  user: { userId: string; firstName: string; lastName: string; email: string; locale: Locale },
  tenantId: string | null,
  role: Role,
  extra: Partial<Actor> = {},
): Actor {
  return {
    assignments: { carrierIds: [], truckIds: [], trailerIds: [], driverIds: [], groupIds: [] },
    overrides: [],
    mfaRequired: false,
    mfaSatisfied: true,
    impersonation: null,
    sessionId: null,
    carrierId: null,
    driverId: null,
    ...extra,
    userId: user.userId,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    locale: user.locale,
    timezone: 'America/Chicago',
    isPlatformSuperAdmin: false,
    tenantId,
    role,
  }
}

export const SEED_REQUEST_CONTEXT = { ipAddress: '203.0.113.10', userAgent: 'goliath-seed/1.0', requestId: 'seed-request' }

/* ── PDF fixtures (real bytes through the real document-builder API) ────── */

/**
 * A small, real, branded PDF via the same `pdf-lib` primitives
 * `src/lib/pdf/document-builder.ts` builds on (not that module directly —
 * its `DocumentBuilder` is purpose-built for invoices/settlements/signed
 * agreements with their own headers; a generic compliance document like a
 * COI or CDL scan just needs a real, readable one-pager). Every document the
 * seed uploads goes through this so `uploadDocument()`'s malware scan /
 * content-type sniffing exercises real bytes, not an empty buffer.
 */
export async function buildSeedPdf(title: string, lines: string[]): Promise<Buffer> {
  const pdf = await PDFDocument.create()
  const helvetica = await pdf.embedFont(StandardFonts.Helvetica)
  const helveticaBold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const page = pdf.addPage([612, 792])
  const navy = rgb(0x06 / 255, 0x2b / 255, 0x5c / 255)
  const orange = rgb(0xff / 255, 0x5a / 255, 0x00 / 255)

  page.drawRectangle({ x: 0, y: 792 - 70, width: 612, height: 70, color: navy })
  page.drawRectangle({ x: 0, y: 792 - 74, width: 612, height: 4, color: orange })
  page.drawText('GOLIATH DISPATCH — DEMO FIXTURE', { x: 48, y: 792 - 30, size: 10, font: helveticaBold, color: rgb(1, 1, 1) })
  page.drawText(title, { x: 48, y: 792 - 50, size: 14, font: helveticaBold, color: rgb(1, 1, 1) })

  let y = 792 - 110
  for (const line of lines) {
    page.drawText(line, { x: 48, y, size: 10, font: helvetica, color: rgb(0.1, 0.1, 0.1), maxWidth: 516 })
    y -= 16
  }
  page.drawText('This document is a synthetic fixture generated for the Goliath Dispatch demo environment. It contains no real personal or business data.', {
    x: 48,
    y: 60,
    size: 7,
    font: helvetica,
    color: rgb(0.4, 0.4, 0.4),
    maxWidth: 516,
    lineHeight: 9,
  })
  const bytes = await pdf.save()
  return Buffer.from(bytes)
}

/** A tiny, real (non-empty) PNG buffer for equipment media — see the `angle` parameter for which of the 4 required angles it represents. */
export async function buildSeedPhoto(label: string, opts: { short?: boolean } = {}): Promise<Buffer> {
  // A minimal, valid PNG (solid color square) built by hand — deliberately
  // tiny bytes for the "one deliberately short" media file the task asks
  // for (`opts.short`), and a slightly larger but still trivial one
  // otherwise. Both are real, parseable PNG files (not empty buffers), which
  // is what `validateUpload`'s content-sniffing needs to pass.
  const size = opts.short ? 1 : 4
  return encodePng(size, size, label)
}

/** Hand-rolled minimal PNG encoder (solid single-color square) — no image library dependency needed for a fixture this simple. */
function encodePng(width: number, height: number, seedLabel: string): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

  function chunk(type: string, data: Buffer): Buffer {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length, 0)
    const typeBuf = Buffer.from(type, 'ascii')
    const crcInput = Buffer.concat([typeBuf, data])
    const crcValue = crc32(crcInput)
    const crcBuf = Buffer.alloc(4)
    crcBuf.writeUInt32BE(crcValue >>> 0, 0)
    return Buffer.concat([len, typeBuf, data, crcBuf])
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // color type: RGB
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  // Deterministic "color" derived from the label so different angles differ visually (not that anyone will look).
  let hash = 0
  for (const ch of seedLabel) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  const r = hash & 0xff
  const g = (hash >> 8) & 0xff
  const b = (hash >> 16) & 0xff

  const rowBytes = width * 3 + 1
  const raw = Buffer.alloc(rowBytes * height)
  for (let y = 0; y < height; y += 1) {
    raw[y * rowBytes] = 0 // filter type: none
    for (let x = 0; x < width; x += 1) {
      const offset = y * rowBytes + 1 + x * 3
      raw[offset] = r
      raw[offset + 1] = g
      raw[offset + 2] = b
    }
  }
  const idatData = deflateSync(raw)

  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idatData), chunk('IEND', Buffer.alloc(0))])
}

/* ── Jobs ────────────────────────────────────────────────────────────────── */

/**
 * Drains the real job queue (`src/jobs/runner.ts`) so async side-effects the
 * app itself relies on — FMCSA verification after `createCarrier`, the
 * auto-drafted invoice after a load reaches `pod_received`, OCR VIN
 * extraction, notification delivery — actually run during the seed instead
 * of leaving rows permanently stuck `pending`. Safe to call as often as
 * needed; a call with nothing queued is a fast no-op.
 */
export async function runJobsToCompletion(label: string): Promise<void> {
  let totalSucceeded = 0
  for (let round = 0; round < 20; round += 1) {
    const result = await drain({ workerId: 'seed-worker', deadlineMs: 15_000, limit: 20 })
    totalSucceeded += result.succeeded
    if (result.claimed === 0) break
  }
  logStep(`  ↳ jobs drained (${label}): ${totalSucceeded} processed`)
}

/* ── Logging ─────────────────────────────────────────────────────────────── */

export function logStep(message: string): void {
  console.log(message)
}

/* ── MFA ─────────────────────────────────────────────────────────────────── */

/**
 * Enrolls and confirms TOTP MFA for a seeded user through the real
 * `beginMfaEnrollment`/`confirmMfaEnrollment` service pair — the same path a
 * real user follows, not a direct row insert. Shared by every tenant seed
 * that needs an Admin or Accounting account (`MFA_REQUIRED_ROLES` in
 * `server/auth/mfa.ts`) usable immediately: the authenticated app layout
 * redirects any unenrolled member of those roles to `/app/mfa-setup` on
 * *every* request, so skipping this for a demo account leaves it unable to
 * reach any other page at all, not just unable to skip an MFA prompt.
 */
export async function seedMfaFor(userId: string, email: string): Promise<void> {
  const { beginMfaEnrollment, confirmMfaEnrollment } = await import('@/server/auth/mfa')
  const { decryptField } = await import('@/lib/crypto')
  const { authenticator } = await import('otplib')
  const enrollment = await beginMfaEnrollment(userId, email)
  const secret = decryptField(enrollment.secretEncrypted)
  const code = authenticator.generate(secret)
  await confirmMfaEnrollment(userId, code)
}
