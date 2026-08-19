import type { Locator, Page } from '@playwright/test'
import { expect } from '@playwright/test'
import { format } from 'date-fns'
import { waitForHydration } from './wait'
import { expectToast } from './toast'
import { uploadFixture, type FixtureFile } from './upload'

export interface StopInput {
  stopType: 'pickup' | 'delivery'
  facilityName: string
  line1: string
  city: string
  state: string
  postalCode: string
  appointmentType?: 'exact' | 'window' | 'fcfs' | 'open'
  windowStart?: Date
  windowEnd?: Date
}

export interface CreateLoadOptions {
  customerName: string
  customerReference?: string
  /**
   * The wizard always seeds exactly one pickup (index 0) and one delivery
   * (index 1) — pass at least those two. Any stop beyond index 1 is appended
   * first via the "Add pickup"/"Add delivery" toolbar buttons (multi-stop
   * loads), matching how a dispatcher would actually build one.
   */
  stops: StopInput[]
  commodity?: string
  /**
   * Left unset by every caller that doesn't care about money — the wizard's
   * financials step is entirely optional, and a load with no rate entered
   * still creates a valid draft invoice, just a $0 one (`dispatchFeeAmountCents`
   * comes out to 0). Flows exercising invoicing/settlements need a non-zero
   * `carrierGrossRateCents` and `carrierDispatchFeeBps` for the drafted
   * invoice/settlement to have a non-zero amount worth asserting on.
   */
  financials?: {
    customerChargeDollars?: number
    carrierGrossRateDollars?: number
    carrierDispatchFeePercent?: number
  }
}

/**
 * Drives the `DateTimePicker` (`src/components/ui/date-time-picker.tsx`) —
 * a custom popover calendar, not a native `<input type="datetime-local">`.
 * `date` must not be today (its grid cell's accessible name gains a
 * "(Today)" suffix this helper doesn't attempt to match) — every caller in
 * this suite picks a few days out, which every appointment window
 * realistically would anyway.
 */
async function fillDateTimeField(page: Page, scope: Locator, label: string, date: Date): Promise<void> {
  await scope.getByLabel(label, { exact: true }).click()
  const dayLabel = format(date, 'PPPP')
  await page.getByRole('gridcell', { name: dayLabel, exact: true }).click()
  const timeInput = page.locator('input[type="time"]')
  await timeInput.fill(format(date, 'HH:mm'))
  // Radix's Popover closes on an outside click; pressing Escape is the
  // keyboard-accessible equivalent and doesn't depend on nothing else on
  // the page intercepting a stray click. Wait for the portal-rendered
  // content to actually unmount — otherwise a second date field filled
  // right after (e.g. this stop's "Window end" following its "Window
  // start") can open a calendar showing the *same* day-of-month on the
  // same visible month while the first popover's grid is still mid-close,
  // and `getByRole('gridcell', ...)` resolves to two elements.
  await page.keyboard.press('Escape')
  await expect(timeInput).toHaveCount(0)
}

async function selectComboboxOption(scope: Locator, page: Page, name: string, optionName: string | RegExp): Promise<void> {
  await scope.getByRole('combobox', { name, exact: true }).click()
  await page.getByRole('option', { name: optionName, exact: true }).click()
}

async function fillStop(page: Page, index: number, stop: StopInput): Promise<void> {
  const scope = page.getByTestId(`load-stop-${index}`)
  await selectComboboxOption(scope, page, 'Type', stop.stopType === 'pickup' ? 'Pickup' : 'Delivery')
  await page.locator(`input[name="stops.${index}.facilityName"]`).fill(stop.facilityName)
  await page.locator(`input[name="stops.${index}.address.line1"]`).fill(stop.line1)
  await page.locator(`input[name="stops.${index}.address.city"]`).fill(stop.city)
  await selectComboboxOption(scope, page, 'State', stop.state)
  await page.locator(`input[name="stops.${index}.address.postalCode"]`).fill(stop.postalCode)

  if (stop.appointmentType) {
    const label: Record<NonNullable<StopInput['appointmentType']>, string> = {
      exact: 'Exact appointment',
      window: 'Appointment window',
      fcfs: 'First come, first served',
      open: 'Open / no appointment',
    }
    await selectComboboxOption(scope, page, 'Appointment type', label[stop.appointmentType])
  }
  if (stop.windowStart) await fillDateTimeField(page, scope, 'Window start', stop.windowStart)
  if (stop.windowEnd) await fillDateTimeField(page, scope, 'Window end', stop.windowEnd)
}

/**
 * Drives the full 6-step "New load" wizard (customer → stops → freight →
 * equipment → financials → review) to a real submit and returns the
 * resulting load's id. Requires the currently logged-in actor to already
 * hold `load:create` (Admin/Dispatcher).
 */
export async function createLoad(page: Page, opts: CreateLoadOptions): Promise<string> {
  await page.goto('/en/app/loads/new')
  await waitForHydration(page)

  // ── Step 1: customer ──
  const customerSearch = page.locator('#load-customer-search')
  await customerSearch.fill(opts.customerName.slice(0, Math.max(3, opts.customerName.length)))
  await page.getByRole('option', { name: opts.customerName, exact: true }).click()
  if (opts.customerReference) {
    await page.locator('input[name="customerReference"]').fill(opts.customerReference)
  }
  await page.getByRole('button', { name: /^next$/i }).click()

  // ── Step 2: stops ──
  for (let i = 2; i < opts.stops.length; i++) {
    const stopType = opts.stops[i]!.stopType
    await page.getByRole('button', { name: stopType === 'pickup' ? /^pickup$/i : /^delivery$/i }).click()
  }
  for (let i = 0; i < opts.stops.length; i++) {
    await fillStop(page, i, opts.stops[i]!)
  }
  await page.getByRole('button', { name: /^next$/i }).click()

  // ── Step 3: freight ──
  if (opts.commodity) await page.locator('input[name="commodity"]').fill(opts.commodity)
  await page.getByRole('button', { name: /^next$/i }).click()

  // ── Step 4: equipment ──
  await page.getByRole('combobox', { name: 'Equipment type', exact: true }).click()
  await page.getByRole('option').first().click()
  await page.getByRole('button', { name: /^next$/i }).click()

  // ── Step 5: financials ── (all optional; left blank unless requested)
  if (opts.financials?.customerChargeDollars !== undefined) {
    await page.getByLabel('Customer charge', { exact: true }).fill(opts.financials.customerChargeDollars.toFixed(2))
  }
  if (opts.financials?.carrierGrossRateDollars !== undefined) {
    await page.getByLabel('Carrier gross rate', { exact: true }).fill(opts.financials.carrierGrossRateDollars.toFixed(2))
  }
  if (opts.financials?.carrierDispatchFeePercent !== undefined) {
    await page.getByLabel('Carrier dispatch fee', { exact: true }).fill(String(opts.financials.carrierDispatchFeePercent))
  }
  await page.getByRole('button', { name: /^next$/i }).click()

  // ── Step 6: review — submit ──
  await page.getByRole('button', { name: /^create load$/i }).click()
  await expect(page).toHaveURL(/\/app\/loads\/[0-9a-f-]+/, { timeout: 15_000 })
  return page.url().match(/loads\/([0-9a-f-]+)/)![1]!
}

/**
 * Assigns `carrierName` to a load through the Assignments tab's carrier
 * combobox. Not `exact` matched — the option's accessible name concatenates
 * the carrier's legal name with a `DOT {number}` description sub-line
 * (`AssignCarrierPanel`), so an exact match against just the legal name
 * never resolves.
 */
export async function assignCarrier(page: Page, loadId: string, carrierName: string): Promise<void> {
  await page.goto(`/en/app/loads/${loadId}`)
  await waitForHydration(page)
  await page.getByRole('tab', { name: /assignments/i }).click()
  await page.getByPlaceholder('Carrier').fill(carrierName.slice(0, 12))
  await page.getByRole('option', { name: carrierName }).click()
  await page.getByRole('button', { name: /^assign carrier$/i }).click()
  await expectToast(page, /^assign carrier$/i)
}

// The human-readable label `LoadStatusActions` shows for each `LoadStatus`
// (`nav.status.load.*`) — both the dropdown's own option text and the
// success toast title come from this same translation key, so option
// selection and toast confirmation share this one map.
const LOAD_STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  available: 'Available',
  assigned: 'Assigned',
  dispatched: 'Dispatched',
  en_route_to_pickup: 'En route to pickup',
  at_pickup: 'At pickup',
  in_transit: 'In transit',
  at_delivery: 'At delivery',
  delivered: 'Delivered',
  pod_received: 'POD received',
  invoiced: 'Invoiced',
  paid: 'Paid',
  cancelled: 'Cancelled',
}

/**
 * Walks `LoadStatusActions`' single "Change status" dropdown through each
 * status in `path`, in order, expecting a real success toast at every step
 * — one server-validated transition per call, exactly as a dispatcher
 * clicking through the UI would drive it (no shortcut through more than one
 * edge of `LOAD_STATUS_TRANSITIONS` at a time).
 */
export async function advanceLoadStatus(page: Page, loadId: string, path: string[]): Promise<void> {
  for (const status of path) {
    const label = LOAD_STATUS_LABEL[status]
    if (!label) throw new Error(`No known UI label for load status "${status}"`)
    await page.goto(`/en/app/loads/${loadId}`)
    await waitForHydration(page)
    await page.getByRole('combobox', { name: /change status/i }).click()
    await page.getByRole('option', { name: label, exact: true }).click()
    await expectToast(page, new RegExp(`^${label}$`, 'i'))
  }
}

/**
 * Opens the "Assign resources" dialog on a load's Assignments tab, checks
 * the candidate row matching `matchText` (a unit number or driver name),
 * and confirms. Assumes a carrier is already assigned (the dialog refuses
 * to list candidates otherwise) and that the candidate is not blocked.
 */
export async function assignResource(page: Page, loadId: string, matchText: string): Promise<void> {
  await page.goto(`/en/app/loads/${loadId}`)
  await waitForHydration(page)
  await page.getByRole('tab', { name: /assignments/i }).click()
  await page.getByRole('button', { name: /^assign resources$/i }).click()
  const dialog = page.getByRole('dialog')
  const row = dialog.locator('li').filter({ has: page.getByRole('checkbox') }).filter({ hasText: matchText })
  await expect(row).toBeVisible({ timeout: 10_000 })
  await row.getByRole('checkbox').check()
  await dialog.getByRole('button', { name: /^assign selected$/i }).click()
  await expect(dialog).not.toBeVisible({ timeout: 10_000 })
}

const LOAD_DOCUMENT_TYPE_LABEL: Record<string, RegExp> = {
  bol: /^bill of lading$/i,
  pod: /^proof of delivery$/i,
  rate_confirmation: /^rate confirmation$/i,
  receipt: /^receipt$/i,
  permit: /^permit$/i,
  escort_document: /escort document/i,
  route_survey: /route survey/i,
  invoice: /^invoice$/i,
  lumper_receipt: /lumper receipt/i,
  scale_ticket: /scale ticket/i,
  other: /^other$/i,
}

/**
 * Uploads a document of `documentType` onto a load's Documents tab (the
 * load-specific `UploadDialog` in `documents-tab.tsx` — a different
 * component from the carrier-detail Documents tab's dialog, with different
 * element ids, hence its own small helper here rather than reuse of
 * `support/carrier.ts`'s `uploadCarrierDocument`).
 */
export async function uploadLoadDocument(
  page: Page,
  loadId: string,
  documentType: keyof typeof LOAD_DOCUMENT_TYPE_LABEL,
  fixture: FixtureFile = 'sample.pdf',
): Promise<void> {
  await page.goto(`/en/app/loads/${loadId}`)
  await waitForHydration(page)
  await page.getByRole('tab', { name: /documents/i }).click()
  await page.getByRole('button', { name: /^upload document$/i }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('combobox').click()
  await page.getByRole('option', { name: LOAD_DOCUMENT_TYPE_LABEL[documentType] }).click()
  await uploadFixture(dialog.locator('input[type="file"]'), fixture)
  // A native `<input type="file">` exposes an implicit ARIA role of
  // "button" (with its associated `<label>` as the accessible name) — the
  // file input itself (labeled "Upload") and the dialog's actual submit
  // button (also labeled "Upload") both match `getByRole('button', {name:
  // /^upload$/i})`, in that DOM order, so `.last()` is the real button.
  await dialog.getByRole('button', { name: /^upload$/i }).last().click()
  await expectToast(page, /^upload document$/i)
}
