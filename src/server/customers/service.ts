import 'server-only'
import { and, eq, or, type SQL } from 'drizzle-orm'
import type { TenantDb } from '@/db/tenant-db'
import {
  customerContacts,
  customerLocations,
  customers,
  type Customer,
  type CustomerContact,
  type CustomerLocation,
  type NewCustomer,
} from '@/db/schema'
import { AppError, notFound } from '@/lib/errors'
import { sealIdentifier } from '@/lib/crypto'
import { normalizeCompanyName, normalizeEmail, normalizePhone } from '@/lib/utils'
import { getGeoProvider, type ResolvedAddress } from '@/integrations/geo'
import {
  detectDuplicateCustomers,
  type DuplicateCandidateInput,
  type DuplicateMatch,
  type ExistingCustomerForDuplicateCheck,
} from './duplicates'

/**
 * The customer domain.
 *
 * As with `carriers/service.ts`, nothing here checks permissions — that
 * already happened in `defineAction`. This layer owns: duplicate detection
 * ahead of every insert, the tax-id seal, the "exactly one primary
 * contact/location" invariant (the schema's partial unique index is the
 * backstop; the transactions here are what let a promotion succeed without
 * ever violating it), and address geocoding through the tenant-agnostic geo
 * provider.
 */

function toDuplicateProjection(customer: Customer): ExistingCustomerForDuplicateCheck {
  return {
    id: customer.id,
    companyName: customer.companyName,
    companyNameNormalized: customer.companyNameNormalized,
    dotNumber: customer.dotNumber,
    mcNumber: customer.mcNumber,
    phoneNormalized: customer.phoneNormalized,
    emailNormalized: customer.emailNormalized,
    physicalLine1: customer.physicalLine1,
    physicalCity: customer.physicalCity,
    physicalState: customer.physicalState,
    physicalPostalCode: customer.physicalPostalCode,
  }
}

/**
 * Loads only the customers that could plausibly match — one indexed lookup
 * per identifying field the candidate supplied — rather than every customer
 * in the tenant, then hands the (typically tiny) result to the pure
 * `detectDuplicateCustomers`.
 */
async function findDuplicateCandidates(
  db: TenantDb,
  candidate: DuplicateCandidateInput,
): Promise<ExistingCustomerForDuplicateCheck[]> {
  const clauses: SQL[] = []
  const dot = candidate.dotNumber?.trim()
  const mc = candidate.mcNumber?.trim()
  const phoneNormalized = normalizePhone(candidate.phone)
  const emailNormalized = normalizeEmail(candidate.email)
  const nameNormalized = normalizeCompanyName(candidate.companyName)

  if (dot) clauses.push(eq(customers.dotNumber, dot))
  if (mc) clauses.push(eq(customers.mcNumber, mc))
  if (phoneNormalized) clauses.push(eq(customers.phoneNormalized, phoneNormalized))
  if (emailNormalized) clauses.push(eq(customers.emailNormalized, emailNormalized))
  if (nameNormalized) clauses.push(eq(customers.companyNameNormalized, nameNormalized))

  if (clauses.length === 0) return []

  const rows = await db.findMany(customers, { where: or(...clauses) })
  return rows.map(toDuplicateProjection)
}

/** Exported so the create-customer screen can preview matches before submit. */
export async function previewDuplicateCustomers(
  db: TenantDb,
  candidate: DuplicateCandidateInput,
): Promise<DuplicateMatch[]> {
  return detectDuplicateCustomers(candidate, await findDuplicateCandidates(db, candidate))
}

/* ── Create ──────────────────────────────────────────────────────────────── */

export interface CreateCustomerInput {
  companyName: string
  dotNumber?: string | null
  mcNumber?: string | null
  website?: string | null
  phone?: string | null
  email?: string | null
  physicalLine1?: string | null
  physicalLine2?: string | null
  physicalCity?: string | null
  physicalState?: string | null
  physicalPostalCode?: string | null
  physicalPlaceId?: string | null
  billingSameAsPhysical?: boolean
  billingLine1?: string | null
  billingLine2?: string | null
  billingCity?: string | null
  billingState?: string | null
  billingPostalCode?: string | null
  taxId?: string | null
  creditLimitCents?: number | null
  creditApproved?: boolean
  creditNotes?: string | null
  paymentTermsDays?: number
  usesFactoring?: boolean
  factoringCompanyName?: string | null
  notes?: string | null
  /** True once the caller has seen the duplicate warning and chosen to proceed anyway. */
  overrideDuplicate?: boolean
  duplicateOverrideReason?: string | null
}

export type CreateCustomerResult =
  | { status: 'created'; customer: Customer }
  | { status: 'conflict'; matches: DuplicateMatch[] }

export async function createCustomer(
  db: TenantDb,
  actor: { userId: string },
  input: CreateCustomerInput,
): Promise<CreateCustomerResult> {
  const matches = await detectDuplicateCustomers(input, await findDuplicateCandidates(db, input))

  if (matches.length > 0 && !input.overrideDuplicate) {
    return { status: 'conflict', matches }
  }
  if (matches.length > 0 && !input.duplicateOverrideReason?.trim()) {
    throw new AppError('validation_failed', 'validation.required')
  }

  const sealedTaxId = input.taxId ? sealIdentifier(input.taxId, 'customer.tax_id') : null
  const billingSameAsPhysical = input.billingSameAsPhysical ?? true

  const customer = await db.insert(customers, {
    companyName: input.companyName,
    companyNameNormalized: normalizeCompanyName(input.companyName),
    dotNumber: input.dotNumber ?? null,
    mcNumber: input.mcNumber ?? null,
    website: input.website ?? null,
    phone: input.phone ?? null,
    phoneNormalized: normalizePhone(input.phone),
    email: input.email ?? null,
    emailNormalized: normalizeEmail(input.email),
    physicalLine1: input.physicalLine1 ?? null,
    physicalLine2: input.physicalLine2 ?? null,
    physicalCity: input.physicalCity ?? null,
    physicalState: input.physicalState ?? null,
    physicalPostalCode: input.physicalPostalCode ?? null,
    physicalPlaceId: input.physicalPlaceId ?? null,
    billingSameAsPhysical,
    billingLine1: billingSameAsPhysical ? (input.physicalLine1 ?? null) : (input.billingLine1 ?? null),
    billingLine2: billingSameAsPhysical ? (input.physicalLine2 ?? null) : (input.billingLine2 ?? null),
    billingCity: billingSameAsPhysical ? (input.physicalCity ?? null) : (input.billingCity ?? null),
    billingState: billingSameAsPhysical ? (input.physicalState ?? null) : (input.billingState ?? null),
    billingPostalCode: billingSameAsPhysical
      ? (input.physicalPostalCode ?? null)
      : (input.billingPostalCode ?? null),
    taxIdEncrypted: sealedTaxId?.encrypted ?? null,
    taxIdLast4: sealedTaxId?.last4 ?? null,
    creditLimitCents: input.creditLimitCents ?? null,
    creditApproved: input.creditApproved ?? false,
    creditNotes: input.creditNotes ?? null,
    paymentTermsDays: input.paymentTermsDays ?? 30,
    usesFactoring: input.usesFactoring ?? false,
    factoringCompanyName: input.factoringCompanyName ?? null,
    status: 'active',
    notes: input.notes ?? null,
    duplicateOverrideByUserId: matches.length > 0 ? actor.userId : null,
    duplicateOverrideReason: matches.length > 0 ? (input.duplicateOverrideReason ?? null) : null,
  })

  return { status: 'created', customer }
}

/* ── Update ──────────────────────────────────────────────────────────────── */

export interface UpdateCustomerInput {
  companyName?: string
  dotNumber?: string | null
  mcNumber?: string | null
  website?: string | null
  phone?: string | null
  email?: string | null
  physicalLine1?: string | null
  physicalLine2?: string | null
  physicalCity?: string | null
  physicalState?: string | null
  physicalPostalCode?: string | null
  physicalPlaceId?: string | null
  billingSameAsPhysical?: boolean
  billingLine1?: string | null
  billingLine2?: string | null
  billingCity?: string | null
  billingState?: string | null
  billingPostalCode?: string | null
  /** Presence replaces the sealed value; omit to leave the stored tax id untouched. */
  taxId?: string | null
  creditLimitCents?: number | null
  creditApproved?: boolean
  creditNotes?: string | null
  paymentTermsDays?: number
  usesFactoring?: boolean
  factoringCompanyName?: string | null
  status?: 'active' | 'on_hold' | 'inactive'
  notes?: string | null
}

export async function updateCustomer(
  db: TenantDb,
  _actor: { userId: string },
  customerId: string,
  input: UpdateCustomerInput,
): Promise<Customer> {
  const existing = await db.requireById(customers, customerId, 'customer')

  const patch: Partial<NewCustomer> = {}
  if (input.companyName !== undefined) {
    patch.companyName = input.companyName
    patch.companyNameNormalized = normalizeCompanyName(input.companyName)
  }
  if (input.dotNumber !== undefined) patch.dotNumber = input.dotNumber
  if (input.mcNumber !== undefined) patch.mcNumber = input.mcNumber
  if (input.website !== undefined) patch.website = input.website
  if (input.phone !== undefined) {
    patch.phone = input.phone
    patch.phoneNormalized = normalizePhone(input.phone)
  }
  if (input.email !== undefined) {
    patch.email = input.email
    patch.emailNormalized = normalizeEmail(input.email)
  }
  if (input.physicalLine1 !== undefined) patch.physicalLine1 = input.physicalLine1
  if (input.physicalLine2 !== undefined) patch.physicalLine2 = input.physicalLine2
  if (input.physicalCity !== undefined) patch.physicalCity = input.physicalCity
  if (input.physicalState !== undefined) patch.physicalState = input.physicalState
  if (input.physicalPostalCode !== undefined) patch.physicalPostalCode = input.physicalPostalCode
  if (input.physicalPlaceId !== undefined) patch.physicalPlaceId = input.physicalPlaceId

  const billingSameAsPhysical = input.billingSameAsPhysical ?? existing.billingSameAsPhysical
  if (input.billingSameAsPhysical !== undefined) patch.billingSameAsPhysical = input.billingSameAsPhysical
  if (billingSameAsPhysical) {
    patch.billingLine1 = input.physicalLine1 ?? existing.physicalLine1
    patch.billingLine2 = input.physicalLine2 ?? existing.physicalLine2
    patch.billingCity = input.physicalCity ?? existing.physicalCity
    patch.billingState = input.physicalState ?? existing.physicalState
    patch.billingPostalCode = input.physicalPostalCode ?? existing.physicalPostalCode
  } else {
    if (input.billingLine1 !== undefined) patch.billingLine1 = input.billingLine1
    if (input.billingLine2 !== undefined) patch.billingLine2 = input.billingLine2
    if (input.billingCity !== undefined) patch.billingCity = input.billingCity
    if (input.billingState !== undefined) patch.billingState = input.billingState
    if (input.billingPostalCode !== undefined) patch.billingPostalCode = input.billingPostalCode
  }

  if (input.taxId) {
    const sealed = sealIdentifier(input.taxId, 'customer.tax_id')
    patch.taxIdEncrypted = sealed.encrypted
    patch.taxIdLast4 = sealed.last4
  }

  if (input.creditLimitCents !== undefined) patch.creditLimitCents = input.creditLimitCents
  if (input.creditApproved !== undefined) patch.creditApproved = input.creditApproved
  if (input.creditNotes !== undefined) patch.creditNotes = input.creditNotes
  if (input.paymentTermsDays !== undefined) patch.paymentTermsDays = input.paymentTermsDays
  if (input.usesFactoring !== undefined) patch.usesFactoring = input.usesFactoring
  if (input.factoringCompanyName !== undefined) patch.factoringCompanyName = input.factoringCompanyName
  if (input.status !== undefined) patch.status = input.status
  if (input.notes !== undefined) patch.notes = input.notes

  const updated = await db.update(customers, customerId, patch)
  if (!updated) throw notFound('errors.notFound', { entity: 'customer' })
  return updated
}

export async function softDeleteCustomer(
  db: TenantDb,
  actor: { userId: string },
  customerId: string,
  reason?: string,
): Promise<Customer> {
  await db.requireById(customers, customerId, 'customer')
  const updated = await db.softDelete(customers, customerId, actor.userId, reason)
  if (!updated) throw notFound('errors.notFound', { entity: 'customer' })
  return updated
}

/* ── Contacts ────────────────────────────────────────────────────────────── */

export interface CreateContactInput {
  customerId: string
  firstName: string
  lastName: string
  email?: string | null
  phone?: string | null
  phoneExtension?: string | null
  position?: string | null
  isPrimary?: boolean
  notes?: string | null
}

/**
 * Promoting a new primary contact demotes the current one in the same
 * transaction — the schema's partial unique index
 * (`customer_contacts_primary_uq`, `is_primary = true and deleted_at is
 * null`) is what makes "exactly one primary" absolute; this is what lets
 * that invariant hold through the moment of promotion instead of racing it.
 */
export async function createContact(
  db: TenantDb,
  _actor: { userId: string },
  input: CreateContactInput,
): Promise<CustomerContact> {
  await db.requireById(customers, input.customerId, 'customer')

  return db.transaction(async (tx) => {
    if (input.isPrimary) {
      await tx.updateWhere(
        customerContacts,
        and(eq(customerContacts.customerId, input.customerId), eq(customerContacts.isPrimary, true))!,
        { isPrimary: false },
      )
    }
    return tx.insert(customerContacts, {
      customerId: input.customerId,
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email ?? null,
      phone: input.phone ?? null,
      phoneExtension: input.phoneExtension ?? null,
      position: input.position ?? null,
      isPrimary: input.isPrimary ?? false,
      notes: input.notes ?? null,
    })
  })
}

export interface UpdateContactInput {
  contactId: string
  firstName?: string
  lastName?: string
  email?: string | null
  phone?: string | null
  phoneExtension?: string | null
  position?: string | null
  isPrimary?: boolean
  notes?: string | null
}

export async function updateContact(
  db: TenantDb,
  _actor: { userId: string },
  input: UpdateContactInput,
): Promise<CustomerContact> {
  const existing = await db.requireById(customerContacts, input.contactId, 'customerContact')

  return db.transaction(async (tx) => {
    if (input.isPrimary === true && !existing.isPrimary) {
      await tx.updateWhere(
        customerContacts,
        and(eq(customerContacts.customerId, existing.customerId), eq(customerContacts.isPrimary, true))!,
        { isPrimary: false },
      )
    }

    const patch: Partial<CustomerContact> = {}
    if (input.firstName !== undefined) patch.firstName = input.firstName
    if (input.lastName !== undefined) patch.lastName = input.lastName
    if (input.email !== undefined) patch.email = input.email
    if (input.phone !== undefined) patch.phone = input.phone
    if (input.phoneExtension !== undefined) patch.phoneExtension = input.phoneExtension
    if (input.position !== undefined) patch.position = input.position
    if (input.notes !== undefined) patch.notes = input.notes
    if (input.isPrimary !== undefined) patch.isPrimary = input.isPrimary

    const updated = await tx.update(customerContacts, input.contactId, patch)
    if (!updated) throw notFound('errors.notFound', { entity: 'customerContact' })
    return updated
  })
}

export async function setPrimaryContact(
  db: TenantDb,
  _actor: { userId: string },
  customerId: string,
  contactId: string,
): Promise<CustomerContact> {
  return db.transaction(async (tx) => {
    await tx.requireById(customerContacts, contactId, 'customerContact')
    await tx.updateWhere(
      customerContacts,
      and(eq(customerContacts.customerId, customerId), eq(customerContacts.isPrimary, true))!,
      { isPrimary: false },
    )
    const updated = await tx.update(customerContacts, contactId, { isPrimary: true })
    if (!updated) throw notFound('errors.notFound', { entity: 'customerContact' })
    return updated
  })
}

export async function deleteContact(
  db: TenantDb,
  actor: { userId: string },
  contactId: string,
  reason?: string,
): Promise<CustomerContact> {
  await db.requireById(customerContacts, contactId, 'customerContact')
  const updated = await db.softDelete(customerContacts, contactId, actor.userId, reason)
  if (!updated) throw notFound('errors.notFound', { entity: 'customerContact' })
  return updated
}

/* ── Locations ───────────────────────────────────────────────────────────── */

export interface LocationAddressInput {
  line1?: string | null
  line2?: string | null
  city?: string | null
  state?: string | null
  postalCode?: string | null
  placeId?: string | null
}

export interface CreateLocationInput extends LocationAddressInput {
  customerId: string
  name: string
  phone?: string | null
  hours?: string | null
  instructions?: string | null
  isPrimary?: boolean
}

export interface UpdateLocationInput extends LocationAddressInput {
  locationId: string
  name?: string
  phone?: string | null
  hours?: string | null
  instructions?: string | null
  isPrimary?: boolean
  /** True once the caller has actually edited an address field (vs. leaving it as-is). */
  addressChanged?: boolean
}

interface ResolvedLocationGeo {
  latitude: string | null
  longitude: string | null
  placeId: string | null
  timezone: string
}

const DEFAULT_TIMEZONE = 'America/New_York'

/**
 * Resolves lat/lng/timezone through the configured geo provider — `placeId`
 * (from the address autocomplete) first, free-text geocoding as a fallback
 * for a hand-typed address, and the tenant default timezone if the provider
 * cannot resolve anything at all (never a hard failure: a stop with a bad
 * address must still be saveable).
 */
async function resolveLocationGeo(input: LocationAddressInput): Promise<ResolvedLocationGeo> {
  const geo = getGeoProvider()
  let resolved: ResolvedAddress | null = null

  if (input.placeId) {
    resolved = await geo.resolvePlace(input.placeId).catch(() => null)
  }
  if (!resolved) {
    const freeText = [input.line1, input.city, input.state, input.postalCode].filter(Boolean).join(', ')
    if (freeText) resolved = await geo.geocode(freeText).catch(() => null)
  }
  if (!resolved) {
    return { latitude: null, longitude: null, placeId: input.placeId ?? null, timezone: DEFAULT_TIMEZONE }
  }

  const timezone = resolved.timezone ?? (await geo.timezoneAt(resolved.lat, resolved.lng, new Date()).catch(() => null))
  return {
    latitude: String(resolved.lat),
    longitude: String(resolved.lng),
    placeId: resolved.placeId ?? input.placeId ?? null,
    timezone: timezone ?? DEFAULT_TIMEZONE,
  }
}

export async function createLocation(
  db: TenantDb,
  _actor: { userId: string },
  input: CreateLocationInput,
): Promise<CustomerLocation> {
  await db.requireById(customers, input.customerId, 'customer')
  const geo = await resolveLocationGeo(input)

  return db.transaction(async (tx) => {
    if (input.isPrimary) {
      await tx.updateWhere(
        customerLocations,
        and(eq(customerLocations.customerId, input.customerId), eq(customerLocations.isPrimary, true))!,
        { isPrimary: false },
      )
    }
    return tx.insert(customerLocations, {
      customerId: input.customerId,
      name: input.name,
      line1: input.line1 ?? null,
      line2: input.line2 ?? null,
      city: input.city ?? null,
      state: input.state ?? null,
      postalCode: input.postalCode ?? null,
      latitude: geo.latitude,
      longitude: geo.longitude,
      placeId: geo.placeId,
      timezone: geo.timezone,
      phone: input.phone ?? null,
      hours: input.hours ?? null,
      instructions: input.instructions ?? null,
      isPrimary: input.isPrimary ?? false,
    })
  })
}

export async function updateLocation(
  db: TenantDb,
  _actor: { userId: string },
  input: UpdateLocationInput,
): Promise<CustomerLocation> {
  const existing = await db.requireById(customerLocations, input.locationId, 'customerLocation')

  const geo = input.addressChanged
    ? await resolveLocationGeo({
        line1: input.line1 ?? existing.line1,
        line2: input.line2 ?? existing.line2,
        city: input.city ?? existing.city,
        state: input.state ?? existing.state,
        postalCode: input.postalCode ?? existing.postalCode,
        placeId: input.placeId ?? existing.placeId,
      })
    : null

  return db.transaction(async (tx) => {
    if (input.isPrimary === true && !existing.isPrimary) {
      await tx.updateWhere(
        customerLocations,
        and(eq(customerLocations.customerId, existing.customerId), eq(customerLocations.isPrimary, true))!,
        { isPrimary: false },
      )
    }

    const patch: Partial<CustomerLocation> = {}
    if (input.name !== undefined) patch.name = input.name
    if (input.line1 !== undefined) patch.line1 = input.line1
    if (input.line2 !== undefined) patch.line2 = input.line2
    if (input.city !== undefined) patch.city = input.city
    if (input.state !== undefined) patch.state = input.state
    if (input.postalCode !== undefined) patch.postalCode = input.postalCode
    if (input.phone !== undefined) patch.phone = input.phone
    if (input.hours !== undefined) patch.hours = input.hours
    if (input.instructions !== undefined) patch.instructions = input.instructions
    if (input.isPrimary !== undefined) patch.isPrimary = input.isPrimary
    if (geo) {
      patch.latitude = geo.latitude
      patch.longitude = geo.longitude
      patch.placeId = geo.placeId
      patch.timezone = geo.timezone
    }

    const updated = await tx.update(customerLocations, input.locationId, patch)
    if (!updated) throw notFound('errors.notFound', { entity: 'customerLocation' })
    return updated
  })
}

export async function deleteLocation(
  db: TenantDb,
  actor: { userId: string },
  locationId: string,
  reason?: string,
): Promise<CustomerLocation> {
  await db.requireById(customerLocations, locationId, 'customerLocation')
  const updated = await db.softDelete(customerLocations, locationId, actor.userId, reason)
  if (!updated) throw notFound('errors.notFound', { entity: 'customerLocation' })
  return updated
}
