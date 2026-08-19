import { describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { tenantDb } from '@/db/tenant-db'
import { documents, invoices, jobQueue, loadAssignments, loadDocuments, loads } from '@/db/schema'
import { authorize, can, type Actor } from '@/lib/permissions'
import { sha256Hex } from '@/lib/crypto'
import { getLoadResourceContext } from '@/server/loads/queries'
import { transitionStatus, recordRateConfirmationDecision } from '@/server/loads/service'
import { removeLoadDocument, uploadLoadDocument } from '@/server/loads/documents'
import { reviewDocument } from '@/server/documents/service'
import { createDriver, linkExistingUserToDriver } from '@/server/drivers/service'
import { drain } from '@/jobs/runner'
import {
  createTestCarrier,
  createTestCustomer,
  createTestLoad,
  createTestMembership,
  createTestTenant,
  createTestUser,
} from './fixtures'

const request = { ipAddress: null, userAgent: null, requestId: 'test-request' }

function baseActor(overrides: Partial<Actor>): Actor {
  return {
    userId: 'user-1',
    email: 'actor@example.com',
    firstName: 'Test',
    lastName: 'Actor',
    locale: 'en',
    timezone: 'America/Chicago',
    isPlatformSuperAdmin: false,
    tenantId: null,
    role: null,
    carrierId: null,
    driverId: null,
    assignments: { carrierIds: [], truckIds: [], trailerIds: [], driverIds: [], groupIds: [] },
    overrides: [],
    mfaRequired: false,
    mfaSatisfied: true,
    impersonation: null,
    sessionId: 'session-1',
    ...overrides,
  }
}

/** A tiny, real (non-empty) PDF-flavored buffer — content type sniffing only needs the magic bytes. */
function pdfBytes(label: string): Buffer {
  return Buffer.from(`%PDF-1.4\n% fixture ${label}\n%%EOF`)
}

async function createAssignedDriver(db: ReturnType<typeof tenantDb>, tenant: { id: string }, loadId: string) {
  const driver = await createDriver(
    db,
    { userId: 'seed' },
    { firstName: 'Dana', lastName: 'Driver', preferredLocale: 'en' },
  )
  const driverUser = await createTestUser({ firstName: 'Dana', lastName: 'Driver' })
  // Mirrors the real invitation-acceptance path: the membership starts
  // without a `driverId`, and `linkExistingUserToDriver` sets both it and
  // `drivers.userId` together.
  await createTestMembership(tenant.id, driverUser.id, 'driver')
  await linkExistingUserToDriver(db, { userId: driverUser.id }, { driverId: driver.id, userId: driverUser.id })
  await db.insert(loadAssignments, { loadId, resourceType: 'driver', driverId: driver.id })

  const driverActor = baseActor({
    userId: driverUser.id,
    tenantId: tenant.id,
    role: 'driver',
    driverId: driver.id,
  })
  return { driver, driverUser, driverActor }
}

describe('load documents — upload creates the load_documents join row', () => {
  it('a driver assigned to a load can upload a POD, and the join row exists', async () => {
    const tenant = await createTestTenant()
    const admin = await createTestUser({ firstName: 'Ada', lastName: 'Admin' })
    await createTestMembership(tenant.id, admin.id, 'admin')
    const db = tenantDb(tenant.id)
    const carrier = await createTestCarrier(db, admin.id)
    const customer = await createTestCustomer(db, { userId: admin.id })
    const { load } = await createTestLoad(db, { userId: admin.id, role: 'admin' }, { customerId: customer.id, carrierId: carrier.id })

    const { driverActor } = await createAssignedDriver(db, tenant, load.id)

    const resource = await getLoadResourceContext(db, load.id, driverActor)
    expect(resource.driverId).toBe(driverActor.driverId)
    expect(() => authorize(driverActor, 'load:document:upload', resource)).not.toThrow()

    const uploaded = await uploadLoadDocument(db, driverActor, {
      loadId: load.id,
      documentType: 'pod',
      originalFilename: 'pod.pdf',
      bytes: pdfBytes('pod'),
    })

    expect(uploaded.link.loadId).toBe(load.id)
    expect(uploaded.link.documentId).toBe(uploaded.document.id)
    expect(uploaded.link.documentType).toBe('pod')

    const [linkRow] = await db.findMany(loadDocuments, {
      where: and(eq(loadDocuments.loadId, load.id), eq(loadDocuments.documentId, uploaded.document.id))!,
    })
    expect(linkRow).toBeDefined()
    expect(linkRow?.documentType).toBe('pod')
  })

  it('a driver NOT assigned to the load cannot upload', async () => {
    const tenant = await createTestTenant()
    const admin = await createTestUser({ firstName: 'Ada', lastName: 'Admin' })
    await createTestMembership(tenant.id, admin.id, 'admin')
    const db = tenantDb(tenant.id)
    const carrier = await createTestCarrier(db, admin.id)
    const customer = await createTestCustomer(db, { userId: admin.id })
    const { load } = await createTestLoad(db, { userId: admin.id, role: 'admin' }, { customerId: customer.id, carrierId: carrier.id })

    const unassignedDriverUser = await createTestUser({ firstName: 'Nolan', lastName: 'NotAssigned' })
    const unassignedDriverActor = baseActor({
      userId: unassignedDriverUser.id,
      tenantId: tenant.id,
      role: 'driver',
      driverId: crypto.randomUUID(),
    })

    const resource = await getLoadResourceContext(db, load.id, unassignedDriverActor)
    expect(resource.driverId).toBeUndefined()
    expect(can(unassignedDriverActor, 'load:document:upload', resource).allowed).toBe(false)
    expect(() => authorize(unassignedDriverActor, 'load:document:upload', resource)).toThrow()
  })

  it('a carrier user cannot upload to another carrier\'s load', async () => {
    const tenant = await createTestTenant()
    const admin = await createTestUser({ firstName: 'Ada', lastName: 'Admin' })
    await createTestMembership(tenant.id, admin.id, 'admin')
    const db = tenantDb(tenant.id)
    const ownCarrier = await createTestCarrier(db, admin.id)
    const otherCarrier = await createTestCarrier(db, admin.id)
    const customer = await createTestCustomer(db, { userId: admin.id })
    const { load } = await createTestLoad(db, { userId: admin.id, role: 'admin' }, { customerId: customer.id, carrierId: otherCarrier.id })

    const carrierUser = await createTestUser({ firstName: 'Cara', lastName: 'Carrier' })
    const carrierActor = baseActor({
      userId: carrierUser.id,
      tenantId: tenant.id,
      role: 'carrier',
      carrierId: ownCarrier.id,
    })

    const resource = await getLoadResourceContext(db, load.id, carrierActor)
    expect(resource.carrierId).toBe(otherCarrier.id)
    expect(can(carrierActor, 'load:document:upload', resource).allowed).toBe(false)
    expect(() => authorize(carrierActor, 'load:document:upload', resource)).toThrow()
  })

  it('removing a load document soft-deletes both the join row and the document', async () => {
    const tenant = await createTestTenant()
    const admin = await createTestUser({ firstName: 'Ada', lastName: 'Admin' })
    await createTestMembership(tenant.id, admin.id, 'admin')
    const db = tenantDb(tenant.id)
    const adminActor = baseActor({ userId: admin.id, tenantId: tenant.id, role: 'admin' })
    const carrier = await createTestCarrier(db, admin.id)
    const customer = await createTestCustomer(db, { userId: admin.id })
    const { load } = await createTestLoad(db, { userId: admin.id, role: 'admin' }, { customerId: customer.id, carrierId: carrier.id })

    const uploaded = await uploadLoadDocument(db, adminActor, {
      loadId: load.id,
      documentType: 'bol',
      originalFilename: 'bol.pdf',
      bytes: pdfBytes('bol'),
    })

    await removeLoadDocument(db, adminActor, { loadId: load.id, documentId: uploaded.document.id, reason: 'test cleanup' })

    const link = await db.findById(loadDocuments, uploaded.link.id)
    expect(link?.deletedAt).not.toBeNull()
    const document = await db.findById(documents, uploaded.document.id)
    expect(document?.deletedAt).not.toBeNull()
  })
})

describe('load documents — the pod_received gate requires an approved POD', () => {
  it('an unapproved POD does not permit the transition; an approved one does, enqueues the invoice job, and draining it yields exactly one draft invoice', async () => {
    const tenant = await createTestTenant()
    const admin = await createTestUser({ firstName: 'Ada', lastName: 'Admin' })
    await createTestMembership(tenant.id, admin.id, 'admin')
    const db = tenantDb(tenant.id)
    const adminActor = baseActor({ userId: admin.id, tenantId: tenant.id, role: 'admin' })
    const carrier = await createTestCarrier(db, admin.id)
    const customer = await createTestCustomer(db, { userId: admin.id })
    const { load } = await createTestLoad(db, { userId: admin.id, role: 'admin' }, { customerId: customer.id, carrierId: carrier.id })

    // Fast-forward to `delivered` directly — the status-machine mechanics up
    // to here belong to the loads suite's own tests (see
    // `tests/integration/jobs/invoice-draft-from-pod.test.ts` for the same
    // pattern).
    await db.update(loads, load.id, { status: 'delivered', actualDeliveryAt: new Date() })

    const uploaded = await uploadLoadDocument(db, adminActor, {
      loadId: load.id,
      documentType: 'pod',
      originalFilename: 'pod.pdf',
      bytes: pdfBytes('pod'),
    })

    // Uploaded but not yet approved — the gate must refuse.
    await expect(
      transitionStatus(db, { userId: admin.id }, request, { loadId: load.id, to: 'pod_received' }),
    ).rejects.toMatchObject({ code: 'conflict', messageKey: 'load.errors.podRequired' })

    await reviewDocument(db, adminActor, { documentId: uploaded.document.id, status: 'approved' })

    const updated = await transitionStatus(db, { userId: admin.id }, request, { loadId: load.id, to: 'pod_received' })
    expect(updated.status).toBe('pod_received')

    const dedupeKey = `invoice.draft_from_pod:${load.id}`
    const jobRows = await db.findMany(jobQueue, { where: eq(jobQueue.dedupeKey, dedupeKey) })
    expect(jobRows).toHaveLength(1)

    const result = await drain({ workerId: 'test-worker', limit: 5, deadlineMs: 5_000 })
    expect(result.succeeded).toBeGreaterThanOrEqual(1)

    const invoiceCount = await db.count(invoices, eq(invoices.loadId, load.id))
    expect(invoiceCount).toBe(1)
  })
})

describe('rate confirmation — accept/reject records the real uploaded document', () => {
  it('records the sha256 and version of the actual rate-confirmation document uploaded for the load', async () => {
    const tenant = await createTestTenant()
    const admin = await createTestUser({ firstName: 'Ada', lastName: 'Admin' })
    await createTestMembership(tenant.id, admin.id, 'admin')
    const db = tenantDb(tenant.id)
    const adminActor = baseActor({ userId: admin.id, tenantId: tenant.id, role: 'admin' })
    const carrier = await createTestCarrier(db, admin.id)
    const customer = await createTestCustomer(db, { userId: admin.id })
    const { load } = await createTestLoad(db, { userId: admin.id, role: 'admin' }, { customerId: customer.id, carrierId: carrier.id })

    const rateConfBytes = pdfBytes('rate-confirmation-v1')
    const uploaded = await uploadLoadDocument(db, adminActor, {
      loadId: load.id,
      documentType: 'rate_confirmation',
      originalFilename: 'rate-confirmation.pdf',
      bytes: rateConfBytes,
    })

    expect(uploaded.version.sha256).toBe(sha256Hex(rateConfBytes))

    const carrierUser = await createTestUser({ firstName: 'Cara', lastName: 'Carrier' })
    const decision = await recordRateConfirmationDecision(
      db,
      { userId: carrierUser.id },
      request,
      { loadId: load.id, decision: 'accepted' },
    )

    expect(decision.documentId).toBe(uploaded.document.id)
    expect(decision.documentVersionId).toBe(uploaded.version.id)
    expect(decision.documentSha256).toBe(uploaded.version.sha256)
    expect(decision.documentSha256).toBe(sha256Hex(rateConfBytes))
  })
})
