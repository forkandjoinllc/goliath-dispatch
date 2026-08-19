import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { and, desc, eq, gt, isNull } from 'drizzle-orm'
import * as schema from '@/db/schema'
import { decryptField } from '@/lib/crypto'
import { E2E_DATABASE_URL } from './env'

/**
 * A direct, test-only database handle.
 *
 * Deliberately does NOT import `@/db/client` or `@/db/tenant-db` — both pull
 * in the `server-only` package, which throws unconditionally outside a
 * `react-server` module-resolution condition (see `node_modules/server-only`)
 * and Playwright's Node process never sets that condition. `@/db/schema` and
 * `@/lib/crypto` have no such restriction, so this file builds its own
 * unscoped `postgres-js` connection against the E2E database instead.
 *
 * This is the escape hatch the task brief calls for — "DB helpers for direct
 * assertions and for reading things like ... a TOTP secret" — used only for
 * assertions and for reading secrets a real user would already have (the
 * seeded Accounting user's confirmed MFA secret). Invitation/verification
 * tokens are never read from here — only their SHA-256 digest is persisted,
 * by design (`src/server/auth/registration.ts`) — those come from the mock
 * outbox instead (`support/outbox.ts`).
 */
const sql = postgres(E2E_DATABASE_URL, { max: 5, prepare: false, onnotice: () => {} })
export const db = drizzle(sql, { schema })

export async function closeDb(): Promise<void> {
  await sql.end({ timeout: 5 })
}

export async function getUserByEmail(email: string) {
  const rows = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.emailNormalized, email.trim().toLowerCase()))
    .limit(1)
  return rows[0] ?? null
}

export async function getTenantBySlug(slug: string) {
  const rows = await db.select().from(schema.tenants).where(eq(schema.tenants.slug, slug)).limit(1)
  return rows[0] ?? null
}

export async function getMembership(tenantId: string, userId: string) {
  const rows = await db
    .select()
    .from(schema.userTenantMemberships)
    .where(and(eq(schema.userTenantMemberships.tenantId, tenantId), eq(schema.userTenantMemberships.userId, userId)))
    .limit(1)
  return rows[0] ?? null
}

/** The decrypted TOTP secret for a confirmed MFA enrollment — the same secret a real user would have scanned into an authenticator app. */
export async function getDecryptedMfaSecret(email: string): Promise<string> {
  const user = await getUserByEmail(email)
  if (!user) throw new Error(`No user found for ${email}`)
  const rows = await db
    .select()
    .from(schema.mfaConfigurations)
    .where(and(eq(schema.mfaConfigurations.userId, user.id), eq(schema.mfaConfigurations.method, 'totp')))
    .limit(1)
  const config = rows[0]
  if (!config) throw new Error(`No MFA configuration for ${email}`)
  return decryptField(config.secretEncrypted)
}

export async function getCarrierByLegalName(tenantId: string, legalName: string) {
  const rows = await db
    .select()
    .from(schema.carriers)
    .where(and(eq(schema.carriers.tenantId, tenantId), eq(schema.carriers.legalName, legalName)))
    .limit(1)
  return rows[0] ?? null
}

export async function getLoadByNumber(tenantId: string, loadNumber: string) {
  const rows = await db
    .select()
    .from(schema.loads)
    .where(and(eq(schema.loads.tenantId, tenantId), eq(schema.loads.loadNumber, loadNumber)))
    .limit(1)
  return rows[0] ?? null
}

export async function latestNotificationFor(tenantId: string, userId: string, eventKey?: string) {
  const conditions = [eq(schema.notifications.tenantId, tenantId), eq(schema.notifications.userId, userId)]
  if (eventKey) conditions.push(eq(schema.notifications.eventKey, eventKey))
  const rows = await db
    .select()
    .from(schema.notifications)
    .where(and(...conditions))
    .orderBy(desc(schema.notifications.createdAt))
    .limit(1)
  return rows[0] ?? null
}

export async function livePendingInvitationForEmail(email: string) {
  const rows = await db
    .select()
    .from(schema.verificationTokens)
    .where(
      and(
        eq(schema.verificationTokens.purpose, 'invitation'),
        eq(schema.verificationTokens.email, email.trim().toLowerCase()),
        isNull(schema.verificationTokens.consumedAt),
        gt(schema.verificationTokens.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(schema.verificationTokens.createdAt))
    .limit(1)
  return rows[0] ?? null
}

export { schema, eq, and, desc, gt, isNull }
