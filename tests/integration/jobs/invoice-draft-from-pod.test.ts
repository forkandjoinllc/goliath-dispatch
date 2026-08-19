import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { tenantDb } from '@/db/tenant-db'
import { documents, invoices, jobQueue, loadDocuments, loads } from '@/db/schema'
import { transitionStatus } from '@/server/loads/service'
import { createDraftInvoiceFromPod } from '@/jobs/handlers/invoice-draft-from-pod'
import { enqueue } from '@/jobs/queue'
import { drain } from '@/jobs/runner'
import { createTestCarrier, createTestCustomer, createTestLoad, createTestTenant, createTestUser, createTestMembership, minimalStops } from './fixtures'

const request = { ipAddress: null, userAgent: null, requestId: 'test-request' }

describe('invoice draft-from-pod', () => {
  it('calling the job handler twice for the same load yields exactly one invoice', async () => {
    const tenant = await createTestTenant()
    const admin = await createTestUser({ firstName: 'Ada', lastName: 'Admin' })
    await createTestMembership(tenant.id, admin.id, 'admin')
    const db = tenantDb(tenant.id)
    const carrier = await createTestCarrier(db, admin.id)
    const customer = await createTestCustomer(db, { userId: admin.id })

    const { load } = await createTestLoad(
      db,
      { userId: admin.id, role: 'admin' },
      { customerId: customer.id, carrierId: carrier.id, stops: minimalStops() },
    )

    const ctx = { jobId: 'test-job', tenantId: tenant.id, attempt: 1, maxAttempts: 1, workerId: 'test-worker' }

    await createDraftInvoiceFromPod({ loadId: load.id }, ctx)
    await createDraftInvoiceFromPod({ loadId: load.id }, ctx)

    const count = await db.count(invoices, eq(invoices.loadId, load.id))
    expect(count).toBe(1)
  })

  it('a load reaching pod_received enqueues the draft-invoice job exactly once, even if the transition is replayed', async () => {
    const tenant = await createTestTenant()
    const admin = await createTestUser({ firstName: 'Ada', lastName: 'Admin' })
    await createTestMembership(tenant.id, admin.id, 'admin')
    const db = tenantDb(tenant.id)
    const carrier = await createTestCarrier(db, admin.id)
    const customer = await createTestCustomer(db, { userId: admin.id })

    const { load } = await createTestLoad(
      db,
      { userId: admin.id, role: 'admin' },
      { customerId: customer.id, carrierId: carrier.id, stops: minimalStops() },
    )

    // Fast-forward the load to `delivered` directly (the status-machine
    // mechanics up to here belong to the loads agent's own test suite) and
    // attach an approved POD, satisfying `transitionStatus`'s own
    // `hasApprovedPod` gate for the `delivered -> pod_received` move.
    await db.update(loads, load.id, { status: 'delivered', actualDeliveryAt: new Date() })
    const podDocument = await db.insert(documents, {
      documentType: 'pod',
      ownerType: 'load',
      ownerId: load.id,
      reviewStatus: 'approved',
    })
    await db.insert(loadDocuments, { loadId: load.id, documentId: podDocument.id, documentType: 'pod' })

    await transitionStatus(db, { userId: admin.id }, request, { loadId: load.id, to: 'pod_received' })

    const dedupeKey = `invoice.draft_from_pod:${load.id}`
    const jobRows = await db.findMany(jobQueue, { where: eq(jobQueue.dedupeKey, dedupeKey) })
    expect(jobRows).toHaveLength(1)

    // Simulate a duplicate signal for the same transition (e.g. a retried
    // request, or tracking ingestion re-delivering the same status write) by
    // enqueuing again with the identical dedupe key, exactly as
    // `transitionStatus`'s own `pod_received` branch would.
    await enqueue({ tenantId: tenant.id, jobType: 'invoice.draft_from_pod', payload: { loadId: load.id }, dedupeKey })
    const jobRowsAfterReplay = await db.findMany(jobQueue, { where: eq(jobQueue.dedupeKey, dedupeKey) })
    expect(jobRowsAfterReplay).toHaveLength(1)

    const result = await drain({ workerId: 'test-worker', limit: 5, deadlineMs: 5_000 })
    expect(result.succeeded).toBeGreaterThanOrEqual(1)

    const invoiceCount = await db.count(invoices, eq(invoices.loadId, load.id))
    expect(invoiceCount).toBe(1)
  })
})
