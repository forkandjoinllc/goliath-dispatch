import 'server-only'
import { and, desc, eq, ilike, inArray, ne, or, type SQL } from 'drizzle-orm'
import type { TenantDb } from '@/db/tenant-db'
import {
  customerContacts,
  customerLocations,
  customers,
  invoices,
  loads,
  type Customer,
  type CustomerContact,
  type CustomerLocation,
  type Invoice,
  type Load,
} from '@/db/schema'
import type { ScopeFilter } from '@/lib/permissions/check'
import type { Pagination } from '@/lib/validation'

/**
 * Read models for the customer domain.
 *
 * Customers are tenant-shared (see `docs/architecture.md` §4 and
 * `catalog.ts` — every role that can read customers holds the `tenant`
 * scope), so `scopeClause` only ever narrows to the tenant boundary
 * `TenantDb` already applies; it exists for symmetry with the carrier and
 * equipment read models and so a future narrower scope has one place to land.
 */
function scopeClause(scope: ScopeFilter): SQL | 'empty' | undefined {
  switch (scope.kind) {
    case 'platform':
    case 'tenant':
    case 'assigned':
      return undefined
    case 'carrier':
    case 'own':
    default:
      return 'empty'
  }
}

export interface ListCustomersOptions {
  status?: Customer['status']
  search?: string
  pagination?: Pagination
}

export interface ListCustomersResult {
  customers: Customer[]
  total: number
}

export async function listCustomers(
  db: TenantDb,
  scope: ScopeFilter,
  options: ListCustomersOptions = {},
): Promise<ListCustomersResult> {
  const scoped = scopeClause(scope)
  if (scoped === 'empty') return { customers: [], total: 0 }

  const clauses: SQL[] = []
  if (scoped) clauses.push(scoped)
  if (options.status) clauses.push(eq(customers.status, options.status))
  if (options.search) {
    clauses.push(
      or(
        ilike(customers.companyName, `%${options.search}%`),
        ilike(customers.dotNumber, `%${options.search}%`),
        ilike(customers.mcNumber, `%${options.search}%`),
        ilike(customers.email, `%${options.search}%`),
      )!,
    )
  }

  const where = clauses.length > 0 ? and(...clauses) : undefined
  const pagination = options.pagination ?? { page: 1, pageSize: 25 }

  const [rows, total] = await Promise.all([
    db.findMany(customers, {
      where,
      orderBy: desc(customers.createdAt),
      limit: pagination.pageSize,
      offset: (pagination.page - 1) * pagination.pageSize,
    }),
    db.count(customers, where),
  ])

  return { customers: rows, total }
}

export async function getCustomer(db: TenantDb, customerId: string): Promise<Customer> {
  return db.requireById(customers, customerId, 'customer')
}

export interface ReceivablesSummary {
  openInvoiceCount: number
  openBalanceCents: number
  overdueInvoiceCount: number
  overdueBalanceCents: number
}

const OPEN_INVOICE_STATUSES = new Set(['sent', 'due', 'overdue', 'disputed'])

function summarizeReceivables(invoiceRows: Invoice[]): ReceivablesSummary {
  const summary: ReceivablesSummary = {
    openInvoiceCount: 0,
    openBalanceCents: 0,
    overdueInvoiceCount: 0,
    overdueBalanceCents: 0,
  }
  for (const invoice of invoiceRows) {
    if (!OPEN_INVOICE_STATUSES.has(invoice.status)) continue
    summary.openInvoiceCount += 1
    summary.openBalanceCents += invoice.balanceCents
    if (invoice.status === 'overdue') {
      summary.overdueInvoiceCount += 1
      summary.overdueBalanceCents += invoice.balanceCents
    }
  }
  return summary
}

export interface CustomerDetail {
  customer: Customer
  contacts: CustomerContact[]
  locations: CustomerLocation[]
  recentLoads: Load[]
  receivables: ReceivablesSummary
}

export async function getCustomerDetail(db: TenantDb, customerId: string): Promise<CustomerDetail> {
  const customer = await db.requireById(customers, customerId, 'customer')

  const [contacts, locations, recentLoads, invoiceRows] = await Promise.all([
    db.findMany(customerContacts, {
      where: eq(customerContacts.customerId, customerId),
      orderBy: [desc(customerContacts.isPrimary), desc(customerContacts.createdAt)],
    }),
    db.findMany(customerLocations, {
      where: eq(customerLocations.customerId, customerId),
      orderBy: [desc(customerLocations.isPrimary), desc(customerLocations.createdAt)],
    }),
    db.findMany(loads, {
      where: eq(loads.customerId, customerId),
      orderBy: desc(loads.createdAt),
      limit: 10,
    }),
    db.findMany(invoices, { where: eq(invoices.customerId, customerId) }),
  ])

  return { customer, contacts, locations, recentLoads, receivables: summarizeReceivables(invoiceRows) }
}

/* ── Autocomplete ────────────────────────────────────────────────────────── */

export interface CustomerAutocompleteResult {
  id: string
  companyName: string
  primaryContact: { id: string; name: string; email: string | null; phone: string | null } | null
  defaultLocation: { id: string; name: string; city: string | null; state: string | null } | null
}

/**
 * Server-side debounced autocomplete for the load form's customer picker.
 * Bounded to 10 rows and only queried once the caller has at least two
 * characters — the debounce itself is the caller's job (the combobox
 * component already debounces keystrokes before calling the server action).
 */
export async function customerAutocomplete(db: TenantDb, query: string): Promise<CustomerAutocompleteResult[]> {
  const trimmed = query.trim()
  if (trimmed.length < 2) return []

  const rows = await db.findMany(customers, {
    where: and(ne(customers.status, 'inactive'), ilike(customers.companyName, `%${trimmed}%`))!,
    orderBy: desc(customers.companyName),
    limit: 10,
  })
  if (rows.length === 0) return []

  const customerIds = rows.map((c) => c.id)
  const [contacts, locations] = await Promise.all([
    db.findMany(customerContacts, {
      where: and(inArray(customerContacts.customerId, customerIds), eq(customerContacts.isPrimary, true))!,
    }),
    db.findMany(customerLocations, {
      where: and(inArray(customerLocations.customerId, customerIds), eq(customerLocations.isPrimary, true))!,
    }),
  ])
  const contactByCustomer = new Map(contacts.map((c) => [c.customerId, c]))
  const locationByCustomer = new Map(locations.map((l) => [l.customerId, l]))

  return rows.map((customer) => {
    const contact = contactByCustomer.get(customer.id)
    const location = locationByCustomer.get(customer.id)
    return {
      id: customer.id,
      companyName: customer.companyName,
      primaryContact: contact
        ? { id: contact.id, name: `${contact.firstName} ${contact.lastName}`.trim(), email: contact.email, phone: contact.phone }
        : null,
      defaultLocation: location ? { id: location.id, name: location.name, city: location.city, state: location.state } : null,
    }
  })
}
