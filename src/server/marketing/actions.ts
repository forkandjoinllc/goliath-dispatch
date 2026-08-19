'use server'

import { headers } from 'next/headers'
import { enforceRateLimit, rateLimitPolicies } from '@/lib/rate-limit'
import { newId } from '@/lib/crypto'
import type { Locale } from '@/i18n/config'
import {
  carrierSignupFormSchema,
  feetInchesToInches,
  leadFormSchema,
  quoteFormSchema,
  type CarrierSignupFormInput,
  type LeadFormInput,
  type QuoteFormInput,
} from './schema'
import { checkForSpam } from './spam'
import {
  insertConsentRecords,
  insertLead,
  insertQuoteRequest,
} from '@/server/platform/marketing-db'
import { notifyMarketingSubmission } from './notify'
import { PRIVACY_POLICY_VERSION, TERMS_VERSION } from './content'

/**
 * Public 'use server' actions for the marketing site.
 *
 * These deliberately do NOT go through `src/server/action.ts`'s
 * `defineAction` — that harness's first step is `requireActor()`, which
 * throws for every one of these callers by definition (a visitor filling out
 * a contact form has no session). Instead each action re-implements the parts
 * of the harness that still apply to an anonymous submission: Zod validation,
 * spam defenses, rate limiting, persistence and notification. There is no
 * permission check because there is no protected resource being read or
 * mutated — only a new row being created in the caller's own name.
 */

export type PublicActionResult<T> =
  | { ok: true; data: T }
  | {
      ok: false
      error: { code: string; messageKey: string; params?: Record<string, string | number> }
      fieldErrors?: Record<string, string[]>
    }

async function requestMeta(): Promise<{ ipAddress: string | null; userAgent: string | null }> {
  const h = await headers()
  const forwarded = h.get('x-forwarded-for')
  return {
    ipAddress: forwarded?.split(',')[0]?.trim() ?? h.get('x-real-ip') ?? null,
    userAgent: h.get('user-agent'),
  }
}

function flattenIssues(error: { issues: Array<{ path: (string | number)[]; message: string }> }) {
  const out: Record<string, string[]> = {}
  for (const issue of error.issues) {
    const path = issue.path.join('.') || '_root'
    ;(out[path] ??= []).push(issue.message)
  }
  return out
}

async function guardPublicSubmission(input: {
  hpField: string
  renderedAt: number
  ipAddress: string | null
  userAgent: string | null
}): Promise<PublicActionResult<never> | null> {
  const spam = checkForSpam({ hpField: input.hpField, renderedAt: input.renderedAt })
  if (spam.isSpam) {
    // A silent rejection that looks like success is deliberate: telling a bot
    // exactly which check it failed only helps it adapt. Humans practically
    // never trip these checks, so this path costs no real user a clear error.
    return { ok: true, data: undefined as never }
  }

  if (input.ipAddress) {
    const result = await enforceRateLimit(
      rateLimitPolicies.publicFormSubmission(input.ipAddress),
      { ipAddress: input.ipAddress, userAgent: input.userAgent, requestId: newId() },
    )
    if (!result.allowed) {
      return {
        ok: false,
        error: { code: 'rate_limited', messageKey: 'errors.rateLimited', params: {} },
      }
    }
  }

  return null
}

/* ── Lead capture (contact page + inline form) ──────────────────────────── */

export async function submitLeadAction(raw: unknown): Promise<PublicActionResult<{ id: string }>> {
  const parsed = leadFormSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      error: { code: 'validation_failed', messageKey: 'errors.validationFailed', params: {} },
      fieldErrors: flattenIssues(parsed.error),
    }
  }
  const input: LeadFormInput = parsed.data
  const { ipAddress, userAgent } = await requestMeta()

  const guard = await guardPublicSubmission({ hpField: input.hpField, renderedAt: input.renderedAt, ipAddress, userAgent })
  if (guard) return guard as PublicActionResult<{ id: string }>

  const lead = await insertLead({
    tenantId: null,
    firstName: input.firstName,
    lastName: input.lastName,
    email: input.email,
    phone: input.phone ?? null,
    companyName: input.companyName ?? null,
    dotNumber: input.dotNumber ?? null,
    mcNumber: input.mcNumber ?? null,
    message: input.message,
    locale: input.locale,
    source: 'contact_form',
    sourcePath: input.sourcePath ?? null,
    ipAddress,
    userAgent,
  })

  await notifyMarketingSubmission({
    event: 'lead.received',
    tenantId: null,
    subjectId: lead.id,
    subjectType: 'lead',
    params: { name: `${input.firstName} ${input.lastName}`, company: input.companyName ?? '—' },
  })

  return { ok: true, data: { id: lead.id } }
}

/* ── Quote request ───────────────────────────────────────────────────────── */

export async function submitQuoteRequestAction(
  raw: unknown,
): Promise<PublicActionResult<{ id: string }>> {
  const parsed = quoteFormSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      error: { code: 'validation_failed', messageKey: 'errors.validationFailed', params: {} },
      fieldErrors: flattenIssues(parsed.error),
    }
  }
  const input: QuoteFormInput = parsed.data
  const { ipAddress, userAgent } = await requestMeta()

  const guard = await guardPublicSubmission({ hpField: input.hpField, renderedAt: input.renderedAt, ipAddress, userAgent })
  if (guard) return guard as PublicActionResult<{ id: string }>

  const [firstName, ...restName] = input.contactName.trim().split(/\s+/)
  const lead = await insertLead({
    tenantId: null,
    firstName: firstName || input.contactName,
    lastName: restName.join(' ') || '—',
    email: input.email,
    phone: input.phone ?? null,
    companyName: input.companyName ?? null,
    dotNumber: null,
    mcNumber: null,
    message: input.notes ?? null,
    locale: input.locale,
    source: 'quote_request',
    sourcePath: '/quote',
    ipAddress,
    userAgent,
  })

  const quote = await insertQuoteRequest({
    tenantId: null,
    leadId: lead.id,
    contactName: input.contactName,
    email: input.email,
    phone: input.phone ?? null,
    companyName: input.companyName ?? null,
    commodity: input.commodity,
    weightPounds: input.weightPounds,
    lengthInches: feetInchesToInches(input.length),
    widthInches: feetInchesToInches(input.width),
    heightInches: feetInchesToInches(input.height),
    originCity: input.originCity,
    originState: input.originState,
    destinationCity: input.destinationCity,
    destinationState: input.destinationState,
    readyDate: input.readyDate ?? null,
    equipmentPreference: input.equipmentPreference ?? null,
    isOversizeSuspected: input.isOversizeSuspected,
    notes: input.notes ?? null,
    locale: input.locale,
    ipAddress,
    userAgent,
  })

  await notifyMarketingSubmission({
    event: 'quote_request.received',
    tenantId: null,
    subjectId: quote.id,
    subjectType: 'quote_request',
    params: {
      name: input.contactName,
      origin: `${input.originCity}, ${input.originState}`,
      destination: `${input.destinationCity}, ${input.destinationState}`,
    },
  })

  return { ok: true, data: { id: quote.id } }
}

/* ── Carrier signup ──────────────────────────────────────────────────────── */

/**
 * The public entry point for a carrier expressing interest in joining a
 * tenant's operation. `src/server/carriers` (owned by another agent) exposes
 * no public/unauthenticated entry point — `createCarrier` is a
 * `defineAction`-wrapped mutation that requires an authenticated Admin/
 * Dispatcher Actor with `carrier:create`, which a public visitor is not and
 * should not become just by filling out this form. So this action persists a
 * `leads` row with `source='carrier_signup'`, carrying the full structured
 * payload in `message` as JSON (the `leads` schema has no generic payload
 * column) plus the fields it does have — email, phone, company, DOT, MC —
 * populated directly so the row is filterable/searchable without parsing
 * JSON. The carrier-onboarding team's queue is expected to read this `source`
 * and turn it into a real carrier + onboarding record; see the final report
 * for this note surfaced to that agent.
 */
export async function submitCarrierSignupAction(
  raw: unknown,
): Promise<PublicActionResult<{ id: string }>> {
  const parsed = carrierSignupFormSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      error: { code: 'validation_failed', messageKey: 'errors.validationFailed', params: {} },
      fieldErrors: flattenIssues(parsed.error),
    }
  }
  const input: CarrierSignupFormInput = parsed.data
  const { ipAddress, userAgent } = await requestMeta()

  const guard = await guardPublicSubmission({ hpField: input.hpField, renderedAt: input.renderedAt, ipAddress, userAgent })
  if (guard) return guard as PublicActionResult<{ id: string }>

  const mailingAddress = input.mailingSameAsPhysical ? input.physicalAddress : input.mailingAddress

  const structuredPayload = {
    legalName: input.legalName,
    dba: input.dba ?? null,
    contactFirstName: input.contactFirstName,
    contactLastName: input.contactLastName,
    email: input.email,
    phone: input.phone,
    dotNumber: input.dotNumber,
    mcNumber: input.mcNumber ?? null,
    ein: input.ein ?? null,
    physicalAddress: input.physicalAddress,
    mailingAddress,
    website: input.website || null,
    preferredLocale: input.preferredLocale,
    factoringApplies: input.factoringApplies,
  }

  const lead = await insertLead({
    tenantId: null,
    firstName: input.contactFirstName,
    lastName: input.contactLastName,
    email: input.email,
    phone: input.phone,
    companyName: input.dba || input.legalName,
    dotNumber: input.dotNumber,
    mcNumber: input.mcNumber ?? null,
    message: JSON.stringify(structuredPayload),
    locale: input.preferredLocale,
    source: 'carrier_signup',
    sourcePath: '/carrier-signup',
    ipAddress,
    userAgent,
  })

  const consentLocale: Locale = input.preferredLocale
  await insertConsentRecords([
    {
      tenantId: null,
      subjectEmail: input.email,
      consentType: 'privacy_policy',
      policyVersion: PRIVACY_POLICY_VERSION,
      locale: consentLocale,
      ipAddress,
      userAgent,
    },
    {
      tenantId: null,
      subjectEmail: input.email,
      consentType: 'terms_and_conditions',
      policyVersion: TERMS_VERSION,
      locale: consentLocale,
      ipAddress,
      userAgent,
    },
  ])

  await notifyMarketingSubmission({
    event: 'carrier_signup.received',
    tenantId: null,
    subjectId: lead.id,
    subjectType: 'lead',
    params: { name: input.legalName, dot: input.dotNumber },
  })

  return { ok: true, data: { id: lead.id } }
}
