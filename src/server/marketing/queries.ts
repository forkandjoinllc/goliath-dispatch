import 'server-only'

/**
 * Resolves the contact block (phone, email, address, business hours, social
 * links) the marketing site renders in the header/footer and the Contact
 * page.
 *
 * `tenantSettings` (`src/db/schema/tenant.ts`) already models exactly this
 * data per tenant, for a future white-label marketing site served under a
 * tenant's own domain. Today this app serves a single site — Goliath
 * Dispatch's own platform marketing — with no tenant resolved for the
 * request, so `resolveMarketingContactBlock()` is called with no `tenantId`
 * and returns the platform-level fallback below.
 *
 * When a tenant-aware marketing surface exists, the caller passes a
 * `tenantId` and this function is the one place to extend with a
 * `tenantDb(tenantId).findOne(tenantSettings, …)` lookup, falling back to the
 * same platform block if the tenant has not filled in its own settings yet.
 */

export interface BusinessHoursEntry {
  day: number
  open: string | null
  close: string | null
  closed: boolean
}

export interface MarketingContactBlock {
  companyName: string
  phone: string
  email: string
  supportEmail: string
  addressLine1: string
  addressLine2?: string
  city: string
  state: string
  postalCode: string
  businessHours: BusinessHoursEntry[]
  socialLinks: Record<string, string>
}

/**
 * Platform-level fallback. These are the numbers/addresses for Goliath
 * Dispatch itself (the SaaS vendor), not any tenant's dispatch operation.
 * Sourced from environment variables where available so staging/production
 * can differ without a code change; otherwise a placeholder that is obviously
 * a placeholder, so nobody mistakes it for a real support line.
 */
function platformFallbackContactBlock(): MarketingContactBlock {
  return {
    companyName: 'Goliath Dispatch',
    phone: process.env.MARKETING_CONTACT_PHONE ?? '(800) 555-0142',
    email: process.env.MARKETING_CONTACT_EMAIL ?? 'hello@goliathdispatch.com',
    supportEmail: process.env.MARKETING_SUPPORT_EMAIL ?? 'support@goliathdispatch.com',
    addressLine1: process.env.MARKETING_ADDRESS_LINE1 ?? '1400 Freight Yard Road, Suite 220',
    city: process.env.MARKETING_ADDRESS_CITY ?? 'Fort Worth',
    state: process.env.MARKETING_ADDRESS_STATE ?? 'TX',
    postalCode: process.env.MARKETING_ADDRESS_POSTAL_CODE ?? '76102',
    businessHours: [
      { day: 1, open: '07:00', close: '18:00', closed: false },
      { day: 2, open: '07:00', close: '18:00', closed: false },
      { day: 3, open: '07:00', close: '18:00', closed: false },
      { day: 4, open: '07:00', close: '18:00', closed: false },
      { day: 5, open: '07:00', close: '18:00', closed: false },
      { day: 6, open: null, close: null, closed: true },
      { day: 0, open: null, close: null, closed: true },
    ],
    socialLinks: {
      linkedin: 'https://www.linkedin.com/company/goliath-dispatch',
    },
  }
}

/**
 * `tenantId` is accepted for forward-compatibility but unused today — see the
 * module doc. Passing one currently still returns the platform fallback.
 */
export async function resolveMarketingContactBlock(
  _tenantId?: string | null,
): Promise<MarketingContactBlock> {
  return platformFallbackContactBlock()
}
