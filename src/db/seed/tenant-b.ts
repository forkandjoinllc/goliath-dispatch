import 'server-only'
import { eq } from 'drizzle-orm'
import { unsafeDb } from '@/db/client'
import { tenantDb } from '@/db/tenant-db'
import { carriers, equipmentTypes, loads, tenants, users } from '@/db/schema'
import type { Actor } from '@/lib/permissions'
import { provisionTenant } from '@/server/tenants/provisioning'
import { createSubscriptionForTenant } from '@/server/tenants/subscription'
import {
  createCarrier,
  submitOnboarding,
  approveOnboarding,
  rejectOnboarding,
  transitionOnboarding,
  type CreateCarrierInput,
} from '@/server/carriers/service'
import { overrideVerification } from '@/server/verification/fmcsa-service'
import { uploadDocument, reviewDocument } from '@/server/documents/service'
import { createTruck, createTrailer, uploadEquipmentMedia, transitionEquipmentStatus } from '@/server/equipment/service'
import { createDriver, reviewDriverLicense, addDriverCarrierRelationship } from '@/server/drivers/service'
import { createCustomer, createContact, createLocation } from '@/server/customers/service'
import { createLoad, assignCarrier, assignResources, transitionStatus, cancelLoad } from '@/server/loads/service'
import { uploadLoadDocument } from '@/server/loads/documents'
import { createDraftInvoiceForLoad, sendInvoice, recordManualPayment } from '@/server/invoices/service'
import { mockCoiWithVins } from '@/integrations/ocr'
import { MOCK_CITIES } from '@/integrations/geo/mock-adapter'
import { fmcsaVerifications } from '@/db/schema'
import {
  actorFor,
  buildSeedPdf,
  buildSeedPhoto,
  createSeedUser,
  daysAgo,
  daysFromNow,
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
import { SHARED_CARRIER_DOT, SHARED_CARRIER_NAME } from './tenant-a'

const rng: Rng = makeRng(20260816)

export interface TenantBSummary {
  tenantId: string
  slug: string
  adminEmail: string
  carrierCount: number
  truckCount: number
  trailerCount: number
  driverCount: number
  customerCount: number
  loadCount: number
  credentials: Array<{ role: string; email: string; note?: string }>
}

async function uploadAndApprove(
  db: ReturnType<typeof tenantDb>,
  actor: Actor,
  input: { ownerType: 'carrier' | 'driver'; ownerId: string; documentType: Parameters<typeof uploadDocument>[2]['documentType']; title: string; bytes: Buffer; expirationDate?: Date | null },
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

export async function seedTenantB(password: string): Promise<TenantBSummary> {
  logStep('▸ tenant B: Summit Heavy Logistics')

  const adminName = { firstName: 'Marcus', lastName: 'Ilori' }
  const adminEmail = 'marcus.ilori@example.com'

  const existing = await unsafeDb.select().from(tenants).where(eq(tenants.slug, 'summit-heavy-logistics')).limit(1)
  if (existing[0]) {
    logStep('  ↳ tenant already seeded, skipping (idempotent re-run)')
    const carrierCount = await unsafeDb.select({ id: carriers.id }).from(carriers).where(eq(carriers.tenantId, existing[0].id)).then((r) => r.length)
    const loadCount = await unsafeDb.select({ id: loads.id }).from(loads).where(eq(loads.tenantId, existing[0].id)).then((r) => r.length)
    return {
      tenantId: existing[0].id,
      slug: existing[0].slug,
      adminEmail,
      carrierCount,
      truckCount: 0,
      trailerCount: 0,
      driverCount: 0,
      customerCount: 0,
      loadCount,
      credentials: [{ role: 'Admin', email: adminEmail }],
    }
  }

  const provisioned = await provisionTenant({
    companyName: 'Summit Heavy Logistics',
    admin: { ...adminName, email: adminEmail, password },
    planCode: 'starter',
    locale: 'en',
    ip: SEED_REQUEST_CONTEXT.ipAddress,
    userAgent: SEED_REQUEST_CONTEXT.userAgent,
  })
  const tenantId = provisioned.tenantId
  const adminUserId = provisioned.adminUserId

  // `provisionTenant` (the real public signup path) always leaves the new
  // Admin `pending_verification`, same as tenant A above — stand in for the
  // emailed verification click so the documented demo credentials work
  // immediately, matching every other seeded account's `emailVerifiedAt`.
  await unsafeDb.update(users).set({ status: 'active', emailVerifiedAt: SEED_NOW }).where(eq(users.id, adminUserId))

  // Starter's 14-day trial → `createSubscriptionForTenant` naturally lands the tenant in `trialing`.
  await createSubscriptionForTenant({ tenantId, planCode: 'starter', adminEmail, adminName: `${adminName.firstName} ${adminName.lastName}` })

  const db = tenantDb(tenantId)
  const adminActor = actorFor({ userId: adminUserId, firstName: adminName.firstName, lastName: adminName.lastName, email: adminEmail, locale: 'en' }, tenantId, 'admin')

  // See the matching comment in `tenant-a.ts` — Admin is a MFA-required role
  // and an unenrolled member of one is redirected to `/app/mfa-setup` on
  // every request, so this account needs enrollment to be usable at all.
  await seedMfaFor(adminUserId, adminEmail)

  const credentials: TenantBSummary['credentials'] = [{ role: 'Admin (MFA enrolled)', email: adminEmail }]

  const dispatcherName = seedName(rng)
  const dispatcher = await createSeedUser(tenantId, {
    firstName: 'Elena',
    lastName: 'Cabrera',
    email: 'elena.cabrera@example.com',
    role: 'dispatcher',
    locale: 'es',
    password,
  })
  credentials.push({ role: 'Dispatcher', email: dispatcher.email })
  void dispatcherName

  const accounting = await createSeedUser(tenantId, {
    firstName: 'Trevor',
    lastName: 'Whitmore',
    email: 'trevor.whitmore@example.com',
    role: 'accounting',
    locale: 'en',
    password,
  })
  credentials.push({ role: 'Accounting (no MFA — contrast with tenant A)', email: accounting.email })

  /* ── Carriers: 3 total, including the shared-identity Rivera Transport ── */

  const riveraInput: CreateCarrierInput = {
    legalName: SHARED_CARRIER_NAME,
    dotNumber: SHARED_CARRIER_DOT,
    mcNumber: seedMc(),
    ein: seedEin(),
    contactFirstName: 'Hector',
    contactLastName: 'Rivera',
    email: seedEmail('ops.rivera-summit'),
    phone: seedPhone(),
    preferredLocale: 'es',
    physicalLine1: `${intBetween(rng, 100, 9900)} Border Trade Way`,
    physicalCity: 'Laredo',
    physicalState: 'TX',
    physicalPostalCode: '78045',
    mailingSameAsPhysical: true,
    usesFactoring: false,
    notes: 'Seeded demo carrier — independent record from the tenant A carrier of the same legal name/DOT, demonstrating tenant isolation.',
  }
  const { carrier: rivera } = await createCarrier(db, { userId: adminUserId }, riveraInput)
  await runJobsToCompletion('fmcsa:rivera-summit')

  const coa = await buildSeedPdf('Certificate of Authority', [`Carrier: ${SHARED_CARRIER_NAME}`, `USDOT: ${SHARED_CARRIER_DOT}`])
  await uploadAndApprove(db, adminActor, { ownerType: 'carrier', ownerId: rivera.id, documentType: 'certificate_of_authority', title: 'Certificate of Authority', bytes: coa, expirationDate: daysFromNow(365) })

  const truckVins = [seedVin(2021), seedVin(2022), seedVin(2020)]
  const trailerVins = [seedVin(2019), seedVin(2021), seedVin(2018)]
  const { bytes: coiBytes } = await mockCoiWithVins([...truckVins, ...trailerVins])
  await uploadAndApprove(db, adminActor, { ownerType: 'carrier', ownerId: rivera.id, documentType: 'certificate_of_insurance', title: 'Certificate of Insurance', bytes: Buffer.from(coiBytes), expirationDate: daysFromNow(180) })

  const w9 = await buildSeedPdf('IRS Form W-9', [`Name: ${SHARED_CARRIER_NAME}`])
  await uploadAndApprove(db, adminActor, { ownerType: 'carrier', ownerId: rivera.id, documentType: 'w9', title: 'W-9', bytes: w9 })

  await submitOnboarding(db, { userId: adminUserId }, rivera.id)
  await transitionOnboarding(db, { userId: adminUserId }, rivera.id, 'under_review')

  const riveraVerification = await db.findFirst(fmcsaVerifications, { where: eq(fmcsaVerifications.carrierId, rivera.id) })
  if (riveraVerification) {
    await overrideVerification(db, { userId: adminUserId }, riveraVerification.id, 'Confirmed authority directly with the carrier; DOT not present in the FMCSA mock lookup.')
  }
  await approveOnboarding(db, { userId: adminUserId }, rivera.id)

  const angles = ['front', 'rear', 'driver_side', 'passenger_side'] as const
  const flatbed = await db.findFirst(equipmentTypes, { where: eq(equipmentTypes.code, 'flatbed') })
  const truckIds: string[] = []
  for (let i = 0; i < truckVins.length; i += 1) {
    const truck = await createTruck(db, adminActor, { carrierId: rivera.id, unitNumber: `SUM-TRK-${i + 1}`, vin: truckVins[i]!, make: pick(rng, ['Kenworth', 'Peterbilt', 'International (Navistar)']), registrationExpiresAt: daysFromNow(300) })
    for (const angle of angles) {
      await uploadEquipmentMedia(db, adminActor, { equipmentType: 'truck', equipmentId: truck.id, angle, originalFilename: `${truck.unitNumber}-${angle}.png`, bytes: await buildSeedPhoto(`${truck.unitNumber}-${angle}`) })
    }
    await transitionEquipmentStatus(db, adminActor, { equipmentType: 'truck', equipmentId: truck.id, toStatus: 'active' })
    truckIds.push(truck.id)
  }
  const trailerIds: string[] = []
  for (let i = 0; i < trailerVins.length; i += 1) {
    const trailer = await createTrailer(db, adminActor, { carrierId: rivera.id, unitNumber: `SUM-TRL-${i + 1}`, vin: trailerVins[i]!, equipmentTypeId: flatbed?.id ?? null, lengthInches: 636, widthInches: 102, capacityPounds: 48_000, registrationExpiresAt: daysFromNow(300) })
    for (const angle of angles) {
      await uploadEquipmentMedia(db, adminActor, { equipmentType: 'trailer', equipmentId: trailer.id, angle, originalFilename: `${trailer.unitNumber}-${angle}.png`, bytes: await buildSeedPhoto(`${trailer.unitNumber}-${angle}`) })
    }
    await transitionEquipmentStatus(db, adminActor, { equipmentType: 'trailer', equipmentId: trailer.id, toStatus: 'active' })
    trailerIds.push(trailer.id)
  }

  const driverIds: string[] = []
  for (let i = 0; i < 4; i += 1) {
    const name = seedName(rng)
    const driver = await createDriver(db, adminActor, {
      firstName: name.firstName,
      lastName: name.lastName,
      email: seedEmail(`${name.firstName}.${name.lastName}`),
      phone: seedPhone(),
      preferredLocale: name.locale,
      licenseState: 'TX',
      licenseNumber: seedLicenseNumber('TX'),
      cdlClass: 'A',
      licenseExpiresAt: daysFromNow(600),
      medicalCardExpiresAt: daysFromNow(400),
    })
    const cdl = await buildSeedPdf('Commercial Driver License', [`Driver: ${name.firstName} ${name.lastName}`])
    await uploadAndApprove(db, adminActor, { ownerType: 'driver', ownerId: driver.id, documentType: 'cdl_front', title: 'CDL Front', bytes: cdl })
    await reviewDriverLicense(db, adminActor, { driverId: driver.id, status: 'verified' })
    await addDriverCarrierRelationship(db, { userId: adminUserId }, { driverId: driver.id, carrierId: rivera.id })
    driverIds.push(driver.id)
  }

  const riveraCarrierUser = await createSeedUser(tenantId, {
    firstName: 'Hector',
    lastName: 'Rivera',
    email: 'hector.rivera@example.com',
    role: 'carrier',
    locale: 'es',
    password,
    carrierId: rivera.id,
  })
  credentials.push({ role: 'Carrier portal user (Rivera Transport)', email: riveraCarrierUser.email })

  const riveraDriverUser = await createSeedUser(tenantId, {
    firstName: 'Beto',
    lastName: 'Cantu',
    email: 'beto.cantu@example.com',
    role: 'driver',
    locale: 'es',
    password,
    carrierId: rivera.id,
    driverId: driverIds[0],
  })
  credentials.push({ role: 'Driver portal user', email: riveraDriverUser.email })

  // A second carrier still in draft — the tenant is brand new and mid-onboarding.
  const newHopeInput: CreateCarrierInput = {
    legalName: 'New Hope Flatbed Co',
    dotNumber: seedDot(),
    mcNumber: seedMc(),
    ein: seedEin(),
    contactFirstName: 'Wanda',
    contactLastName: 'Kowalski',
    email: seedEmail('ops.newhope'),
    phone: seedPhone(),
    preferredLocale: 'en',
    mailingSameAsPhysical: true,
    usesFactoring: false,
  }
  const { carrier: newHope } = await createCarrier(db, { userId: adminUserId }, newHopeInput)
  await runJobsToCompletion('fmcsa:newhope')

  // A third carrier, rejected for lost operating authority.
  const { FMCSA_MOCK_DOT_NO_AUTHORITY } = await import('@/integrations/fmcsa/mock-adapter')
  const badActorInput: CreateCarrierInput = {
    legalName: 'Del Rio Cross-Border Freight',
    dotNumber: FMCSA_MOCK_DOT_NO_AUTHORITY,
    mcNumber: seedMc(),
    ein: seedEin(),
    contactFirstName: 'Ray',
    contactLastName: 'Solis',
    email: seedEmail('ops.delrio'),
    phone: seedPhone(),
    preferredLocale: 'en',
    mailingSameAsPhysical: true,
    usesFactoring: false,
  }
  const { carrier: delRio } = await createCarrier(db, { userId: adminUserId }, badActorInput)
  await runJobsToCompletion('fmcsa:delrio')
  const coaDelRio = await buildSeedPdf('Certificate of Authority', [`Carrier: ${delRio.legalName}`])
  await uploadAndApprove(db, adminActor, { ownerType: 'carrier', ownerId: delRio.id, documentType: 'certificate_of_authority', title: 'Certificate of Authority', bytes: coaDelRio })
  const coiDelRio = await buildSeedPdf('Certificate of Insurance', [`Insured: ${delRio.legalName}`])
  await uploadAndApprove(db, adminActor, { ownerType: 'carrier', ownerId: delRio.id, documentType: 'certificate_of_insurance', title: 'Certificate of Insurance', bytes: coiDelRio, expirationDate: daysFromNow(180) })
  const w9DelRio = await buildSeedPdf('IRS Form W-9', [`Name: ${delRio.legalName}`])
  await uploadAndApprove(db, adminActor, { ownerType: 'carrier', ownerId: delRio.id, documentType: 'w9', title: 'W-9', bytes: w9DelRio })
  await submitOnboarding(db, { userId: adminUserId }, delRio.id)
  await transitionOnboarding(db, { userId: adminUserId }, delRio.id, 'under_review')
  await rejectOnboarding(db, { userId: adminUserId }, delRio.id, 'FMCSA reports operating authority revoked for this USDOT number.')

  logStep(`  ↳ 3 carriers created (1 approved+compliant, 1 draft, 1 rejected)`)

  /* ── Customers ────────────────────────────────────────────────────────── */

  const customerNames = ['Rio Bravo Industrial Fabrication', 'Nueces Bay Shipbuilding', 'Sierra Wind Energy Partners', 'Alamo Precast Concrete']
  const customerIds: string[] = []
  for (const name of customerNames) {
    const city = pick(rng, MOCK_CITIES)
    const contact = seedName(rng)
    const result = await createCustomer(db, { userId: adminUserId }, {
      companyName: name,
      phone: seedPhone(),
      email: seedEmail(`accounting.${name.split(' ')[0]}`),
      physicalCity: city.name,
      physicalState: city.state,
      billingSameAsPhysical: true,
      paymentTermsDays: 30,
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
      isPrimary: true,
    })
    await createLocation(db, { userId: adminUserId }, {
      customerId: result.customer.id,
      name: `${name} — Main Yard`,
      city: city.name,
      state: city.state,
      isPrimary: true,
    })
  }

  /* ── Loads: a smaller spread across statuses ─────────────────────────── */

  const targets: Array<'draft' | 'available' | 'assigned' | 'dispatched' | 'delivered' | 'pod_received' | 'invoiced' | 'paid' | 'cancelled'> = [
    'draft', 'available', 'assigned', 'dispatched', 'delivered', 'pod_received', 'invoiced', 'paid', 'paid', 'cancelled',
  ]
  const loadIds: string[] = []
  for (let i = 0; i < targets.length; i += 1) {
    const target = targets[i]!
    const customerId = customerIds[i % customerIds.length]!
    const origin = pick(rng, MOCK_CITIES)
    let dest = pick(rng, MOCK_CITIES)
    while (dest.name === origin.name) dest = pick(rng, MOCK_CITIES)
    const pickupAt = daysAgo(intBetween(rng, 3, 90))
    const deliveryAt = new Date(pickupAt.getTime() + 2 * 86_400_000)

    const carrierGrossRateCents = intBetween(rng, 1_500_00, 4_200_00)
    const { load } = await createLoad(db, { userId: adminUserId, role: 'admin' }, {
      customerId,
      commodity: pick(rng, ['Precast concrete panel', 'Wind turbine nacelle', 'Steel storage tank', 'Shipyard hull section']),
      weightPounds: intBetween(rng, 22_000, 46_000),
      customerChargeCents: carrierGrossRateCents + intBetween(rng, 150_00, 500_00),
      carrierGrossRateCents,
      stops: [
        { stopType: 'pickup', facilityName: 'Shipper Yard', city: origin.name, state: origin.state, appointmentType: 'window', windowStart: pickupAt, windowEnd: new Date(pickupAt.getTime() + 3 * 3_600_000) },
        { stopType: 'delivery', facilityName: 'Consignee', city: dest.name, state: dest.state, appointmentType: 'window', windowStart: deliveryAt, windowEnd: new Date(deliveryAt.getTime() + 4 * 3_600_000) },
      ],
    })
    loadIds.push(load.id)
    if (target === 'draft') continue

    await transitionStatus(db, { userId: adminUserId }, SEED_REQUEST_CONTEXT, { loadId: load.id, to: 'available' })
    if (target === 'available') continue

    await assignCarrier(db, { userId: adminUserId }, { loadId: load.id, carrierId: rivera.id })
    await transitionStatus(db, { userId: adminUserId }, SEED_REQUEST_CONTEXT, { loadId: load.id, to: 'assigned' })

    if (target === 'cancelled') {
      await cancelLoad(db, { userId: adminUserId }, SEED_REQUEST_CONTEXT, load.id, 'Customer rescheduled the production date.')
      continue
    }
    if (target === 'assigned') continue

    const idx = i % truckIds.length
    await assignResources(db, { userId: adminUserId }, { loadId: load.id, truckIds: [truckIds[idx]!], trailerIds: [trailerIds[idx % trailerIds.length]!], driverIds: [driverIds[idx % driverIds.length]!] })
    await transitionStatus(db, { userId: adminUserId }, SEED_REQUEST_CONTEXT, { loadId: load.id, to: 'dispatched' })
    if (target === 'dispatched') continue

    await transitionStatus(db, { userId: adminUserId }, SEED_REQUEST_CONTEXT, { loadId: load.id, to: 'en_route_to_pickup' })
    await transitionStatus(db, { userId: adminUserId }, SEED_REQUEST_CONTEXT, { loadId: load.id, to: 'at_pickup' })
    await transitionStatus(db, { userId: adminUserId }, SEED_REQUEST_CONTEXT, { loadId: load.id, to: 'in_transit' })
    await transitionStatus(db, { userId: adminUserId }, SEED_REQUEST_CONTEXT, { loadId: load.id, to: 'at_delivery' })
    await transitionStatus(db, { userId: adminUserId }, SEED_REQUEST_CONTEXT, { loadId: load.id, to: 'delivered' })
    if (target === 'delivered') continue

    // Uploaded through the real load-document path (`uploadLoadDocument`),
    // which creates the `load_documents` join row in the same transaction —
    // see the identical comment in `tenant-a.ts`.
    const podBytes = await buildSeedPdf('Proof of Delivery', [`Load ${load.loadNumber}`])
    const { document: podDocument } = await uploadLoadDocument(db, adminActor, {
      loadId: load.id,
      documentType: 'pod',
      originalFilename: 'pod.pdf',
      bytes: podBytes,
    })
    await reviewDocument(db, adminActor, { documentId: podDocument.id, status: 'approved' })
    await transitionStatus(db, { userId: adminUserId }, SEED_REQUEST_CONTEXT, { loadId: load.id, to: 'pod_received' })
    await runJobsToCompletion(`invoice-draft-b:${load.loadNumber}`)
    if (target === 'pod_received') continue

    await createDraftInvoiceForLoad(db, load.id).catch(() => null)
    const { invoices } = await import('@/db/schema')
    const invoiceRow = await db.findFirst(invoices, { where: eq(invoices.loadId, load.id) })
    if (!invoiceRow) continue

    const { getDictionary } = await import('@/i18n/dictionary')
    const { createTranslator } = await import('@/i18n/translate')
    const t = createTranslator(await getDictionary('en'), 'en')
    const sent = await sendInvoice(db, adminActor, invoiceRow.id, { tenantName: 'Summit Heavy Logistics', tenantAddressLines: ['900 Border Trade Way, Laredo, TX 78045'], timezone: 'America/Chicago' }, 'en', t)
    await transitionStatus(db, { userId: adminUserId }, SEED_REQUEST_CONTEXT, { loadId: load.id, to: 'invoiced' })
    if (target === 'invoiced') continue

    await recordManualPayment(db, adminActor, { invoiceId: sent.id, amountCents: sent.totalCents, method: 'ach', reference: `ACH-${intBetween(rng, 100000, 999999)}` })
    await transitionStatus(db, { userId: adminUserId }, SEED_REQUEST_CONTEXT, { loadId: load.id, to: 'paid' })
  }

  logStep(`  ↳ ${loadIds.length} loads created`)

  await runJobsToCompletion('final-b')

  void newHope
  void SEED_NOW

  return {
    tenantId,
    slug: provisioned.slug,
    adminEmail,
    carrierCount: 3,
    truckCount: truckIds.length,
    trailerCount: trailerIds.length,
    driverCount: driverIds.length,
    customerCount: customerIds.length,
    loadCount: loadIds.length,
    credentials,
  }
}
