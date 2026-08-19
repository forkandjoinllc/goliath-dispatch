'use server'

import { z } from 'zod'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { and, eq, isNull } from 'drizzle-orm'
import { unsafeDb } from '@/db/client'
import { tenantDb } from '@/db/tenant-db'
import { notificationPreferences, notifications, tenants, userTenantMemberships, users } from '@/db/schema'
import { emailSchema, localeSchema, reasonSchema } from '@/lib/validation'
import { passwordSchema } from '@/lib/auth/password'
import { AppError, forbidden, isAppError } from '@/lib/errors'
import { enforceRateLimit, rateLimitPolicies } from '@/lib/rate-limit'
import { getRequestMeta, requireActor, requireTenantActor } from '@/server/context'
import { defineAction, type ActionResult } from '@/server/action'
import { recordAudit } from '@/lib/audit'
import { hashToken } from '@/lib/crypto'
import {
  clearSessionCookie,
  readSessionToken,
  revokeSession,
  setSessionCookie,
  switchActiveTenant,
} from '@/lib/auth/session'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator } from '@/i18n/translate'
import { publicEnv } from '@/lib/env'
import { getEmailProvider, renderEmailShell } from '@/integrations/email'
import type { Actor, Role } from '@/lib/permissions'
import { loginWithPassword, type LoginOutcome } from './login'
import {
  accountLabelFor,
  beginMfaEnrollment,
  confirmMfaEnrollment,
  disableMfa,
  isMfaEnrolled,
  roleRequiresMfa,
  verifyMfaChallenge,
} from './mfa'
import {
  acceptInvitation,
  consumeEmailVerificationToken,
  consumePasswordResetToken,
  issueEmailVerificationToken,
  issuePasswordResetToken,
  readInvitation,
} from './registration'
import { CURRENT_POLICY_VERSIONS, recordConsent, type ConsentType } from './consent'
import { listActiveSessions, revokeOtherSessions, revokeOwnSession } from './sessions'
import { endImpersonation, startImpersonation } from './impersonation'
import { provisionTenant, type ProvisionTenantInput } from '@/server/tenants/provisioning'
import { createSubscriptionForTenant } from '@/server/tenants/subscription'
import { logger } from '@/lib/logger'

/**
 * Server actions.
 *
 * Login, MFA challenge, signup, password reset and invitation acceptance run
 * before an `Actor` exists (or before it is fully authorized), so they cannot
 * use `defineAction` — it requires `requireActor()` to succeed. Each is
 * written out explicitly here, but still performs the same sequence
 * `defineAction` enforces: Zod validation, rate limiting, the operation, and
 * an audit event — nothing here skips a step just because the harness isn't
 * available yet.
 *
 * Actions that need a tenant already selected (switching tenants, tenant-
 * scoped notification preferences) use `defineAction`. Actions that are
 * self-service but must work even for a platform Super Admin with no active
 * tenant (MFA, sessions, sign out, impersonation) call `requireActor()`
 * directly instead, because `defineAction` refuses any actor without a
 * `tenantId`.
 */

async function requestMetaFromHeaders() {
  return getRequestMeta()
}

/** Builds a minimal, fully-typed Actor for audit purposes only, before a real Actor can be resolved. */
function auditSubject(user: { id: string; email: string }, tenantId: string | null, role: Role | null): Actor {
  return {
    userId: user.id,
    email: user.email,
    firstName: '',
    lastName: '',
    locale: 'en',
    timezone: 'UTC',
    isPlatformSuperAdmin: false,
    tenantId,
    role,
    carrierId: null,
    driverId: null,
    assignments: { carrierIds: [], truckIds: [], trailerIds: [], driverIds: [], groupIds: [] },
    overrides: [],
    mfaRequired: false,
    mfaSatisfied: true,
    impersonation: null,
    sessionId: null,
  }
}

function fail(messageKey: string, code: AppError['code'] = 'validation_failed', params?: Record<string, string | number>): ActionResult<never> {
  return { ok: false, error: { code, messageKey, params: params ?? {} } }
}

async function currentLocaleAndOrigin() {
  const h = await headers()
  const pathname = h.get('x-pathname') ?? ''
  const locale = pathname.split('/')[1] === 'es' ? 'es' : 'en'
  const origin = publicEnv.NEXT_PUBLIC_APP_URL
  return { locale: locale as 'en' | 'es', origin }
}

async function sendAuthEmail(input: {
  to: string
  locale: 'en' | 'es'
  subjectKey: string
  bodyKey: string
  params?: Record<string, string | number>
}) {
  const dictionary = await getDictionary(input.locale, ['auth', 'common'])
  const t = createTranslator(dictionary, input.locale)
  const subject = t(input.subjectKey, input.params)
  const bodyText = t(input.bodyKey, input.params)
  const { html, text } = renderEmailShell({
    locale: input.locale,
    branding: { tenantDisplayName: 'Goliath Dispatch' },
    bodyHtml: `<p>${bodyText}</p>`,
    bodyText,
  })
  await getEmailProvider().send({ to: input.to, subject, html, text })
}

/* ── Login ───────────────────────────────────────────────────────────────── */

const loginInputSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'validation.required'),
  remember: z.boolean().optional(),
})

export interface LoginActionOutput {
  status: 'mfa_required' | 'complete'
  redirectTo: string
}

export async function loginAction(raw: unknown): Promise<ActionResult<LoginActionOutput>> {
  const request = await requestMetaFromHeaders()
  const parsed = loginInputSchema.safeParse(raw)
  if (!parsed.success) return fail('errors.validationFailed')
  const { locale } = await currentLocaleAndOrigin()

  const emailKey = parsed.data.email
  const [byEmail, byIp] = await Promise.all([
    enforceRateLimit(rateLimitPolicies.loginByEmail(emailKey), request),
    request.ipAddress
      ? enforceRateLimit(rateLimitPolicies.loginByIp(request.ipAddress), request)
      : Promise.resolve({ allowed: true, remaining: 0, retryAfterSeconds: 0 }),
  ])
  if (!byEmail.allowed || !byIp.allowed) {
    return fail('errors.rateLimited', 'rate_limited')
  }

  let outcome: LoginOutcome
  try {
    outcome = await loginWithPassword(parsed.data, request)
  } catch {
    return fail('errors.internal', 'internal')
  }

  switch (outcome.kind) {
    case 'invalid_credentials':
      return fail('auth.login.invalid')
    case 'locked':
      return fail('auth.login.locked', 'rate_limited', { minutes: outcome.minutesRemaining })
    case 'suspended':
      return fail('auth.login.suspended', 'forbidden')
    case 'unverified': {
      const token = await issueEmailVerificationToken(outcome.userId, outcome.email)
      await sendVerificationEmail(outcome.email, token, locale)
      return fail('auth.login.unverified')
    }
    case 'tenant_suspended':
      return fail('errors.tenantSuspended', 'forbidden')
    case 'success':
      break
  }

  await setSessionCookie(outcome.sessionToken, outcome.sessionExpiresAt)

  await recordAudit(
    auditSubject({ id: outcome.userId, email: parsed.data.email }, outcome.activeTenantId, null),
    request,
    { action: 'auth.login', entityType: 'user', entityId: outcome.userId, tenantId: outcome.activeTenantId },
  )

  const redirectTo = `/${locale}/app`
  return { ok: true, data: { status: outcome.mfaRequired ? 'mfa_required' : 'complete', redirectTo } }
}

async function sendVerificationEmail(email: string, token: string, locale: 'en' | 'es') {
  const { origin } = await currentLocaleAndOrigin()
  const link = `${origin}/${locale}/verify-email/${token}`
  await sendAuthEmail({
    to: email,
    locale,
    subjectKey: 'auth.verify.title',
    // `auth.verify.sent` is the on-screen confirmation and ends the
    // sentence with "{email}." (a literal period right after the
    // interpolated value) — fine for a plain address, but fed the *link*
    // here it glued a trailing "." onto the URL in the actual email body,
    // producing a token every real recipient's click would fail to look up.
    // `emailBody` puts the link last with nothing after it. Same bug/fix
    // shape as `auth.forgot.emailBody` for the password-reset email.
    bodyKey: 'auth.verify.emailBody',
    params: { email: link },
  })
}

/* ── MFA challenge (post-login, pre-full-session) ───────────────────────── */

const mfaChallengeSchema = z.object({
  code: z.string().trim().optional(),
  recoveryCode: z.string().trim().optional(),
})

export async function mfaChallengeAction(raw: unknown): Promise<ActionResult<{ redirectTo: string }>> {
  const request = await requestMetaFromHeaders()
  const parsed = mfaChallengeSchema.safeParse(raw)
  if (!parsed.success) return fail('errors.validationFailed')

  const actor = await requireActor()
  const limited = await enforceRateLimit(rateLimitPolicies.mfaChallenge(actor.userId), request, actor.tenantId)
  if (!limited.allowed) return fail('errors.rateLimited', 'rate_limited')

  if (!actor.sessionId) return fail('errors.unauthenticated', 'unauthenticated')

  const result = await verifyMfaChallenge(actor.userId, actor.sessionId, parsed.data)
  if (!result.ok) {
    await recordAudit(actor, request, {
      action: 'auth.mfa_challenge_failed',
      entityType: 'user',
      entityId: actor.userId,
      tenantId: actor.tenantId,
    })
    return fail(result.reasonKey)
  }

  const { locale } = await currentLocaleAndOrigin()
  return { ok: true, data: { redirectTo: `/${locale}/app` } }
}

/* ── Email verification ─────────────────────────────────────────────────── */

const resendSchema = z.object({ email: emailSchema })

export async function resendVerificationEmailAction(raw: unknown): Promise<ActionResult<{ sent: true }>> {
  const request = await requestMetaFromHeaders()
  const parsed = resendSchema.safeParse(raw)
  if (!parsed.success) return fail('errors.validationFailed')
  const { locale } = await currentLocaleAndOrigin()

  const limited = await enforceRateLimit(rateLimitPolicies.emailVerificationResend(parsed.data.email), request)
  if (!limited.allowed) return fail('errors.rateLimited', 'rate_limited')

  const user = await unsafeDb
    .select({ id: users.id, email: users.email, emailVerifiedAt: users.emailVerifiedAt })
    .from(users)
    .where(eq(users.emailNormalized, parsed.data.email))
    .limit(1)
    .then((rows) => rows[0] ?? null)

  // Deliberately silent on a missing/already-verified account: this endpoint
  // must not reveal account existence to an unauthenticated caller.
  if (user && !user.emailVerifiedAt) {
    const token = await issueEmailVerificationToken(user.id, user.email)
    await sendVerificationEmail(user.email, token, locale)
  }

  return { ok: true, data: { sent: true } }
}

export async function verifyEmailAction(token: string): Promise<ActionResult<{ verified: true }>> {
  const request = await requestMetaFromHeaders()
  const result = await consumeEmailVerificationToken(token)
  if (!result.ok) return fail(result.reasonKey)

  await recordAudit(auditSubject({ id: result.userId, email: '' }, null, null), request, {
    action: 'auth.email_verified',
    entityType: 'user',
    entityId: result.userId,
  })
  return { ok: true, data: { verified: true } }
}

/* ── Password reset ─────────────────────────────────────────────────────── */

const forgotPasswordSchema = z.object({ email: emailSchema })

export async function forgotPasswordAction(raw: unknown): Promise<ActionResult<{ sent: true }>> {
  const request = await requestMetaFromHeaders()
  const parsed = forgotPasswordSchema.safeParse(raw)
  if (!parsed.success) return fail('errors.validationFailed')
  const { locale, origin } = await currentLocaleAndOrigin()

  const limited = await enforceRateLimit(rateLimitPolicies.passwordResetRequest(parsed.data.email), request)
  if (!limited.allowed) return fail('errors.rateLimited', 'rate_limited')

  const issued = await issuePasswordResetToken(parsed.data.email)
  // Same response whether or not the account exists — the copy in
  // auth.forgot.sent is deliberately non-committal for exactly this reason.
  if (issued) {
    const link = `${origin}/${locale}/reset-password/${issued.token}`
    await sendAuthEmail({
      to: parsed.data.email,
      locale,
      subjectKey: 'auth.forgot.title',
      // Deliberately a distinct key from the on-screen `auth.forgot.sent`
      // alert: that key has no `{email}` placeholder (by design — the page
      // must not reveal whether the address has an account), but the
      // emailed copy must actually contain the reset link. Reusing the
      // no-placeholder key here (as this call used to) silently dropped the
      // link from the email entirely, leaving no way to complete a reset.
      bodyKey: 'auth.forgot.emailBody',
      params: { email: link },
    })
    await recordAudit(auditSubject({ id: issued.userId, email: parsed.data.email }, null, null), request, {
      action: 'auth.password_reset_requested',
      entityType: 'user',
      entityId: issued.userId,
    })
  }

  return { ok: true, data: { sent: true } }
}

const resetPasswordSchema = z
  .object({
    token: z.string().min(1),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: 'validation.confirmMismatch',
    path: ['confirmPassword'],
  })

export async function resetPasswordAction(raw: unknown): Promise<ActionResult<{ reset: true }>> {
  const request = await requestMetaFromHeaders()
  const parsed = resetPasswordSchema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, error: { code: 'validation_failed', messageKey: 'errors.validationFailed', params: {} }, fieldErrors: flatten(parsed.error) }
  }

  const limited = await enforceRateLimit(rateLimitPolicies.passwordResetConsume(hashToken(parsed.data.token)), request)
  if (!limited.allowed) return fail('errors.rateLimited', 'rate_limited')

  const result = await consumePasswordResetToken(parsed.data.token, parsed.data.password)
  if (!result.ok) return fail(result.reasonKey)

  await recordAudit(auditSubject({ id: result.userId, email: '' }, null, null), request, {
    action: 'auth.password_reset_completed',
    entityType: 'user',
    entityId: result.userId,
  })

  return { ok: true, data: { reset: true } }
}

/* ── Invitation acceptance ──────────────────────────────────────────────── */

const acceptInvitationSchema = z
  .object({
    token: z.string().min(1),
    firstName: z.string().trim().min(1, 'validation.required').max(100),
    lastName: z.string().trim().min(1, 'validation.required').max(100),
    password: passwordSchema,
    confirmPassword: z.string(),
    locale: localeSchema,
    timezone: z.string().min(1),
    acceptPrivacy: z.literal(true, { errorMap: () => ({ message: 'validation.consentRequired' }) }),
    acceptTerms: z.literal(true, { errorMap: () => ({ message: 'validation.consentRequired' }) }),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: 'validation.confirmMismatch',
    path: ['confirmPassword'],
  })

export async function acceptInvitationAction(raw: unknown): Promise<ActionResult<{ redirectTo: string }>> {
  const request = await requestMetaFromHeaders()
  const parsed = acceptInvitationSchema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, error: { code: 'validation_failed', messageKey: 'errors.validationFailed', params: {} }, fieldErrors: flatten(parsed.error) }
  }

  const limited = await enforceRateLimit(rateLimitPolicies.invitationAcceptance(hashToken(parsed.data.token)), request)
  if (!limited.allowed) return fail('errors.rateLimited', 'rate_limited')

  const invitation = await readInvitation(parsed.data.token)
  if (!invitation.ok) return fail(invitation.reasonKey)

  const result = await acceptInvitation(parsed.data.token, {
    firstName: parsed.data.firstName,
    lastName: parsed.data.lastName,
    password: parsed.data.password,
    locale: parsed.data.locale,
    timezone: parsed.data.timezone,
  })
  if (!result.ok) return fail(result.reasonKey)

  await recordConsent({
    type: 'privacy_policy',
    granted: true,
    locale: parsed.data.locale,
    ipAddress: request.ipAddress,
    userAgent: request.userAgent,
    tenantId: result.tenantId,
    userId: result.userId,
  })
  await recordConsent({
    type: 'terms_and_conditions',
    granted: true,
    locale: parsed.data.locale,
    ipAddress: request.ipAddress,
    userAgent: request.userAgent,
    tenantId: result.tenantId,
    userId: result.userId,
  })

  await recordAudit(auditSubject({ id: result.userId, email: invitation.invitation.email }, result.tenantId, invitation.invitation.role), request, {
    action: 'tenant.updated',
    entityType: 'user_tenant_membership',
    entityId: result.userId,
    tenantId: result.tenantId,
    metadata: { role: invitation.invitation.role },
  })

  const { token, session } = await import('@/lib/auth/session').then((m) =>
    m.createSession({
      userId: result.userId,
      activeTenantId: result.tenantId,
      ipAddress: request.ipAddress,
      userAgent: request.userAgent,
    }),
  )
  await setSessionCookie(token, session.expiresAt)

  return { ok: true, data: { redirectTo: `/${parsed.data.locale}/app` } }
}

/* ── Signup / tenant provisioning ───────────────────────────────────────── */

const signupSchema = z.object({
  companyName: z.string().trim().min(2, 'validation.required').max(200),
  admin: z.object({
    firstName: z.string().trim().min(1, 'validation.required').max(100),
    lastName: z.string().trim().min(1, 'validation.required').max(100),
    email: emailSchema,
    password: passwordSchema,
  }),
  planCode: z.string().min(1),
  locale: localeSchema,
  acceptPrivacy: z.literal(true, { errorMap: () => ({ message: 'validation.consentRequired' }) }),
  acceptTerms: z.literal(true, { errorMap: () => ({ message: 'validation.consentRequired' }) }),
})

export interface SignupActionOutput {
  tenantId: string
  redirectTo: string
}

export async function signupAction(raw: unknown): Promise<ActionResult<SignupActionOutput>> {
  const request = await requestMetaFromHeaders()
  const parsed = signupSchema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, error: { code: 'validation_failed', messageKey: 'errors.validationFailed', params: {} }, fieldErrors: flatten(parsed.error) }
  }

  if (!request.ipAddress) {
    return fail('errors.internal', 'internal')
  }
  const limited = await enforceRateLimit(rateLimitPolicies.signupProvisioning(request.ipAddress), request)
  if (!limited.allowed) return fail('errors.rateLimited', 'rate_limited')

  const input: ProvisionTenantInput = {
    companyName: parsed.data.companyName,
    admin: parsed.data.admin,
    planCode: parsed.data.planCode,
    locale: parsed.data.locale,
    ip: request.ipAddress,
    userAgent: request.userAgent,
  }

  let provisioned
  try {
    provisioned = await provisionTenant(input)
  } catch (error) {
    if (isAppError(error)) return { ok: false, error: error.toClient() }
    return fail('errors.internal', 'internal')
  }

  await recordConsent({
    type: 'privacy_policy',
    granted: true,
    locale: parsed.data.locale,
    ipAddress: request.ipAddress,
    userAgent: request.userAgent,
    tenantId: provisioned.tenantId,
    userId: provisioned.adminUserId,
  })
  await recordConsent({
    type: 'terms_and_conditions',
    granted: true,
    locale: parsed.data.locale,
    ipAddress: request.ipAddress,
    userAgent: request.userAgent,
    tenantId: provisioned.tenantId,
    userId: provisioned.adminUserId,
  })

  await recordAudit(
    auditSubject({ id: provisioned.adminUserId, email: parsed.data.admin.email }, provisioned.tenantId, 'admin'),
    request,
    { action: 'tenant.created', entityType: 'tenant', entityId: provisioned.tenantId, tenantId: provisioned.tenantId },
  )

  const verificationToken = await issueEmailVerificationToken(provisioned.adminUserId, parsed.data.admin.email)
  await sendVerificationEmail(parsed.data.admin.email, verificationToken, parsed.data.locale)

  // Billing is best-effort here: a Stripe outage must not undo a successful
  // signup. A tenant without a subscription row can have this retried.
  try {
    await createSubscriptionForTenant({
      tenantId: provisioned.tenantId,
      planCode: parsed.data.planCode,
      adminEmail: parsed.data.admin.email,
      adminName: `${parsed.data.admin.firstName} ${parsed.data.admin.lastName}`,
    })
  } catch (error) {
    logger.error('Failed to create subscription during signup', { tenantId: provisioned.tenantId, error })
  }

  return {
    ok: true,
    data: {
      tenantId: provisioned.tenantId,
      redirectTo: `/${parsed.data.locale}/signup/success?email=${encodeURIComponent(parsed.data.admin.email)}`,
    },
  }
}

/* ── Sign out ────────────────────────────────────────────────────────────── */

export async function signOutAction(): Promise<void> {
  const request = await requestMetaFromHeaders()
  const token = await readSessionToken()
  const actor = await requireActor().catch(() => null)

  if (token && actor?.sessionId) {
    await revokeSession(actor.sessionId, 'user_signed_out')
    await recordAudit(actor, request, {
      action: 'auth.logout',
      entityType: 'user',
      entityId: actor.userId,
      tenantId: actor.tenantId,
    })
  }
  await clearSessionCookie()
  redirect('/')
}

/* ── MFA self-service ────────────────────────────────────────────────────── */

export async function beginMfaSetupAction(): Promise<ActionResult<{ qrDataUrl: string; otpauthUrl: string; recoveryCodes: string[] }>> {
  const actor = await requireActor()
  const label = await accountLabelFor(actor.userId)
  try {
    const enrollment = await beginMfaEnrollment(actor.userId, label)
    return {
      ok: true,
      data: {
        qrDataUrl: enrollment.qrDataUrl,
        otpauthUrl: enrollment.otpauthUrl,
        recoveryCodes: enrollment.recoveryCodes,
      },
    }
  } catch (error) {
    if (isAppError(error)) return { ok: false, error: error.toClient() }
    return fail('errors.internal', 'internal')
  }
}

const confirmMfaSchema = z.object({ code: z.string().trim().length(6, 'validation.required') })

export async function confirmMfaSetupAction(raw: unknown): Promise<ActionResult<{ enrolled: true }>> {
  const request = await requestMetaFromHeaders()
  const actor = await requireActor()
  const parsed = confirmMfaSchema.safeParse(raw)
  if (!parsed.success) return fail('errors.mfaInvalidCode')

  try {
    await confirmMfaEnrollment(actor.userId, parsed.data.code)
  } catch (error) {
    if (isAppError(error)) return { ok: false, error: error.toClient() }
    return fail('errors.internal', 'internal')
  }

  await recordAudit(actor, request, {
    action: 'auth.mfa_enrolled',
    entityType: 'user',
    entityId: actor.userId,
    tenantId: actor.tenantId,
  })
  return { ok: true, data: { enrolled: true } }
}

export async function disableMfaAction(): Promise<ActionResult<{ disabled: true }>> {
  const request = await requestMetaFromHeaders()
  const actor = await requireActor()

  if (roleRequiresMfa(actor.role)) {
    return fail('errors.forbidden', 'forbidden')
  }

  await disableMfa(actor.userId)
  await recordAudit(actor, request, {
    action: 'permission.changed',
    entityType: 'user',
    entityId: actor.userId,
    tenantId: actor.tenantId,
    metadata: { mfa: 'disabled' },
  })
  return { ok: true, data: { disabled: true } }
}

export async function mfaEnrollmentStatusAction(): Promise<{ enrolled: boolean; required: boolean }> {
  const actor = await requireActor()
  const enrolled = await isMfaEnrolled(actor.userId)
  return { enrolled, required: roleRequiresMfa(actor.role) }
}

/* ── Sessions ────────────────────────────────────────────────────────────── */

export async function listSessionsAction() {
  const actor = await requireActor()
  return listActiveSessions(actor.userId, actor.sessionId)
}

const sessionIdSchema = z.object({ sessionId: z.string().uuid() })

export async function revokeSessionAction(raw: unknown): Promise<ActionResult<{ revoked: true }>> {
  const request = await requestMetaFromHeaders()
  const actor = await requireActor()
  const parsed = sessionIdSchema.safeParse(raw)
  if (!parsed.success) return fail('errors.validationFailed')

  try {
    await revokeOwnSession(actor.userId, parsed.data.sessionId)
  } catch (error) {
    if (isAppError(error)) return { ok: false, error: error.toClient() }
    return fail('errors.internal', 'internal')
  }

  await recordAudit(actor, request, {
    action: 'auth.session_revoked',
    entityType: 'session',
    entityId: parsed.data.sessionId,
    tenantId: actor.tenantId,
  })
  return { ok: true, data: { revoked: true } }
}

export async function revokeOtherSessionsAction(): Promise<ActionResult<{ revokedCount: number }>> {
  const request = await requestMetaFromHeaders()
  const actor = await requireActor()
  if (!actor.sessionId) return fail('errors.unauthenticated', 'unauthenticated')

  const revokedCount = await revokeOtherSessions(actor.userId, actor.sessionId)
  await recordAudit(actor, request, {
    action: 'auth.session_revoked',
    entityType: 'session',
    entityId: actor.userId,
    tenantId: actor.tenantId,
    metadata: { revokedCount, scope: 'other_sessions' },
  })
  return { ok: true, data: { revokedCount } }
}

/* ── Impersonation ───────────────────────────────────────────────────────── */

const startImpersonationSchema = z.object({
  targetUserId: z.string().uuid(),
  tenantId: z.string().uuid(),
  reason: reasonSchema,
})

export async function startImpersonationAction(raw: unknown): Promise<ActionResult<{ started: true }>> {
  const parsed = startImpersonationSchema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, error: { code: 'validation_failed', messageKey: 'errors.validationFailed', params: {} }, fieldErrors: flatten(parsed.error) }
  }
  try {
    await startImpersonation(parsed.data)
  } catch (error) {
    if (isAppError(error)) return { ok: false, error: error.toClient() }
    return fail('errors.internal', 'internal')
  }
  return { ok: true, data: { started: true } }
}

export async function endImpersonationAction(): Promise<ActionResult<{ ended: true }>> {
  try {
    await endImpersonation()
  } catch (error) {
    if (isAppError(error)) return { ok: false, error: error.toClient() }
    return fail('errors.internal', 'internal')
  }
  return { ok: true, data: { ended: true } }
}

/* ── Tenant switching ────────────────────────────────────────────────────── */

const switchTenantSchema = z.object({ tenantId: z.string().uuid() })

export async function switchTenantAction(raw: unknown): Promise<ActionResult<{ switched: true }>> {
  const request = await requestMetaFromHeaders()
  const actor = await requireActor()
  const parsed = switchTenantSchema.safeParse(raw)
  if (!parsed.success) return fail('errors.validationFailed')
  if (!actor.sessionId) return fail('errors.unauthenticated', 'unauthenticated')

  const membership = await unsafeDb
    .select({ id: userTenantMemberships.id })
    .from(userTenantMemberships)
    .where(
      and(
        eq(userTenantMemberships.userId, actor.userId),
        eq(userTenantMemberships.tenantId, parsed.data.tenantId),
        eq(userTenantMemberships.status, 'active'),
        isNull(userTenantMemberships.deletedAt),
      ),
    )
    .limit(1)
    .then((rows) => rows[0] ?? null)

  if (!membership && !actor.isPlatformSuperAdmin) {
    throw forbidden()
  }

  const tenant = await unsafeDb
    .select({ id: tenants.id, status: tenants.status })
    .from(tenants)
    .where(eq(tenants.id, parsed.data.tenantId))
    .limit(1)
    .then((rows) => rows[0] ?? null)
  if (!tenant) return fail('errors.notFound', 'not_found')
  if (tenant.status === 'suspended' || tenant.status === 'cancelled') {
    return fail('errors.tenantSuspended', 'forbidden')
  }

  await switchActiveTenant(actor.sessionId, parsed.data.tenantId)
  await recordAudit(actor, request, {
    action: 'auth.login',
    entityType: 'tenant',
    entityId: parsed.data.tenantId,
    tenantId: parsed.data.tenantId,
    metadata: { via: 'tenant_switch' },
  })
  return { ok: true, data: { switched: true } }
}

/* ── Profile ─────────────────────────────────────────────────────────────── */

const updateProfileSchema = z.object({
  firstName: z.string().trim().min(1, 'validation.required').max(100),
  lastName: z.string().trim().min(1, 'validation.required').max(100),
  phone: z.string().trim().max(32).optional().nullable(),
  locale: localeSchema,
  timezone: z.string().min(1),
})

export async function updateProfileAction(raw: unknown): Promise<ActionResult<{ updated: true }>> {
  const request = await requestMetaFromHeaders()
  const actor = await requireActor()
  const parsed = updateProfileSchema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, error: { code: 'validation_failed', messageKey: 'errors.validationFailed', params: {} }, fieldErrors: flatten(parsed.error) }
  }

  await unsafeDb
    .update(users)
    .set({
      firstName: parsed.data.firstName,
      lastName: parsed.data.lastName,
      phone: parsed.data.phone ?? null,
      locale: parsed.data.locale,
      timezone: parsed.data.timezone,
    })
    .where(eq(users.id, actor.userId))

  await recordAudit(actor, request, {
    action: 'settings.updated',
    entityType: 'user',
    entityId: actor.userId,
    tenantId: actor.tenantId,
  })
  return { ok: true, data: { updated: true } }
}

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'validation.required'),
    newPassword: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: 'validation.confirmMismatch',
    path: ['confirmPassword'],
  })

export async function changePasswordAction(raw: unknown): Promise<ActionResult<{ changed: true }>> {
  const request = await requestMetaFromHeaders()
  const actor = await requireActor()
  const parsed = changePasswordSchema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, error: { code: 'validation_failed', messageKey: 'errors.validationFailed', params: {} }, fieldErrors: flatten(parsed.error) }
  }

  const { verifyPassword } = await import('@/lib/auth/password')
  const { hashPassword } = await import('@/lib/auth/password')
  const user = await unsafeDb.select().from(users).where(eq(users.id, actor.userId)).limit(1).then((r) => r[0])
  const ok = user ? await verifyPassword(parsed.data.currentPassword, user.passwordHash) : false
  if (!ok) {
    return { ok: false, error: { code: 'validation_failed', messageKey: 'errors.validationFailed', params: {} }, fieldErrors: { currentPassword: ['auth.login.invalid'] } }
  }

  const passwordHash = await hashPassword(parsed.data.newPassword)
  await unsafeDb
    .update(users)
    .set({ passwordHash, passwordChangedAt: new Date() })
    .where(eq(users.id, actor.userId))

  if (actor.sessionId) {
    const { revokeAllUserSessions } = await import('@/lib/auth/session')
    await revokeAllUserSessions(actor.userId, 'password_changed', actor.sessionId)
  }

  await recordAudit(actor, request, {
    action: 'auth.password_reset_completed',
    entityType: 'user',
    entityId: actor.userId,
    tenantId: actor.tenantId,
  })
  return { ok: true, data: { changed: true } }
}

/* ── Notification preferences (tenant-bound, uses defineAction) ─────────── */

const updateNotificationPreferenceSchema = z.object({
  eventKey: z.string().min(1),
  inApp: z.boolean(),
  email: z.boolean(),
  sms: z.boolean(),
})

export const updateNotificationPreferenceAction = defineAction({
  name: 'notification.preference.update',
  permission: 'notification:preference:update',
  input: updateNotificationPreferenceSchema,
  resource: (_input, { actor }) => ({ ownerUserId: actor.userId }),
  handler: async (input, ctx) => {
    const existing = await ctx.db.findFirst(notificationPreferences, {
      where: and(eq(notificationPreferences.userId, ctx.actor.userId), eq(notificationPreferences.eventKey, input.eventKey)),
    })
    if (existing) {
      await ctx.db.update(notificationPreferences, existing.id, {
        inApp: input.inApp,
        email: input.email,
        sms: input.sms,
      })
    } else {
      await ctx.db.insert(notificationPreferences, {
        userId: ctx.actor.userId,
        eventKey: input.eventKey,
        inApp: input.inApp,
        email: input.email,
        sms: input.sms,
      })
    }
    return { updated: true as const }
  },
  audit: (input, _output, ctx) => ({
    action: 'settings.updated',
    entityType: 'notification_preference',
    entityId: ctx.actor.userId,
    metadata: { eventKey: input.eventKey },
  }),
})

/* ── In-app notifications ────────────────────────────────────────────────── */

const markNotificationReadSchema = z.object({ notificationId: z.string().uuid() })

/**
 * Manual function rather than `defineAction`: there is no dedicated
 * permission key for "read your own notification" in the shared catalog
 * (`src/lib/permissions/**` is out of scope here), so ownership is enforced
 * directly the same way `revokeOwnSession` enforces it — the `userId` clause
 * in the `updateWhere` predicate below is what makes this safe, not the
 * caller's tenant membership alone.
 */
export async function markNotificationReadAction(raw: unknown): Promise<ActionResult<{ updated: true }>> {
  const actor = await requireTenantActor()
  const parsed = markNotificationReadSchema.safeParse(raw)
  if (!parsed.success) return fail('errors.validationFailed')

  await tenantDb(actor.tenantId).updateWhere(
    notifications,
    and(eq(notifications.id, parsed.data.notificationId), eq(notifications.userId, actor.userId))!,
    { readAt: new Date() },
  )
  return { ok: true, data: { updated: true } }
}

export async function markAllNotificationsReadAction(): Promise<ActionResult<{ updatedCount: number }>> {
  const actor = await requireTenantActor()
  const rows = await tenantDb(actor.tenantId).updateWhere(
    notifications,
    and(eq(notifications.userId, actor.userId), isNull(notifications.readAt))!,
    { readAt: new Date() },
  )
  return { ok: true, data: { updatedCount: rows.length } }
}

/* ── Consent (public, pre-account) ──────────────────────────────────────── */

const recordConsentSchema = z.object({
  type: z.enum(Object.keys(CURRENT_POLICY_VERSIONS) as [ConsentType, ...ConsentType[]]),
  granted: z.boolean(),
  locale: localeSchema,
  subjectEmail: emailSchema.optional(),
})

export async function recordPublicConsentAction(raw: unknown): Promise<ActionResult<{ recorded: true }>> {
  const request = await requestMetaFromHeaders()
  const parsed = recordConsentSchema.safeParse(raw)
  if (!parsed.success) return fail('errors.validationFailed')

  if (request.ipAddress) {
    const limited = await enforceRateLimit(rateLimitPolicies.publicFormSubmission(request.ipAddress), request)
    if (!limited.allowed) return fail('errors.rateLimited', 'rate_limited')
  }

  await recordConsent({
    type: parsed.data.type,
    granted: parsed.data.granted,
    locale: parsed.data.locale,
    ipAddress: request.ipAddress,
    userAgent: request.userAgent,
    subjectEmail: parsed.data.subjectEmail,
  })
  return { ok: true, data: { recorded: true } }
}

/* ── helpers ─────────────────────────────────────────────────────────────── */

function flatten(error: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const issue of error.issues) {
    const path = issue.path.join('.') || '_root'
    ;(out[path] ??= []).push(issue.message)
  }
  return out
}

export { requireTenantActor }
