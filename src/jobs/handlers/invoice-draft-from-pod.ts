import 'server-only'
import { z } from 'zod'
import { tenantDb } from '@/db/tenant-db'
import { createDraftInvoiceForLoad } from '@/server/invoices/service'
import { defineJob, type JobContext } from '../registry'

/**
 * Creates the draft invoice for a load that just reached `pod_received`.
 *
 * Enqueued by `src/server/loads/service.ts::transitionStatus` (see that
 * file's comment at the `pod_received` branch) with `dedupeKey:
 * invoice.draft_from_pod:<loadId>`, so this job runs at most once per load
 * from the queue's own guarantee — and `createDraftInvoiceForLoad()` is
 * *itself* idempotent on top of that (a second call for the same load
 * returns the existing invoice), so even a hand-replayed job, or a future
 * second producer, can never create two draft invoices for one load.
 */

const payloadSchema = z.object({ loadId: z.string().uuid() })

export async function createDraftInvoiceFromPod(payload: z.infer<typeof payloadSchema>, ctx: JobContext): Promise<void> {
  if (!ctx.tenantId) throw new Error('invoice.draft_from_pod requires a tenantId')
  const db = tenantDb(ctx.tenantId)
  await createDraftInvoiceForLoad(db, payload.loadId)
}

defineJob('invoice.draft_from_pod', {
  schema: payloadSchema,
  handler: createDraftInvoiceFromPod,
  defaultMaxAttempts: 5,
  description: 'Creates (idempotently) the draft invoice for a load that reached pod_received.',
})
