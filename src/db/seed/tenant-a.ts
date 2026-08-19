import 'server-only'
import { eq, and } from 'drizzle-orm'
import { unsafeDb } from '@/db/client'
import { tenantDb } from '@/db/tenant-db'
import {
  carriers,
  drivers,
  equipmentTypes,
  expenseCategories,
  fmcsaVerifications,
  loads,
  tenants,
  trailers,
  trucks,
  factoringCompanies,
  users,
} from '@/db/schema'
import type { Actor } from '@/lib/permissions'
import { newId } from '@/lib/crypto'
import { provisionTenant } from '@/server/tenants/provisioning'
import { createSubscriptionForTenant } from '@/server/tenants/subscription'
import {
  createCarrier,
  submitOnboarding,
  approveOnboarding,
  rejectOnboarding,
  transitionOnboarding,
  suspendCarrier,
  assignDispatcher,
  type CreateCarrierInput,
} from '@/server/carriers/service'
import { overrideVerification } from '@/server/verification/fmcsa-service'
import { uploadDocument, reviewDocument } from '@/server/documents/service'
import { createTruck, createTrailer, uploadEquipmentMedia, transitionEquipmentStatus } from '@/server/equipment/service'
import { createDriver, reviewDriverLicense, addDriverCarrierRelationship } from '@/server/drivers/service'
import { createCustomer, createContact, createLocation } from '@/server/customers/service'
import {
  createLoad,
  assignCarrier,
  assignResources,
  transitionStatus,
  cancelLoad,
  duplicateLoad,
  recordStopArrival,
  recordStopDeparture,
} from '@/server/loads/service'
import { uploadLoadDocument } from '@/server/loads/documents'
import { submitExpense, approveExpense } from '@/server/finance/expenses'
import { createDraftInvoiceForLoad, sendInvoice, recordManualPayment, refundPayment } from '@/server/invoices/service'
import { generateSettlementForPeriod, issueSettlement, markSettlementPaid } from '@/server/settlements/service'
import { createFactoringCompany, createFactoringAssignment, setFactoringVerificationStatus, uploadFactoringDocument } from '@/server/factoring/service'
import { createSignatureRequest, signDocument, resolveSignatureRequestByToken } from '@/server/signatures/service'
import { runEvaluation, validateEvaluation } from '@/server/oversize/service'
import { createEscort, listPermitsForLoad, listEscortsForLoad, updatePermit, updateEscort } from '@/server/permits/service'
import { startTrackingSession, grantTrackingConsent } from '@/server/tracking/sessions'
import { createPublicTrackingLink } from '@/server/tracking/public-links'
import { createConversation, sendMessage } from '@/server/messaging/service'
import { FMCSA_MOCK_DOT_CLEAN, FMCSA_MOCK_DOT_NAME_MISMATCH, FMCSA_MOCK_DOT_NO_AUTHORITY } from '@/integrations/fmcsa/mock-adapter'
import { mockCoiWithVins } from '@/integrations/ocr'
import { MOCK_CITIES } from '@/integrations/geo/mock-adapter'
import { recordAudit } from '@/lib/audit'
import {
  actorFor,
  buildSeedPdf,
  buildSeedPhoto,
  createSeedUser,
  daysAgo,
  daysFromNow,
  hoursAgo,
  intBetween,
  logStep,
  makeRng,
  pick,
  runJobsToCompletion,
  SEED_NOW,
  SEED_REQUEST_CONTEXT,
  seedDot,
  seedEin,
  seedEmail,
  seedLicenseNumber,
  seedMc,
  seedMfaFor,
  seedName,
  seedPhone,
  seedVin,
  type Rng,
} from './helpers'

export const SHARED_CARRIER_DOT = '9888888'
export const SHARED_CARRIER_NAME = 'Rivera Transport LLC'

const rng: Rng = makeRng(20260815)

export interface TenantASummary {
  tenantId: string
  slug: string
  adminEmail: string
  userCount: number
  carrierCount: number
  truckCount: number
  trailerCount: number
  driverCount: number
  customerCount: number
  loadCount: number
  credentials: Array<{ role: string; email: string; note?: string }>
}

/* ── Small local building blocks ─────────────────────────────────────────── */

async function uploadAndApprove(
  db: ReturnType<typeof tenantDb>,
  actor: Actor,
  input: { ownerType: 'carrier' | 'load' | 'driver' | 'truck' | 'trailer'; ownerId: string; documentType: Parameters<typeof uploadDocument>[2]['documentType']; title: string; bytes: Buffer; expirationDate?: Date | null },
) {
  const { document } = await uploadDocument(db, actor, {
    ownerType: input.ownerType,
    ownerId: input.ownerId,
    documentType: input.documentType,
    title: input.title,
    originalFilename: `${input.title.replace(/\s+/g, '-').toLowerCase()}.pdf`,
    bytes: input.bytes,
    expirationDate: input.expirationDate ?? null,
  })
  await reviewDocument(db, actor, { documentId: document.id, status: 'approved' })
  return document
}

/* ── Carriers ─────────────────────────────────────────────────────────────── */

interface CarrierPlan {
  key: string
  legalName: string
  dot: string
  usesFactoring: boolean
  outcome: 'approved_active' | 'approved_suspended' | 'under_review' | 'rejected' | 'draft' | 'submitted' | 'corrections_required'
  fmcsaClean: boolean
}

async function seedOneCarrier(
  db: ReturnType<typeof tenantDb>,
  actor: Actor,
  adminUserId: string,
  plan: CarrierPlan,
): Promise<{ carrierId: string; onboardingApproved: boolean }> {
  const contactName = seedName(rng)
  // The FMCSA mock fixtures (`FMCSA_MOCK_DOT_*`) carry their own fixed MC
  // number per DOT — an invented MC here would collide with the fixture's
  // and turn a same-DOT/same-name match into an `mcNumber` mismatch
  // (`compareEnteredToReported` treats MC mismatches as always-blocking).
  // Leave MC unset for a fixture DOT; only invent one for a DOT the mock
  // FMCSA adapter has no record of at all.
  const isFmcsaFixtureDot = plan.dot.startsWith('10000')
  const input: CreateCarrierInput = {
    legalName: plan.legalName,
    dotNumber: plan.dot,
    mcNumber: isFmcsaFixtureDot ? undefined : seedMc(),
    ein: seedEin(),
    contactFirstName: contactName.firstName,
    contactLastName: contactName.lastName,
    email: seedEmail(`ops.${plan.key}`),
    phone: seedPhone(),
    preferredLocale: contactName.locale,
    physicalLine1: `${intBetween(rng, 100, 9900)} Industrial Pkwy`,
    physicalCity: pick(rng, ['Houston', 'Dallas', 'San Antonio', 'Fort Worth', 'Corpus Christi']),
    physicalState: 'TX',
    physicalPostalCode: String(intBetween(rng, 75001, 79999)),
    mailingSameAsPhysical: true,
    usesFactoring: plan.usesFactoring,
    notes: 'Seeded demo carrier — no real business or personal data.',
  }

  const { carrier } = await createCarrier(db, { userId: adminUserId }, input)

  await runJobsToCompletion(`fmcsa:${plan.key}`)

  if (plan.outcome === 'draft') {
    return { carrierId: carrier.id, onboardingApproved: false }
  }

  // Base onboarding documents every carrier needs.
  const coa = await buildSeedPdf('Certificate of Authority', [
    `Carrier: ${plan.legalName}`,
    `USDOT: ${plan.dot}`,
    'Operating authority: active common/contract carrier, property.',
  ])
  await uploadAndApprove(db, actor, {
    ownerType: 'carrier',
    ownerId: carrier.id,
    documentType: 'certificate_of_authority',
    title: 'Certificate of Authority',
    bytes: coa,
    expirationDate: daysFromNow(365),
  })

  const coiBytes = await buildSeedPdf('Certificate of Insurance', [
    `Insured: ${plan.legalName}`,
    `USDOT: ${plan.dot}`,
    'Auto liability: $1,000,000 combined single limit.',
    'Cargo: $100,000.',
  ])
  await uploadAndApprove(db, actor, {
    ownerType: 'carrier',
    ownerId: carrier.id,
    documentType: 'certificate_of_insurance',
    title: 'Certificate of Insurance',
    bytes: coiBytes,
    expirationDate: daysFromNow(180),
  })

  const w9 = await buildSeedPdf('IRS Form W-9', [`Name: ${plan.legalName}`, 'Tax classification: LLC.'])
  await uploadAndApprove(db, actor, {
    ownerType: 'carrier',
    ownerId: carrier.id,
    documentType: 'w9',
    title: 'W-9',
    bytes: w9,
  })

  if (plan.usesFactoring) {
    const noa = await buildSeedPdf('Notice of Assignment', [`${plan.legalName} assigns payment to its factor.`])
    await uploadAndApprove(db, actor, {
      ownerType: 'carrier',
      ownerId: carrier.id,
      documentType: 'notice_of_assignment',
      title: 'Notice of Assignment',
      bytes: noa,
    })
    const cop = await buildSeedPdf('Change of Payee', [`${plan.legalName} directs future payments to its factor.`])
    await uploadAndApprove(db, actor, {
      ownerType: 'carrier',
      ownerId: carrier.id,
      documentType: 'change_of_payee',
      title: 'Change of Payee',
      bytes: cop,
    })
  }

  if (plan.outcome === 'corrections_required') {
    await submitOnboarding(db, { userId: adminUserId }, carrier.id)
    await transitionOnboarding(db, { userId: adminUserId }, carrier.id, 'under_review')
    await transitionOnboarding(db, { userId: adminUserId }, carrier.id, 'corrections_required', {
      reason: 'Certificate of insurance is missing the required cargo coverage endorsement — please re-upload.',
    })
    return { carrierId: carrier.id, onboardingApproved: false }
  }

  if (plan.outcome === 'submitted') {
    await submitOnboarding(db, { userId: adminUserId }, carrier.id)
    return { carrierId: carrier.id, onboardingApproved: false }
  }

  await submitOnboarding(db, { userId: adminUserId }, carrier.id)
  await transitionOnboarding(db, { userId: adminUserId }, carrier.id, 'under_review')

  if (plan.outcome === 'under_review') {
    // FMCSA mismatch carriers stay blocked in review — the compliance
    // reason is left standing on purpose, to demonstrate the blocked state.
    return { carrierId: carrier.id, onboardingApproved: false }
  }

  if (plan.outcome === 'rejected') {
    await rejectOnboarding(db, { userId: adminUserId }, carrier.id, 'FMCSA reports no active operating authority for this USDOT number.')
    return { carrierId: carrier.id, onboardingApproved: false }
  }

  // approved_active / approved_suspended: FMCSA must read as verified or
  // manually_overridden before approval — for a non-fixture DOT the mock
  // lookup returns "not found", so an Admin manually overrides it (the same
  // real `overrideVerification()` path a real ops team would use for a
  // small/regional carrier that never gets picked up in the FMCSA feed).
  if (!plan.fmcsaClean) {
    const latest = await db.findFirst(fmcsaVerifications, {
      where: eq(fmcsaVerifications.carrierId, carrier.id),
    })
    if (latest) {
      await overrideVerification(db, { userId: adminUserId }, latest.id, 'Verified carrier authority directly with the shipper-provided COI and a phone call to the safety office; FMCSA SAFER lookup does not have this DOT on file.')
    }
  }

  await approveOnboarding(db, { userId: adminUserId }, carrier.id)

  if (plan.outcome === 'approved_suspended') {
    await suspendCarrier(db, { userId: adminUserId }, carrier.id, 'Carrier failed to maintain current cargo insurance; suspended pending renewal.')
  }

  return { carrierId: carrier.id, onboardingApproved: plan.outcome === 'approved_active' }
}

/* ── Equipment ────────────────────────────────────────────────────────────── */

interface CompliantFleetResult {
  truckIds: string[]
  trailerIds: string[]
  shortTruckId: string
  mismatchTruckId: string
}

/** Uploads a carrier COI carrying the given VINs, then builds N trucks/trailers verified against it. */
async function seedCompliantFleet(
  db: ReturnType<typeof tenantDb>,
  actor: Actor,
  carrierId: string,
  opts: { truckCount: number; trailerCount: number },
): Promise<CompliantFleetResult> {
  const truckVins = Array.from({ length: opts.truckCount }, () => seedVin(2020 + intBetween(rng, 0, 6)))
  const trailerVins = Array.from({ length: opts.trailerCount }, () => seedVin(2018 + intBetween(rng, 0, 8)))
  const mismatchVin = seedVin(2022) // never included on the COI below — the deliberate VIN-mismatch case.

  const flatbed = await db.findFirst(equipmentTypes, { where: eq(equipmentTypes.code, 'flatbed') })
  const rgn = await db.findFirst(equipmentTypes, { where: eq(equipmentTypes.code, 'rgn') })

  const { bytes } = await mockCoiWithVins([...truckVins, ...trailerVins])
  await uploadAndApprove(db, actor, {
    ownerType: 'carrier',
    ownerId: carrierId,
    documentType: 'certificate_of_insurance',
    title: 'Certificate of Insurance (equipment schedule)',
    bytes: Buffer.from(bytes),
    expirationDate: daysFromNow(180),
  })

  const makes = ['Freightliner', 'Peterbilt', 'Kenworth', 'International (Navistar)', 'Volvo Trucks', 'Mack']
  const angles = ['front', 'rear', 'driver_side', 'passenger_side'] as const

  const truckIds: string[] = []
  for (let i = 0; i < truckVins.length; i += 1) {
    const truck = await createTruck(db, actor, {
      carrierId,
      unitNumber: `TRK-${String(i + 1).padStart(3, '0')}`,
      vin: truckVins[i]!,
      make: pick(rng, makes),
      registrationExpiresAt: daysFromNow(300),
      lastInspectionAt: daysAgo(60),
      nextInspectionDueAt: daysFromNow(275),
    })
    truckIds.push(truck.id)

    const isShort = i === truckVins.length - 1 // last truck in the fleet is deliberately short on photos.
    const angleSet = isShort ? angles.slice(0, 2) : angles
    for (const angle of angleSet) {
      await uploadEquipmentMedia(db, actor, {
        equipmentType: 'truck',
        equipmentId: truck.id,
        angle,
        originalFilename: `${truck.unitNumber}-${angle}.png`,
        bytes: await buildSeedPhoto(`${truck.unitNumber}-${angle}`, { short: isShort }),
      })
    }
    if (!isShort) {
      await transitionEquipmentStatus(db, actor, { equipmentType: 'truck', equipmentId: truck.id, toStatus: 'active' })
    }
  }

  // One extra truck whose VIN was never put on the COI — the VIN-mismatch case, later admin-overridden.
  const mismatchTruck = await createTruck(db, actor, {
    carrierId,
    unitNumber: 'TRK-MISMATCH',
    vin: mismatchVin,
    make: pick(rng, makes),
    registrationExpiresAt: daysFromNow(300),
  })
  for (const angle of angles) {
    await uploadEquipmentMedia(db, actor, {
      equipmentType: 'truck',
      equipmentId: mismatchTruck.id,
      angle,
      originalFilename: `${mismatchTruck.unitNumber}-${angle}.png`,
      bytes: await buildSeedPhoto(`${mismatchTruck.unitNumber}-${angle}`),
    })
  }

  const trailerIds: string[] = []
  for (let i = 0; i < trailerVins.length; i += 1) {
    const trailer = await createTrailer(db, actor, {
      carrierId,
      unitNumber: `TRL-${String(i + 1).padStart(3, '0')}`,
      vin: trailerVins[i]!,
      equipmentTypeId: i % 3 === 0 ? (rgn?.id ?? null) : (flatbed?.id ?? null),
      lengthInches: 636,
      widthInches: 102,
      deckHeightInches: pick(rng, [24, 36, 60]),
      capacityPounds: 48_000,
      axleCount: pick(rng, [2, 3]),
      removableGooseneck: (rgn && i % 3 === 0) ?? false,
      registrationExpiresAt: daysFromNow(300),
      lastInspectionAt: daysAgo(60),
      nextInspectionDueAt: daysFromNow(275),
    })
    trailerIds.push(trailer.id)
    for (const angle of angles) {
      await uploadEquipmentMedia(db, actor, {
        equipmentType: 'trailer',
        equipmentId: trailer.id,
        angle,
        originalFilename: `${trailer.unitNumber}-${angle}.png`,
        bytes: await buildSeedPhoto(`${trailer.unitNumber}-${angle}`),
      })
    }
    await transitionEquipmentStatus(db, actor, { equipmentType: 'trailer', equipmentId: trailer.id, toStatus: 'active' })
  }

  return { truckIds, trailerIds, shortTruckId: truckIds[truckIds.length - 1]!, mismatchTruckId: mismatchTruck.id }
}

/* ── Drivers ──────────────────────────────────────────────────────────────── */

async function seedDriver(
  db: ReturnType<typeof tenantDb>,
  actor: Actor,
  carrierId: string,
  opts: { endorsements?: string[]; expiringSoon?: boolean } = {},
) {
  const name = seedName(rng)
  const driver = await createDriver(db, actor, {
    firstName: name.firstName,
    lastName: name.lastName,
    email: seedEmail(`${name.firstName}.${name.lastName}`),
    phone: seedPhone(),
    preferredLocale: name.locale,
    licenseState: 'TX',
    licenseNumber: seedLicenseNumber('TX'),
    cdlClass: 'A',
    endorsements: opts.endorsements ?? [],
    licenseExpiresAt: opts.expiringSoon ? daysFromNow(20) : daysFromNow(700),
    medicalCardExpiresAt: opts.expiringSoon ? daysFromNow(25) : daysFromNow(500),
  })

  const cdlFront = await buildSeedPdf('Commercial Driver License (front)', [`Driver: ${name.firstName} ${name.lastName}`, 'Class A CDL.'])
  await uploadAndApprove(db, actor, { ownerType: 'driver', ownerId: driver.id, documentType: 'cdl_front', title: 'CDL Front', bytes: cdlFront })
  const medCard = await buildSeedPdf('DOT Medical Examiner Certificate', [`Driver: ${name.firstName} ${name.lastName}`])
  await uploadAndApprove(db, actor, {
    ownerType: 'driver',
    ownerId: driver.id,
    documentType: 'medical_card',
    title: 'Medical Card',
    bytes: medCard,
    expirationDate: opts.expiringSoon ? daysFromNow(25) : daysFromNow(500),
  })

  await reviewDriverLicense(db, actor, { driverId: driver.id, status: 'verified' })
  await addDriverCarrierRelationship(db, { userId: actor.userId }, { driverId: driver.id, carrierId, isPrimary: true })
  return driver
}

/* ── Entry point ──────────────────────────────────────────────────────────── */

export async function seedTenantA(password: string): Promise<TenantASummary> {
  logStep('▸ tenant A: Goliath Dispatch Co.')

  const adminName = { firstName: 'Diane', lastName: 'Whitfield' }
  const adminEmail = 'diane.whitfield@example.com'

  const existing = await unsafeDb.select().from(tenants).where(eq(tenants.slug, 'goliath-dispatch-co')).limit(1)
  let tenantId: string
  let adminUserId: string

  if (existing[0]) {
    tenantId = existing[0].id
    const adminRow = await unsafeDb.query.users.findFirst({ where: (u, { eq: eqOp }) => eqOp(u.emailNormalized, adminEmail) })
    adminUserId = adminRow!.id
    logStep('  ↳ tenant already seeded, skipping (idempotent re-run)')
    return summarizeExisting(tenantId, existing[0].slug, adminEmail)
  }

  const provisioned = await provisionTenant({
    companyName: 'Goliath Dispatch Co.',
    admin: { ...adminName, email: adminEmail, password },
    planCode: 'growth',
    locale: 'en',
    ip: SEED_REQUEST_CONTEXT.ipAddress,
    userAgent: SEED_REQUEST_CONTEXT.userAgent,
  })
  tenantId = provisioned.tenantId
  adminUserId = provisioned.adminUserId

  await unsafeDb.update(tenants).set({ status: 'active', provisionedAt: SEED_NOW }).where(eq(tenants.id, tenantId))
  // `provisionTenant` (the real public signup path) always leaves the new
  // Admin `pending_verification` — a real signup must click the emailed
  // verification link before they can log in. The demo credentials are
  // documented and handed out as ready to sign in with immediately, so this
  // seed stands in for that click, exactly like `createSeedUser` already
  // does for every other seeded account (`emailVerifiedAt: SEED_NOW`,
  // `status: 'active'`) below.
  await unsafeDb.update(users).set({ status: 'active', emailVerifiedAt: SEED_NOW }).where(eq(users.id, adminUserId))
  await createSubscriptionForTenant({ tenantId, planCode: 'growth', adminEmail, adminName: `${adminName.firstName} ${adminName.lastName}` })

  const db = tenantDb(tenantId)
  const adminUser = { userId: adminUserId, firstName: adminName.firstName, lastName: adminName.lastName, email: adminEmail, locale: 'en' as const }
  const adminActor = actorFor(adminUser, tenantId, 'admin')

  // `admin` is in `MFA_REQUIRED_ROLES` (`server/auth/mfa.ts`) — the app
  // layout redirects any unenrolled member of that role to `/app/mfa-setup`
  // on *every* request, no matter which page they asked for. Leaving the
  // seeded Admin unenrolled — as opposed to Accounting just below, which
  // already gets this — meant this account could never reach a single real
  // page after logging in, only ever the MFA setup screen.
  await seedMfaFor(adminUserId, adminEmail)

  const credentials: TenantASummary['credentials'] = [{ role: 'Admin (MFA enrolled)', email: adminEmail }]

  /* ── Additional users, every role ──────────────────────────────────────── */

  const accountingName = seedName(rng)
  const accounting = await createSeedUser(tenantId, {
    firstName: accountingName.firstName,
    lastName: accountingName.lastName,
    email: 'marisol.gutierrez@example.com',
    role: 'accounting',
    locale: 'es',
    password,
  })
  credentials.push({ role: 'Accounting (MFA enrolled)', email: accounting.email })
  await seedMfaFor(accounting.userId, accounting.email)

  const dispatcherA = await createSeedUser(tenantId, {
    firstName: 'Kevin',
    lastName: 'Marsh',
    email: 'kevin.marsh@example.com',
    role: 'dispatcher',
    locale: 'en',
    password,
  })
  credentials.push({ role: 'Dispatcher (full book)', email: dispatcherA.email })

  const dispatcherBName = seedName(rng)
  const dispatcherB = await createSeedUser(tenantId, {
    firstName: 'Alejandro',
    lastName: 'Duarte',
    email: 'alejandro.duarte@example.com',
    role: 'dispatcher',
    locale: 'es',
    password,
  })
  credentials.push({ role: 'Dispatcher (restricted to 2 carriers)', email: dispatcherB.email })
  void dispatcherBName

  logStep('  ↳ users created')

  /* ── Carriers ─────────────────────────────────────────────────────────── */

  const plans: CarrierPlan[] = [
    // Legal name must match the FMCSA_MOCK_DOT_CLEAN fixture (`Summit Heavy Haul LLC`)
    // closely enough (suffix/casing differences are tolerated, anything more is not)
    // for `compareEnteredToReported` to actually return `verified` rather than a
    // reviewable `mismatch` — this is the one carrier meant to clear FMCSA with no
    // manual override at all.
    { key: 'lonestar', legalName: 'Summit Heavy Haul LLC', dot: FMCSA_MOCK_DOT_CLEAN, usesFactoring: true, outcome: 'approved_active', fmcsaClean: true },
    { key: 'permian', legalName: 'Permian Basin Transport LLC', dot: seedDot(), usesFactoring: false, outcome: 'approved_active', fmcsaClean: false },
    { key: 'gulfcoast', legalName: 'Gulf Coast Rigging & Transport', dot: FMCSA_MOCK_DOT_NAME_MISMATCH, usesFactoring: false, outcome: 'under_review', fmcsaClean: false },
    { key: 'riogrande', legalName: 'Rio Grande Freight Solutions', dot: FMCSA_MOCK_DOT_NO_AUTHORITY, usesFactoring: false, outcome: 'rejected', fmcsaClean: false },
    { key: 'highland', legalName: 'Highland Steel Carriers', dot: seedDot(), usesFactoring: false, outcome: 'draft', fmcsaClean: false },
    { key: 'cactusrose', legalName: 'Cactus Rose Logistics', dot: seedDot(), usesFactoring: false, outcome: 'submitted', fmcsaClean: false },
    { key: 'sabine', legalName: 'Sabine Trucking Group', dot: seedDot(), usesFactoring: false, outcome: 'corrections_required', fmcsaClean: false },
    { key: 'rivera', legalName: SHARED_CARRIER_NAME, dot: SHARED_CARRIER_DOT, usesFactoring: false, outcome: 'approved_suspended', fmcsaClean: false },
  ]

  const carrierIds: Record<string, string> = {}
  for (const plan of plans) {
    const result = await seedOneCarrier(db, adminActor, adminUserId, plan)
    carrierIds[plan.key] = result.carrierId
  }
  logStep('  ↳ 8 carriers created across every onboarding status')

  await assignDispatcher(db, { userId: adminUserId }, { carrierId: carrierIds.lonestar!, dispatcherUserId: dispatcherA.userId, reason: 'Primary book of business.' })
  await assignDispatcher(db, { userId: adminUserId }, { carrierId: carrierIds.permian!, dispatcherUserId: dispatcherA.userId, reason: 'Primary book of business.' })
  await assignDispatcher(db, { userId: adminUserId }, { carrierId: carrierIds.gulfcoast!, dispatcherUserId: dispatcherB.userId, reason: 'Restricted assignment for onboarding follow-up.' })
  await assignDispatcher(db, { userId: adminUserId }, { carrierId: carrierIds.cactusrose!, dispatcherUserId: dispatcherB.userId, reason: 'Restricted assignment for onboarding follow-up.' })

  /* ── Carrier-role and driver-role portal users ───────────────────────── */

  const lonestarCarrierUser = await createSeedUser(tenantId, {
    firstName: 'Rosa',
    lastName: 'Delgado',
    email: 'rosa.delgado@example.com',
    role: 'carrier',
    locale: 'es',
    password,
    carrierId: carrierIds.lonestar,
  })
  credentials.push({ role: 'Carrier portal user (Summit Heavy Haul)', email: lonestarCarrierUser.email })

  const permianCarrierUser = await createSeedUser(tenantId, {
    firstName: 'Gregory',
    lastName: 'Nash',
    email: 'gregory.nash@example.com',
    role: 'carrier',
    locale: 'en',
    password,
    carrierId: carrierIds.permian,
  })
  credentials.push({ role: 'Carrier portal user (Permian Basin Transport)', email: permianCarrierUser.email })

  /* ── Equipment: two compliant fleets ─────────────────────────────────── */

  const lonestarFleet = await seedCompliantFleet(db, adminActor, carrierIds.lonestar!, { truckCount: 6, trailerCount: 7 })
  const permianFleet = await seedCompliantFleet(db, adminActor, carrierIds.permian!, { truckCount: 5, trailerCount: 6 })
  logStep(`  ↳ equipment created: ${lonestarFleet.truckIds.length + permianFleet.truckIds.length + 2} trucks, ${lonestarFleet.trailerIds.length + permianFleet.trailerIds.length} trailers`)

  // Admin-overrides the deliberate VIN-mismatch truck on Lonestar's fleet.
  const { overrideEquipmentVerification } = await import('@/server/verification/equipment-verification')
  const { equipmentVerifications } = await import('@/db/schema')
  const { desc: descOp } = await import('drizzle-orm')
  const mismatchVerification = await db.findFirst(equipmentVerifications, {
    where: and(eq(equipmentVerifications.equipmentType, 'truck'), eq(equipmentVerifications.equipmentId, lonestarFleet.mismatchTruckId)),
    orderBy: descOp(equipmentVerifications.createdAt),
  })
  if (mismatchVerification) {
    await overrideEquipmentVerification(db, adminActor, mismatchVerification.id, 'Confirmed by phone with the carrier’s safety office that this unit is covered under an addendum not yet reflected on the scanned COI; physical inspection matches VIN on file.')
    await transitionEquipmentStatus(db, adminActor, { equipmentType: 'truck', equipmentId: lonestarFleet.mismatchTruckId, toStatus: 'active' })
  }

  /* ── Drivers (multi-carrier relationships included) ──────────────────── */

  const lonestarDriverIds: string[] = []
  for (let i = 0; i < 8; i += 1) {
    const d = await seedDriver(db, adminActor, carrierIds.lonestar!, {
      endorsements: i % 3 === 0 ? ['H', 'N'] : i % 3 === 1 ? ['T'] : [],
      expiringSoon: i === 1,
    })
    lonestarDriverIds.push(d.id)
  }
  const permianDriverIds: string[] = []
  for (let i = 0; i < 6; i += 1) {
    const d = await seedDriver(db, adminActor, carrierIds.permian!, { endorsements: i % 2 === 0 ? ['X'] : [] })
    permianDriverIds.push(d.id)
  }
  // Two drivers work for both carriers.
  await addDriverCarrierRelationship(db, { userId: adminUserId }, { driverId: lonestarDriverIds[0]!, carrierId: carrierIds.permian! })
  await addDriverCarrierRelationship(db, { userId: adminUserId }, { driverId: lonestarDriverIds[1]!, carrierId: carrierIds.permian! })
  logStep(`  ↳ ${lonestarDriverIds.length + permianDriverIds.length} drivers created`)

  const lonestarDriverUser = await createSeedUser(tenantId, {
    firstName: 'Carmen',
    lastName: 'Reyes',
    email: 'carmen.reyes@example.com',
    role: 'driver',
    locale: 'es',
    password,
    carrierId: carrierIds.lonestar,
    driverId: lonestarDriverIds[0],
  })
  credentials.push({ role: 'Driver portal user', email: lonestarDriverUser.email })

  /* ── Customers ────────────────────────────────────────────────────────── */

  const customerNames = [
    'Apex Wind Components',
    'Bluewater Marine Fabrication',
    'Cascade Steel Structures',
    'Delta Refinery Services',
    'Emberline Modular Buildings',
    'Frontier Power Transformers',
    'Granite Bridge Works',
    'Harborline Crane & Rigging',
    'Ironvale Turbine Systems', // near-duplicate pair #1
    'Ironvale Turbine Systems Inc', // near-duplicate pair #2 (same real coordinates, deliberately similar name)
  ]
  const customerIds: string[] = []
  const customerLocationByIndex: Array<{ locationId: string; lat: number; lng: number }> = []
  const ironvaleCity = pick(rng, MOCK_CITIES) // the near-duplicate pair shares real coordinates.
  for (let i = 0; i < customerNames.length; i += 1) {
    const isIronvale = customerNames[i]!.startsWith('Ironvale')
    const city = isIronvale ? ironvaleCity : pick(rng, MOCK_CITIES)
    const contact = seedName(rng)
    const result = await createCustomer(db, { userId: adminUserId }, {
      companyName: customerNames[i]!,
      phone: seedPhone(),
      email: seedEmail(`accounting.${customerNames[i]!.split(' ')[0]}`),
      physicalCity: city.name,
      physicalState: city.state,
      billingSameAsPhysical: true,
      paymentTermsDays: pick(rng, [15, 30, 45]),
      // Only the second Ironvale row needs the override — it is the one that
      // trips `detectDuplicateCustomers` against the first.
      overrideDuplicate: isIronvale ? true : undefined,
      duplicateOverrideReason: isIronvale ? 'Confirmed with the customer these are two distinct legal entities at the same yard (parent/subsidiary); intentionally kept as separate customer records.' : undefined,
      notes: 'Seeded demo customer.',
    })
    if (result.status !== 'created') continue
    customerIds.push(result.customer.id)
    await createContact(db, { userId: adminUserId }, {
      customerId: result.customer.id,
      firstName: contact.firstName,
      lastName: contact.lastName,
      email: seedEmail(`${contact.firstName}.${contact.lastName}`),
      phone: seedPhone(),
      position: pick(rng, ['Logistics Manager', 'Procurement Lead', 'Operations Director']),
      isPrimary: true,
    })
    const location = await createLocation(db, { userId: adminUserId }, {
      customerId: result.customer.id,
      name: `${customerNames[i]} — Main Yard`,
      line1: `${intBetween(rng, 100, 9900)} ${pick(rng, ['Commerce', 'Industrial', 'Harbor', 'Freight'])} Way`,
      city: city.name,
      state: city.state,
      postalCode: String(intBetween(rng, 10000, 99999)),
      isPrimary: true,
    })
    customerLocationByIndex.push({ locationId: location.id, lat: city.lat, lng: city.lng })
  }
  logStep(`  ↳ ${customerIds.length} customers created (incl. one near-duplicate pair)`)

  /* ── Factoring ────────────────────────────────────────────────────────── */

  const factoringCompany = await createFactoringCompany(db, {
    name: 'Meridian Freight Capital',
    contactName: 'Factoring Desk',
    email: seedEmail('desk.meridian'),
    phone: seedPhone(),
    addressCity: 'Dallas',
    addressState: 'TX',
    fundingInstructions: 'Wire proceeds to the account on file within 24 hours of invoice submission.',
  })
  const factoringAssignment = await createFactoringAssignment(db, { carrierId: carrierIds.lonestar!, factoringCompanyId: factoringCompany.id, notes: 'Standard non-recourse factoring.' })
  const noaFactoring = await buildSeedPdf('Notice of Assignment (Factoring)', ['Summit Heavy Haul LLC assigns proceeds to Meridian Freight Capital.'])
  const factoringNoaAssignment = await uploadFactoringDocument(db, adminActor, { assignmentId: factoringAssignment.id, kind: 'notice_of_assignment', originalFilename: 'noa.pdf', bytes: noaFactoring })
  // `uploadFactoringDocument` files paperwork under the same `notice_of_assignment`
  // document type onboarding's own required-document check reads
  // (`compliance/service.ts::loadCarrierGateInput` matches by type, most-recent
  // first) — leaving it unreviewed would silently re-block a carrier that was
  // already approved, so it gets the same explicit review step onboarding's copy did.
  if (factoringNoaAssignment.noticeOfAssignmentDocumentId) {
    await reviewDocument(db, adminActor, { documentId: factoringNoaAssignment.noticeOfAssignmentDocumentId, status: 'approved' })
  }
  await setFactoringVerificationStatus(db, adminActor, factoringAssignment.id, 'verified', 'Confirmed by phone with Meridian.')
  logStep('  ↳ factoring company + assignment created')

  /* ── Loads ────────────────────────────────────────────────────────────── */

  const loadResult = await seedLoads(db, adminActor, adminUserId, {
    customerIds,
    lonestarCarrierId: carrierIds.lonestar!,
    permianCarrierId: carrierIds.permian!,
    lonestarTruckIds: lonestarFleet.truckIds,
    lonestarTrailerIds: lonestarFleet.trailerIds,
    lonestarDriverIds,
    permianTruckIds: permianFleet.truckIds,
    permianTrailerIds: permianFleet.trailerIds,
    permianDriverIds,
    factoringCompanyId: factoringCompany.id,
  })
  logStep(`  ↳ ${loadResult.loadIds.length} loads created spanning every status`)

  /* ── Settlements ──────────────────────────────────────────────────────── */

  try {
    // `generateSettlementForPeriod` matches on `financialSnapshots.computedAt`
    // — the *real* wall-clock timestamp each snapshot was inserted at (a
    // plain `defaultNow()` column), not anything derived from the fixed
    // `SEED_NOW` the rest of this seed uses for load/document dates. Every
    // snapshot this run produces was computed moments ago in real time, so
    // the settlement period has to bracket the actual current instant
    // rather than `daysAgo(...)` (which is relative to `SEED_NOW`).
    const settlementPeriodStart = new Date(Date.now() - 24 * 3_600_000)
    const settlementPeriodEnd = new Date(Date.now() + 24 * 3_600_000)

    const settlementA = await generateSettlementForPeriod(db, {
      carrierId: carrierIds.lonestar!,
      periodStart: settlementPeriodStart,
      periodEnd: settlementPeriodEnd,
      factoringCompanyId: factoringCompany.id,
    })
    const issuedA = await issueSettlement(
      db,
      adminActor,
      settlementA.settlement.id,
      { tenantName: 'Goliath Dispatch Co.', tenantAddressLines: ['4820 Logistics Pkwy, Houston, TX 77032'], timezone: 'America/Chicago' },
      'en',
      await translatorFor('en'),
    )
    await markSettlementPaid(db, issuedA.id)

    const settlementB = await generateSettlementForPeriod(db, { carrierId: carrierIds.permian!, periodStart: settlementPeriodStart, periodEnd: settlementPeriodEnd })
    await issueSettlement(
      db,
      adminActor,
      settlementB.settlement.id,
      { tenantName: 'Goliath Dispatch Co.', tenantAddressLines: ['4820 Logistics Pkwy, Houston, TX 77032'], timezone: 'America/Chicago' },
      'en',
      await translatorFor('en'),
    )
    logStep('  ↳ 2 carrier settlements created (one paid, one issued)')
  } catch (error) {
    logStep(`  ↳ settlements: skipped (${(error as Error).message})`)
  }

  /* ── Signature ceremonies ────────────────────────────────────────────── */

  await seedSignatures(db, adminActor, adminUserId, carrierIds.lonestar!)
  logStep('  ↳ signature requests created (completed, pending, needs re-signature)')

  /* ── Messaging ────────────────────────────────────────────────────────── */

  if (loadResult.messagingLoadId) {
    // `createConversation`'s scope check (`message:read`) has nothing to
    // scope a dispatcher against unless the conversation carries the same
    // `carrierId` as the load it's attached to — passing `loadId` alone
    // leaves a dispatcher (whose access is carrier-assignment-scoped) with
    // no fact to pass, so the carrier has to come along too.
    const messagingLoad = await db.requireById(loads, loadResult.messagingLoadId, 'load')
    const conversation = await createConversation(db, adminActor, {
      kind: 'load',
      loadId: loadResult.messagingLoadId,
      carrierId: messagingLoad.carrierId,
      participantUserIds: [dispatcherA.userId],
      participantRoles: { [adminActor.userId]: 'admin', [dispatcherA.userId]: 'dispatcher' },
    })
    await sendMessage(db, adminActor, { conversationId: conversation.conversation.id, body: 'Carrier confirmed pickup appointment for 7am — please relay to the driver.' })
    await sendMessage(db, actorFor({ userId: dispatcherA.userId, firstName: 'Kevin', lastName: 'Marsh', email: dispatcherA.email, locale: 'en' }, tenantId, 'dispatcher'), {
      conversationId: conversation.conversation.id,
      body: 'Confirmed with the driver — will update the load once en route.',
    })
  }

  /* ── Leads ────────────────────────────────────────────────────────────── */

  await seedLeads(tenantId)
  logStep('  ↳ leads + quote requests created')

  /* ── Audit trail (representative, direct — see helpers/comments) ────── */

  await recordAudit(adminActor, SEED_REQUEST_CONTEXT, {
    action: 'settings.updated',
    entityType: 'tenant',
    entityId: tenantId,
    entityLabel: 'Goliath Dispatch Co.',
    metadata: { note: 'Demo environment seeded.' },
  })

  await runJobsToCompletion('final')

  const finalCarrierCount = plans.length
  const finalTruckCount = lonestarFleet.truckIds.length + permianFleet.truckIds.length + 2
  const finalTrailerCount = lonestarFleet.trailerIds.length + permianFleet.trailerIds.length
  const finalDriverCount = lonestarDriverIds.length + permianDriverIds.length

  return {
    tenantId,
    slug: provisioned.slug,
    adminEmail,
    userCount: credentials.length,
    carrierCount: finalCarrierCount,
    truckCount: finalTruckCount,
    trailerCount: finalTrailerCount,
    driverCount: finalDriverCount,
    customerCount: customerIds.length,
    loadCount: loadResult.loadIds.length,
    credentials,
  }
}

async function translatorFor(locale: 'en' | 'es') {
  const { getDictionary } = await import('@/i18n/dictionary')
  const { createTranslator } = await import('@/i18n/translate')
  const dictionary = await getDictionary(locale)
  return createTranslator(dictionary, locale)
}

/* ── Loads ────────────────────────────────────────────────────────────────── */

interface SeedLoadsInput {
  customerIds: string[]
  lonestarCarrierId: string
  permianCarrierId: string
  lonestarTruckIds: string[]
  lonestarTrailerIds: string[]
  lonestarDriverIds: string[]
  permianTruckIds: string[]
  permianTrailerIds: string[]
  permianDriverIds: string[]
  factoringCompanyId: string
}

type LoadTarget =
  | 'draft'
  | 'available'
  | 'assigned'
  | 'dispatched'
  | 'in_transit'
  | 'delivered'
  | 'pod_received'
  | 'invoiced'
  | 'paid'
  | 'cancelled'

/** Targets that require passing through the `dispatched` transition (and therefore the dispatch compliance gate). */
const NEEDS_DISPATCH_GATE = new Set<LoadTarget>(['dispatched', 'in_transit', 'delivered', 'pod_received', 'invoiced', 'paid'])

interface LoadPlan {
  pickupDaysAgo: number
  target: LoadTarget
  carrier: 'lonestar' | 'permian' | 'none'
  oversize: boolean
  multiStop: boolean
  detention: boolean
  fleet: 'truck0' | 'truck1'
}

function buildLoadPlans(): LoadPlan[] {
  const plans: LoadPlan[] = []
  // A spread across every status, over the last 120 days.
  const targets: LoadTarget[] = ['draft', 'available', 'available', 'assigned', 'assigned', 'dispatched', 'dispatched', 'in_transit', 'delivered', 'delivered', 'pod_received', 'invoiced', 'invoiced', 'paid', 'paid', 'paid', 'paid', 'paid', 'paid', 'cancelled', 'cancelled']
  for (let i = 0; i < targets.length; i += 1) {
    const target = targets[i]!
    plans.push({
      pickupDaysAgo: intBetween(rng, 2, 118),
      target,
      carrier: target === 'draft' ? 'none' : i % 2 === 0 ? 'lonestar' : 'permian',
      oversize: i % 5 === 0,
      multiStop: i % 6 === 0,
      detention: i % 7 === 0 && (target === 'delivered' || target === 'pod_received' || target === 'invoiced' || target === 'paid'),
      fleet: i % 2 === 0 ? 'truck0' : 'truck1',
    })
  }
  // A couple more "paid" loads specifically to demonstrate a duplicated pair.
  plans.push({ pickupDaysAgo: 40, target: 'paid', carrier: 'lonestar', oversize: false, multiStop: false, detention: false, fleet: 'truck0' })
  return plans
}

async function seedLoads(
  db: ReturnType<typeof tenantDb>,
  actor: Actor,
  adminUserId: string,
  input: SeedLoadsInput,
): Promise<{ loadIds: string[]; messagingLoadId: string | null }> {
  const plans = buildLoadPlans()
  const loadIds: string[] = []
  let messagingLoadId: string | null = null
  let oversizeShowcaseLoadId: string | null = null
  let cancelledSourceLoadId: string | null = null
  let firstInvoicedLoadId: string | null = null
  let firstPaidLoadId: string | null = null

  for (let i = 0; i < plans.length; i += 1) {
    const plan = plans[i]!
    const customerId = input.customerIds[i % input.customerIds.length]!
    const originCity = pick(rng, MOCK_CITIES)
    let destCity = pick(rng, MOCK_CITIES)
    while (destCity.name === originCity.name) destCity = pick(rng, MOCK_CITIES)

    const pickupAt = daysAgo(plan.pickupDaysAgo)
    const deliveryAt = new Date(pickupAt.getTime() + 2 * 86_400_000)

    const stops = [
      {
        stopType: 'pickup' as const,
        facilityName: 'Shipper Yard',
        city: originCity.name,
        state: originCity.state,
        appointmentType: 'window' as const,
        windowStart: pickupAt,
        windowEnd: new Date(pickupAt.getTime() + 3 * 3_600_000),
      },
      ...(plan.multiStop
        ? [
            {
              stopType: 'delivery' as const,
              facilityName: 'Interim Consignee',
              city: pick(rng, MOCK_CITIES).name,
              state: originCity.state,
              appointmentType: 'fcfs' as const,
              windowStart: new Date(pickupAt.getTime() + 1 * 86_400_000),
              windowEnd: new Date(pickupAt.getTime() + 1 * 86_400_000 + 4 * 3_600_000),
            },
          ]
        : []),
      {
        stopType: 'delivery' as const,
        facilityName: 'Final Consignee',
        city: destCity.name,
        state: destCity.state,
        appointmentType: 'window' as const,
        windowStart: deliveryAt,
        windowEnd: new Date(deliveryAt.getTime() + 4 * 3_600_000),
      },
    ]

    const carrierGrossRateCents = intBetween(rng, 1_800_00, 6_500_00)
    const customerChargeCents = carrierGrossRateCents + intBetween(rng, 200_00, 900_00)

    const { load } = await createLoad(db, { userId: adminUserId, role: 'admin' }, {
      customerId,
      commodity: pick(rng, ['Wind turbine blade', 'Transformer', 'Structural steel beams', 'Prefab modular unit', 'Marine vessel hull section', 'Mining excavator', 'Precast concrete girder']),
      weightPounds: plan.oversize ? intBetween(rng, 82_000, 148_000) : intBetween(rng, 20_000, 44_000),
      // Non-oversize lengths must stay within `STANDARD_MAX_LENGTH_INCHES`
      // (636) — `createLoad` computes `isOversize` itself from these
      // dimensions (`computeOversizeFlags`), independent of `plan.oversize`,
      // so a value above that threshold here would silently produce an
      // oversize load with no evaluation, which later blocks dispatch.
      lengthInches: plan.oversize ? intBetween(rng, 900, 1400) : intBetween(rng, 500, 630),
      widthInches: plan.oversize ? intBetween(rng, 110, 150) : intBetween(rng, 96, 102),
      heightInches: plan.oversize ? intBetween(rng, 150, 170) : intBetween(rng, 120, 140),
      grossVehicleWeightPounds: plan.oversize ? intBetween(rng, 95_000, 165_000) : intBetween(rng, 60_000, 80_000),
      customerChargeCents,
      carrierGrossRateCents,
      stops,
    })
    loadIds.push(load.id)

    if (plan.target === 'draft') continue

    await transitionStatus(db, { userId: adminUserId }, SEED_REQUEST_CONTEXT, { loadId: load.id, to: 'available' })
    if (plan.target === 'available') continue

    const carrierId = plan.carrier === 'lonestar' ? input.lonestarCarrierId : input.permianCarrierId
    await assignCarrier(db, { userId: adminUserId }, { loadId: load.id, carrierId })

    if (plan.oversize) {
      const evaluation = await runEvaluation(db, load.id)
      // `runEvaluation` auto-creates a `pending` permit/escort row (via
      // `ensureRequiredPermits`/`ensureRequiredEscorts`) for every route
      // state the oversize rules flag — for every oversize load, every time.
      // Any oversize load whose target reaches `dispatched` or beyond must
      // have every one of those rows resolved (`issued`/`confirmed`) or the
      // dispatch gate (`evaluateLoadForDispatch`) blocks the transition; a
      // load whose target never leaves `assigned` is deliberately left with
      // its evaluation un-validated and its permits/escorts still `pending`,
      // to demonstrate an oversize move still awaiting human sign-off.
      if (NEEDS_DISPATCH_GATE.has(plan.target)) {
        await validateEvaluation(db, { userId: adminUserId }, evaluation.id, { status: 'validated', notes: 'Reviewed state limits and confirmed permits below.' })

        const permitRows = await listPermitsForLoad(db, load.id)
        for (const permitRow of permitRows) {
          if (permitRow.status === 'issued') continue
          await updatePermit(db, actor, permitRow.id, {
            permitNumber: permitRow.permitNumber ?? `PMT-${intBetween(rng, 100000, 999999)}`,
            permitType: permitRow.permitType ?? 'oversize_overweight',
            issuedAt: daysAgo(plan.pickupDaysAgo + 3),
            expiresAt: daysFromNow(30),
            costCents: 25_000,
            status: 'issued',
          })
        }

        const escortRows = await listEscortsForLoad(db, load.id)
        if (escortRows.length === 0) {
          // The rules engine didn't flag a route-state escort requirement for
          // this load — still showcase one confirmed escort on the very
          // first oversize load reaching dispatch, via the real create path.
          if (!oversizeShowcaseLoadId) {
            await createEscort(db, actor, { loadId: load.id, escortType: 'pilot_car', stateCode: originCity.state, providerName: 'Texas Pilot Car Services', scheduledFor: pickupAt, costCents: 45_000, status: 'confirmed' })
          }
        } else {
          for (const escortRow of escortRows) {
            if (escortRow.status === 'confirmed') continue
            await updateEscort(db, actor, escortRow.id, {
              providerName: escortRow.providerName ?? 'Texas Pilot Car Services',
              scheduledFor: escortRow.scheduledFor ?? pickupAt,
              costCents: 45_000,
              status: 'confirmed',
            })
          }
        }
        oversizeShowcaseLoadId ??= load.id
      }
    }

    await transitionStatus(db, { userId: adminUserId }, SEED_REQUEST_CONTEXT, { loadId: load.id, to: 'assigned' })
    if (plan.target === 'assigned') continue

    const truckIds = plan.carrier === 'lonestar' ? input.lonestarTruckIds : input.permianTruckIds
    const trailerIds = plan.carrier === 'lonestar' ? input.lonestarTrailerIds : input.permianTrailerIds
    const driverIds = plan.carrier === 'lonestar' ? input.lonestarDriverIds : input.permianDriverIds
    const idx = plan.fleet === 'truck0' ? 0 : 1

    const assignment = await assignResources(db, { userId: adminUserId }, {
      loadId: load.id,
      truckIds: [truckIds[idx % truckIds.length]!],
      trailerIds: [trailerIds[idx % trailerIds.length]!],
      driverIds: [driverIds[idx % driverIds.length]!],
    })
    if (assignment.status !== 'assigned') {
      // A compliance gate blocked this candidate combination — fall back to the always-compliant first unit.
      await assignResources(db, { userId: adminUserId }, { loadId: load.id, truckIds: [truckIds[0]!], trailerIds: [trailerIds[0]!], driverIds: [driverIds[0]!] })
    }

    if (plan.target === 'cancelled') {
      await cancelLoad(db, { userId: adminUserId }, SEED_REQUEST_CONTEXT, load.id, 'Shipper cancelled the move after a change in production schedule.')
      if (!cancelledSourceLoadId) cancelledSourceLoadId = load.id
      continue
    }

    await transitionStatus(db, { userId: adminUserId }, SEED_REQUEST_CONTEXT, { loadId: load.id, to: 'dispatched' })
    messagingLoadId ??= load.id
    if (plan.target === 'dispatched') continue

    await transitionStatus(db, { userId: adminUserId }, SEED_REQUEST_CONTEXT, { loadId: load.id, to: 'en_route_to_pickup' })
    await transitionStatus(db, { userId: adminUserId }, SEED_REQUEST_CONTEXT, { loadId: load.id, to: 'at_pickup' })

    const loadStopsForThis = await db.findMany((await import('@/db/schema')).loadStops, { where: eq((await import('@/db/schema')).loadStops.loadId, load.id) })
    const firstStop = loadStopsForThis.sort((a, b) => a.sequence - b.sequence)[0]
    if (firstStop) {
      await recordStopArrival(db, { userId: adminUserId }, { stopId: firstStop.id, arrivedAt: pickupAt })
      const departureAt = plan.detention ? new Date(pickupAt.getTime() + 5 * 3_600_000) : new Date(pickupAt.getTime() + 45 * 60_000)
      await recordStopDeparture(db, { userId: adminUserId }, { stopId: firstStop.id, departedAt: departureAt, detentionNotes: plan.detention ? 'Yard congestion at shipper delayed loading.' : null })
      if (plan.detention) {
        const fuelCategory = await db.findFirst(expenseCategories, { where: eq(expenseCategories.code, 'detention') })
        if (fuelCategory) {
          const expense = await submitExpense(db, actor, { loadId: load.id, categoryId: fuelCategory.id, amountCents: 35_000, description: 'Detention at shipper — 4 hours beyond free time.' })
          await approveExpense(db, actor, expense.id)
        }
      }
    }

    await transitionStatus(db, { userId: adminUserId }, SEED_REQUEST_CONTEXT, { loadId: load.id, to: 'in_transit' })
    if (plan.target === 'in_transit') continue

    await transitionStatus(db, { userId: adminUserId }, SEED_REQUEST_CONTEXT, { loadId: load.id, to: 'at_delivery' })
    await transitionStatus(db, { userId: adminUserId }, SEED_REQUEST_CONTEXT, { loadId: load.id, to: 'delivered' })
    if (plan.target === 'delivered') continue

    // A POD document — uploaded through the real load-document path
    // (`uploadLoadDocument`, which creates the `load_documents` join row in
    // the same transaction as the upload) and approved through the real
    // review path, exactly what a driver + reviewer would do in the product.
    const podBytes = await buildSeedPdf('Proof of Delivery', [`Load ${load.loadNumber}`, 'Signed and dated by consignee.'])
    const { document: podDocument } = await uploadLoadDocument(db, actor, {
      loadId: load.id,
      documentType: 'pod',
      originalFilename: 'pod.pdf',
      bytes: podBytes,
    })
    await reviewDocument(db, actor, { documentId: podDocument.id, status: 'approved' })

    await transitionStatus(db, { userId: adminUserId }, SEED_REQUEST_CONTEXT, { loadId: load.id, to: 'pod_received' })
    await runJobsToCompletion(`invoice-draft:${load.loadNumber}`)
    if (plan.target === 'pod_received') continue

    const draftInvoice = firstInvoicedLoadId ? null : await createDraftInvoiceForLoad(db, load.id).catch(() => null)
    void draftInvoice
    const invoiceRow = await db.findFirst((await import('@/db/schema')).invoices, { where: eq((await import('@/db/schema')).invoices.loadId, load.id) })
    if (!invoiceRow) continue

    const sent = await sendInvoice(
      db,
      actor,
      invoiceRow.id,
      { tenantName: 'Goliath Dispatch Co.', tenantAddressLines: ['4820 Logistics Pkwy, Houston, TX 77032'], timezone: 'America/Chicago' },
      'en',
      await translatorFor('en'),
    )
    firstInvoicedLoadId ??= load.id

    await transitionStatus(db, { userId: adminUserId }, SEED_REQUEST_CONTEXT, { loadId: load.id, to: 'invoiced' })
    if (plan.target === 'invoiced') continue

    const { payment } = await recordManualPayment(db, actor, { invoiceId: sent.id, amountCents: sent.totalCents, method: 'ach', reference: `ACH-${intBetween(rng, 100000, 999999)}` })
    if (!firstPaidLoadId) {
      // The very first fully-paid invoice gets a partial refund, to demonstrate that path.
      await refundPayment(db, { paymentId: payment.id, amountCents: Math.round(sent.totalCents * 0.1), reason: 'Shipper disputed a $ accessorial line; partial credit issued.' })
      firstPaidLoadId = load.id
    }
    await transitionStatus(db, { userId: adminUserId }, SEED_REQUEST_CONTEXT, { loadId: load.id, to: 'paid' })
  }

  // A duplicated pair: the last "paid" load in the plan gets duplicated into a fresh draft.
  const lastLoadId = loadIds[loadIds.length - 1]
  if (lastLoadId) {
    await duplicateLoad(db, { userId: adminUserId, role: 'admin' }, lastLoadId)
  }
  void cancelledSourceLoadId

  return { loadIds, messagingLoadId }
}

/* ── Signature ceremonies ─────────────────────────────────────────────────── */

async function seedSignatures(db: ReturnType<typeof tenantDb>, actor: Actor, adminUserId: string, carrierId: string): Promise<void> {
  const carrier = await db.requireById(carriers, carrierId, 'carrier')

  // 1. A fully completed ceremony.
  const completed = await createSignatureRequest(db, {
    templateKey: 'notice_of_assignment',
    subjectType: 'carrier',
    subjectId: carrierId,
    carrierId,
    signerEmail: carrier.email,
    locale: 'en',
    tokenValues: {
      tenantLegalName: 'Goliath Dispatch Co.',
      carrierLegalName: carrier.legalName,
      carrierDotNumber: carrier.dotNumber,
      customerName: 'Meridian Freight Capital',
      effectiveDate: daysAgo(20).toISOString().slice(0, 10),
      signerName: `${carrier.contactFirstName} ${carrier.contactLastName}`,
    },
    requestedByUserId: adminUserId,
  })
  const resolved = await resolveSignatureRequestByToken(completed.rawToken)
  void resolved
  await signDocument(db, {
    requestId: completed.request.id,
    signerLegalName: `${carrier.contactFirstName} ${carrier.contactLastName}`,
    signerTitle: 'Owner',
    method: 'typed',
    signatureDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    typedName: `${carrier.contactFirstName} ${carrier.contactLastName}`,
    hasDrawnStrokes: false,
    consentAccepted: true,
    locale: 'en',
    ip: '203.0.113.20',
    userAgent: 'goliath-seed/1.0',
    actorUserId: null,
  })

  // 2. A pending ceremony (never signed).
  await createSignatureRequest(db, {
    templateKey: 'change_of_payee',
    subjectType: 'carrier',
    subjectId: carrierId,
    carrierId,
    signerEmail: carrier.email,
    locale: carrier.preferredLocale,
    tokenValues: {
      tenantLegalName: 'Goliath Dispatch Co.',
      carrierLegalName: carrier.legalName,
      carrierDotNumber: carrier.dotNumber,
      factoringCompanyName: 'Meridian Freight Capital',
      effectiveDate: SEED_NOW.toISOString().slice(0, 10),
      signerName: `${carrier.contactFirstName} ${carrier.contactLastName}`,
    },
    requestedByUserId: adminUserId,
    expiresInDays: 14,
  })

  // 3. A ceremony that needs re-signature: signed once, then the template content changed.
  const stale = await createSignatureRequest(db, {
    templateKey: 'notice_of_assignment',
    subjectType: 'carrier',
    subjectId: carrierId,
    carrierId,
    signerEmail: carrier.email,
    locale: 'en',
    tokenValues: {
      tenantLegalName: 'Goliath Dispatch Co.',
      carrierLegalName: carrier.legalName,
      carrierDotNumber: carrier.dotNumber,
      customerName: 'A prior factor',
      effectiveDate: daysAgo(200).toISOString().slice(0, 10),
      signerName: `${carrier.contactFirstName} ${carrier.contactLastName}`,
    },
    requestedByUserId: adminUserId,
  })
  await signDocument(db, {
    requestId: stale.request.id,
    signerLegalName: `${carrier.contactFirstName} ${carrier.contactLastName}`,
    method: 'typed',
    signatureDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    typedName: `${carrier.contactFirstName} ${carrier.contactLastName}`,
    hasDrawnStrokes: false,
    consentAccepted: true,
    locale: 'en',
    ip: '203.0.113.21',
    userAgent: 'goliath-seed/1.0',
    actorUserId: null,
  })
  const { createNewTemplateVersion, getActiveTemplate } = await import('@/server/signatures/templates')
  const currentTemplate = await getActiveTemplate(db, 'notice_of_assignment')
  if (currentTemplate) {
    await createNewTemplateVersion(db, 'notice_of_assignment', {
      titleEn: currentTemplate.titleEn,
      titleEs: currentTemplate.titleEs,
      bodyEn: 'REVISED: This Notice of Assignment (v2) confirms that {{tenantLegalName}}, acting as dispatch representative for {{carrierLegalName}} (USDOT {{carrierDotNumber}}), directs {{customerName}} to remit all payments to the account on file, effective {{effectiveDate}}. Signed by {{signerName}}.',
      bodyEs: 'REVISADO: Este Aviso de Cesión (v2) confirma que {{tenantLegalName}} dirige a {{customerName}} a remitir los pagos a la cuenta registrada, a partir del {{effectiveDate}}. Firmado por {{signerName}}.',
      consentCopyEn: currentTemplate.consentCopyEn,
      consentCopyEs: currentTemplate.consentCopyEs,
      requiredTokens: currentTemplate.requiredTokens,
    })
  }
}

/* ── Tracking (called from index.ts after the tracking session is built) ─── */

export async function seedTrackingForTenantA(
  tenantId: string,
  adminUserId: string,
  loadId: string,
  driverId: string,
  driverUserId: string,
): Promise<void> {
  const db = tenantDb(tenantId)
  await grantTrackingConsent(db, { userId: driverUserId })
  const session = await startTrackingSession(db, { loadId, driverId })

  const { advanceMockSession } = await import('@/server/tracking/sessions')
  const events = await advanceMockSession(db, session.id, 90)

  const { ingestEvents } = await import('@/server/tracking/ingest')
  await ingestEvents(db, session.id, events)

  await createPublicTrackingLink(db, { loadId, label: 'Customer share link', createdByUserId: adminUserId, ttlHours: 72 })
  const expiredLink = await createPublicTrackingLink(db, { loadId, label: 'Expired demo link', createdByUserId: adminUserId, ttlHours: 1 })
  await unsafeDb
    .update((await import('@/db/schema')).publicTrackingLinks)
    .set({ expiresAt: daysAgo(1) })
    .where(eq((await import('@/db/schema')).publicTrackingLinks.id, expiredLink.link.id))
}

/* ── Leads / quote requests ───────────────────────────────────────────────── */

async function seedLeads(tenantId: string): Promise<void> {
  const { leads, quoteRequests } = await import('@/db/schema')
  const leadContact = seedName(rng)
  const [lead] = await unsafeDb
    .insert(leads)
    .values({
      tenantId,
      source: 'carrier_signup',
      companyName: 'Big Bend Specialized Carriers',
      firstName: leadContact.firstName,
      lastName: leadContact.lastName,
      email: seedEmail('leads.bigbend'),
      phone: seedPhone(),
      dotNumber: seedDot(),
      status: 'new',
      locale: leadContact.locale,
      message: 'Interested in oversize/overweight dispatch services for a 4-truck fleet.',
    })
    .returning()

  const quoteContact = seedName(rng)
  await unsafeDb.insert(quoteRequests).values({
    tenantId,
    leadId: lead?.id ?? null,
    companyName: 'Coastal Modular Homes',
    contactName: `${quoteContact.firstName} ${quoteContact.lastName}`,
    email: seedEmail('quotes.coastal'),
    phone: seedPhone(),
    originCity: 'Houston',
    originState: 'TX',
    destinationCity: 'Denver',
    destinationState: 'CO',
    commodity: 'Modular home section',
    isOversizeSuspected: true,
    status: 'new',
  })
}

async function summarizeExisting(tenantId: string, slug: string, adminEmail: string): Promise<TenantASummary> {
  const carrierCount = await unsafeDb.select({ id: carriers.id }).from(carriers).where(eq(carriers.tenantId, tenantId)).then((r) => r.length)
  const truckCount = await unsafeDb.select({ id: trucks.id }).from(trucks).where(eq(trucks.tenantId, tenantId)).then((r) => r.length)
  const trailerCount = await unsafeDb.select({ id: trailers.id }).from(trailers).where(eq(trailers.tenantId, tenantId)).then((r) => r.length)
  const driverCount = await unsafeDb.select({ id: drivers.id }).from(drivers).where(eq(drivers.tenantId, tenantId)).then((r) => r.length)
  const loadCount = await unsafeDb.select({ id: loads.id }).from(loads).where(eq(loads.tenantId, tenantId)).then((r) => r.length)
  void newId
  void factoringCompanies
  void hoursAgo
  return {
    tenantId,
    slug,
    adminEmail,
    userCount: 0,
    carrierCount,
    truckCount,
    trailerCount,
    driverCount,
    customerCount: 0,
    loadCount,
    credentials: [{ role: 'Admin', email: adminEmail }],
  }
}
