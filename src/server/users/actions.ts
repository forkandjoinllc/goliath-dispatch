'use server'

import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { defineAction } from '@/server/action'
import { tenants, userTenantMemberships, users } from '@/db/schema'
import { emailSchema } from '@/lib/validation'
import { conflict } from '@/lib/errors'
import { normalizeEmail } from '@/lib/utils'
import { issueInvitation, sendInvitationEmail } from '@/server/auth/registration'

const inviteTenantUserInput = z.object({
  email: emailSchema,
  firstName: z.string().trim().min(1, 'validation.required').max(100),
  lastName: z.string().trim().min(1, 'validation.required').max(100),
  role: z.enum(['admin', 'accounting', 'dispatcher']),
})

/**
 * Invites an internal-staff user (Admin, Accounting or Dispatcher) to the
 * acting tenant. Carrier and driver portal invitations go through
 * `drivers/actions.ts` / the carrier onboarding flow instead — this action
 * only ever assigns one of `INTERNAL_ROLES`, enforced by the Zod enum above,
 * so it can never be used to hand out a carrier- or driver-scoped grant.
 */
export const inviteTenantUserAction = defineAction({
  name: 'users.invite',
  permission: 'tenant:user:invite',
  input: inviteTenantUserInput,
  handler: async (input, ctx) => {
    const emailNormalized = normalizeEmail(input.email) ?? ''

    const existingMembership = await ctx.db.builderRequiringExplicitTenantPredicate
      .select({ id: userTenantMemberships.id })
      .from(userTenantMemberships)
      .innerJoin(users, eq(users.id, userTenantMemberships.userId))
      .where(and(eq(userTenantMemberships.tenantId, ctx.db.tenantId), eq(users.emailNormalized, emailNormalized)))
      .limit(1)
      .then((rows) => rows[0] ?? null)
    if (existingMembership) throw conflict('errors.conflict')

    const tenant = await ctx.db.builderRequiringExplicitTenantPredicate
      .select({ displayName: tenants.displayName })
      .from(tenants)
      .where(eq(tenants.id, ctx.actor.tenantId))
      .limit(1)
      .then((rows) => rows[0])

    const token = await issueInvitation(ctx.actor.tenantId, input.email, {
      role: input.role,
      invitedByUserId: ctx.actor.userId,
      firstName: input.firstName,
      lastName: input.lastName,
    })

    await sendInvitationEmail(input.email, token, ctx.actor.locale, {
      inviterName: `${ctx.actor.firstName} ${ctx.actor.lastName}`,
      tenantName: tenant?.displayName ?? '',
      role: input.role,
    })

    return { email: input.email, role: input.role }
  },
  audit: (input, output) => ({
    action: 'role.changed',
    entityType: 'user_tenant_membership',
    entityLabel: output.email,
    metadata: { operation: 'internal_user_invited', role: output.role },
  }),
})
