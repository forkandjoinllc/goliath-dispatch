import 'server-only'
import { z } from 'zod'
import { tenantDb } from '@/db/tenant-db'
import { centsToDollars } from '@/lib/money'
import { markOverdueInvoices } from '@/server/invoices/service'
import { emitNotification } from '@/server/notifications/dispatch'
import { defineJob, type JobContext } from '../registry'
import { listSweepableTenantIds } from '../tenants'

/**
 * Daily invoice-overdue sweep.
 *
 * `markOverdueInvoices()` is already idempotent — it only ever selects
 * `sent`/`due` invoices whose due date has passed (see
 * `invoices/queries.ts::listOverdueCandidates`), so re-running it the same
 * day, or after a crash mid-sweep, simply finds nothing left to transition
 * on a second pass. `invoice.overdue` is notified exactly once per invoice
 * (`emitNotification`'s own dedupe keyed on event + subject + channel, with
 * no suffix here since an invoice becomes overdue at most once in its
 * lifecycle — it cannot un-overdue and re-overdue the same due date).
 */

const sweepSchema = z.object({}).strict()

export async function runInvoiceOverdueSweep(_payload: z.infer<typeof sweepSchema>, _ctx: JobContext): Promise<void> {
  const now = new Date()
  const tenantIds = await listSweepableTenantIds()

  for (const tenantId of tenantIds) {
    const db = tenantDb(tenantId)
    const transitioned = await markOverdueInvoices(db, now)

    for (const invoice of transitioned) {
      const daysOverdue = invoice.dueDate
        ? Math.max(0, Math.ceil((now.getTime() - invoice.dueDate.getTime()) / 86_400_000))
        : 0

      await emitNotification({
        tenantId,
        eventKey: 'invoice.overdue',
        subject: { type: 'invoice', id: invoice.id },
        tokens: {
          invoiceNumber: invoice.invoiceNumber,
          amount: centsToDollars(invoice.balanceCents).toFixed(2),
          daysOverdue,
        },
        audience: { tenantId, carrierId: invoice.carrierId },
      })
    }
  }
}

defineJob('invoice.overdue_sweep', {
  schema: sweepSchema,
  handler: runInvoiceOverdueSweep,
  defaultMaxAttempts: 3,
  description: 'Daily sweep: transitions sent/due invoices past their due date to overdue and notifies once per invoice.',
})
