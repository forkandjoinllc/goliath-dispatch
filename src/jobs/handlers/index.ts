/**
 * Registers every job type by importing each handler module for its
 * `defineJob(...)` side effect (the same self-registration convention
 * `src/server/invoices/service.ts` already uses for
 * `registerInvoicePaymentEffects`). Importing this module once — from
 * `src/instrumentation.ts` on server start, and from every cron route and
 * the CLI worker, which both import it transitively through `../runner` —
 * is what makes `getJobDefinition()` ever return anything.
 */
import './fmcsa-reverification'
import './document-expiration'
import './notification-delivery'
import './email-send'
import './sms-send'
import './stripe-webhook-process'
import './invoice-overdue'
import './invoice-draft-from-pod'
import './pdf-generation'
import './watermark-generation'
import './ocr-vin-extraction'
import './route-evaluation'
import './tracking-ingest'
import './tracking-link-expiry'
import './retention-archive'
import './retention-purge'
import './report-export'

export { listJobTypes } from '../registry'
