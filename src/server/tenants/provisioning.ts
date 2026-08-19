import 'server-only'
import { eq, like } from 'drizzle-orm'
import { unsafeDb, type Database } from '@/db/client'
import { TenantDb } from '@/db/tenant-db'
import {
  equipmentTypes,
  expenseCategories,
  notificationTemplates,
  signatureTemplates,
  tenantBranding,
  tenantSettings,
  tenants,
  userTenantMemberships,
  users,
} from '@/db/schema'
import { oversizeRules } from '@/db/schema/route'
import { hashPassword } from '@/lib/auth/password'
import { sha256Hex } from '@/lib/crypto'
import { conflict } from '@/lib/errors'
import { normalizeEmail, slugify } from '@/lib/utils'
import type { Locale } from '@/i18n/config'
import { defaultOversizeRules } from './oversize-seed-data'

/**
 * Tenant provisioning.
 *
 * `provisionTenant` is the entire "start your dispatch company" signup path:
 * one database transaction creates the tenant, its default branding and
 * settings, the Admin account and membership, and every system taxonomy a
 * fresh tenant needs to be immediately usable (equipment types, expense
 * categories, signature templates, notification templates, oversize rules).
 *
 * Billing (Stripe customer + subscription) is deliberately NOT part of this
 * transaction — it is an external network call with its own failure modes,
 * handled by `subscription.ts` after the tenant exists, so a Stripe outage
 * never rolls back a successful signup. A tenant that is missing its
 * subscription row is fully queryable and can have billing retried.
 */

export interface ProvisionTenantInput {
  companyName: string
  admin: {
    firstName: string
    lastName: string
    email: string
    password: string
  }
  planCode: string
  locale: Locale
  ip: string | null
  userAgent: string | null
}

export interface ProvisionTenantResult {
  tenantId: string
  adminUserId: string
  slug: string
}

export async function provisionTenant(input: ProvisionTenantInput): Promise<ProvisionTenantResult> {
  const emailNormalized = normalizeEmail(input.admin.email) ?? ''

  const existingUser = await unsafeDb
    .select({ id: users.id })
    .from(users)
    .where(eq(users.emailNormalized, emailNormalized))
    .limit(1)
    .then((rows) => rows[0] ?? null)
  if (existingUser) {
    throw conflict('errors.conflict')
  }

  const slug = await uniqueSlug(input.companyName)
  const passwordHash = await hashPassword(input.admin.password)

  const result = await unsafeDb.transaction(async (tx) => {
    const [tenant] = await tx
      .insert(tenants)
      .values({
        slug,
        legalName: input.companyName,
        displayName: input.companyName,
        status: 'trialing',
        defaultLocale: input.locale,
        provisionedAt: new Date(),
      })
      .returning()
    const tenantId = tenant!.id
    const db = new TenantDb(tenantId, tx as unknown as Database)

    await db.insert(tenantBranding, {})
    await db.insert(tenantSettings, { contactEmail: input.admin.email, supportEmail: input.admin.email })

    const [admin] = await tx
      .insert(users)
      .values({
        email: input.admin.email,
        emailNormalized,
        passwordHash,
        firstName: input.admin.firstName,
        lastName: input.admin.lastName,
        locale: input.locale,
        status: 'pending_verification',
      })
      .returning()
    const adminUserId = admin!.id

    await tx.insert(userTenantMemberships).values({
      tenantId,
      userId: adminUserId,
      role: 'admin',
      status: 'active',
      isPrimaryContact: true,
      acceptedAt: new Date(),
    })

    await seedEquipmentTypes(db)
    await seedExpenseCategories(db)
    await seedSignatureTemplates(db)
    await seedNotificationTemplates(db)
    await seedOversizeRules(db)

    return { tenantId, adminUserId, slug }
  })

  return result
}

async function uniqueSlug(companyName: string): Promise<string> {
  const base = slugify(companyName) || 'dispatch-company'
  const existing = await unsafeDb
    .select({ slug: tenants.slug })
    .from(tenants)
    .where(like(tenants.slug, `${base}%`))

  const taken = new Set(existing.map((r) => r.slug))
  if (!taken.has(base)) return base
  let suffix = 2
  while (taken.has(`${base}-${suffix}`)) suffix += 1
  return `${base}-${suffix}`
}

/* ── System taxonomies ───────────────────────────────────────────────────── */

async function seedEquipmentTypes(db: TenantDb) {
  await db.insertMany(equipmentTypes, [
    { code: 'flatbed', labelEn: 'Flatbed', labelEs: 'Plataforma', category: 'trailer', isSystem: true, sortOrder: 1 },
    { code: 'step_deck', labelEn: 'Step deck', labelEs: 'Cama baja escalonada', category: 'trailer', isSystem: true, sortOrder: 2 },
    { code: 'lowboy', labelEn: 'Lowboy', labelEs: 'Cama baja', category: 'trailer', isSystem: true, sortOrder: 3 },
    {
      code: 'rgn',
      labelEn: 'Removable gooseneck (RGN)',
      labelEs: 'Cuello de ganso removible (RGN)',
      category: 'trailer',
      isSystem: true,
      supportsRgn: true,
      sortOrder: 4,
    },
  ])
}

async function seedExpenseCategories(db: TenantDb) {
  await db.insertMany(expenseCategories, [
    {
      code: 'permits',
      labelEn: 'Permits',
      labelEs: 'Permisos',
      treatment: 'excluded_from_commission',
      isSystem: true,
      requiresReceipt: true,
      sortOrder: 1,
    },
    {
      code: 'escorts',
      labelEn: 'Escorts',
      labelEs: 'Escoltas',
      treatment: 'excluded_from_commission',
      isSystem: true,
      requiresReceipt: true,
      sortOrder: 2,
    },
    { code: 'fuel', labelEn: 'Fuel', labelEs: 'Combustible', treatment: 'reimbursable_to_carrier', sortOrder: 3 },
    { code: 'lumper', labelEn: 'Lumper', labelEs: 'Estibador', treatment: 'reimbursable_to_carrier', sortOrder: 4 },
    { code: 'tolls', labelEn: 'Tolls', labelEs: 'Peajes', treatment: 'reimbursable_to_carrier', sortOrder: 5 },
    {
      code: 'detention',
      labelEn: 'Detention',
      labelEs: 'Detención',
      treatment: 'reimbursable_to_carrier',
      requiresReceipt: false,
      sortOrder: 6,
    },
    { code: 'scale', labelEn: 'Scale', labelEs: 'Báscula', treatment: 'reimbursable_to_carrier', sortOrder: 7 },
    {
      code: 'tarp',
      labelEn: 'Tarp',
      labelEs: 'Lona',
      treatment: 'tenant_absorbed',
      requiresReceipt: false,
      sortOrder: 8,
    },
  ])
}

function contentHashFor(templateKey: string, version: number, bodyEn: string, bodyEs: string): string {
  return sha256Hex(`${templateKey}:v${version}:${bodyEn}:${bodyEs}`)
}

async function seedSignatureTemplates(db: TenantDb) {
  const noaBodyEn =
    'This Notice of Assignment confirms that {{tenantLegalName}}, acting as dispatch representative for {{carrierLegalName}} (USDOT {{carrierDotNumber}}), directs {{customerName}} to remit all payments due under this arrangement to the account on file, effective {{effectiveDate}}. By signing below, {{signerName}} confirms authority to bind {{carrierLegalName}} to this notice.'
  const noaBodyEs =
    'Este Aviso de Cesión confirma que {{tenantLegalName}}, actuando como representante de despacho de {{carrierLegalName}} (USDOT {{carrierDotNumber}}), instruye a {{customerName}} a remitir todos los pagos adeudados bajo este acuerdo a la cuenta registrada, a partir del {{effectiveDate}}. Al firmar a continuación, {{signerName}} confirma tener autoridad para vincular a {{carrierLegalName}} a este aviso.'
  const noaTokens = ['tenantLegalName', 'carrierLegalName', 'carrierDotNumber', 'customerName', 'effectiveDate', 'signerName']

  const copBodyEn =
    'This Change of Payee authorizes {{tenantLegalName}} to update payment instructions for {{carrierLegalName}} (USDOT {{carrierDotNumber}}) to {{factoringCompanyName}}, effective {{effectiveDate}}, superseding any prior payee instructions on file. By signing below, {{signerName}} confirms authority to bind {{carrierLegalName}} to this change.'
  const copBodyEs =
    'Este Cambio de Beneficiario autoriza a {{tenantLegalName}} a actualizar las instrucciones de pago de {{carrierLegalName}} (USDOT {{carrierDotNumber}}) a {{factoringCompanyName}}, a partir del {{effectiveDate}}, reemplazando cualquier instrucción de pago anterior registrada. Al firmar a continuación, {{signerName}} confirma tener autoridad para vincular a {{carrierLegalName}} a este cambio.'
  const copTokens = [
    'tenantLegalName',
    'carrierLegalName',
    'carrierDotNumber',
    'factoringCompanyName',
    'effectiveDate',
    'signerName',
  ]

  const consentCopyEn =
    'By clicking "I agree" and signing below, you consent to conduct this transaction electronically and agree that your electronic signature is legally binding, equivalent to a handwritten signature.'
  const consentCopyEs =
    'Al hacer clic en "Acepto" y firmar a continuación, usted consiente en realizar esta transacción electrónicamente y acepta que su firma electrónica es legalmente vinculante, equivalente a una firma manuscrita.'

  await db.insertMany(signatureTemplates, [
    {
      templateKey: 'notice_of_assignment',
      version: 1,
      titleEn: 'Notice of Assignment',
      titleEs: 'Aviso de Cesión',
      bodyEn: noaBodyEn,
      bodyEs: noaBodyEs,
      consentCopyEn,
      consentCopyEs,
      contentHash: contentHashFor('notice_of_assignment', 1, noaBodyEn, noaBodyEs),
      requiredTokens: noaTokens,
      active: true,
    },
    {
      templateKey: 'change_of_payee',
      version: 1,
      titleEn: 'Change of Payee',
      titleEs: 'Cambio de Beneficiario',
      bodyEn: copBodyEn,
      bodyEs: copBodyEs,
      consentCopyEn,
      consentCopyEs,
      contentHash: contentHashFor('change_of_payee', 1, copBodyEn, copBodyEs),
      requiredTokens: copTokens,
      active: true,
    },
  ])
}

async function seedNotificationTemplates(db: TenantDb) {
  const rows: Array<Omit<typeof notificationTemplates.$inferInsert, 'tenantId'>> = []

  const events: Array<{
    key: string
    subjectEn: string
    subjectEs: string
    bodyEn: string
    bodyEs: string
  }> = [
    {
      key: 'document_expiring',
      subjectEn: '{{documentType}} for {{entityName}} expires soon',
      subjectEs: '{{documentType}} de {{entityName}} vence pronto',
      bodyEn: 'The {{documentType}} on file for {{entityName}} expires on {{expiresOn}}. Upload a renewed copy before then to avoid a compliance hold.',
      bodyEs: 'El {{documentType}} registrado para {{entityName}} vence el {{expiresOn}}. Suba una copia renovada antes de esa fecha para evitar una retención por cumplimiento.',
    },
    {
      key: 'document_expired',
      subjectEn: '{{documentType}} for {{entityName}} has expired',
      subjectEs: '{{documentType}} de {{entityName}} ha vencido',
      bodyEn: 'The {{documentType}} on file for {{entityName}} expired on {{expiresOn}}. This record is now blocked from new dispatch until a current copy is uploaded and approved.',
      bodyEs: 'El {{documentType}} registrado para {{entityName}} venció el {{expiresOn}}. Este registro está bloqueado para nuevos despachos hasta que se suba y apruebe una copia vigente.',
    },
  ]

  for (const event of events) {
    for (const locale of ['en', 'es'] as const) {
      const subject = locale === 'en' ? event.subjectEn : event.subjectEs
      const body = locale === 'en' ? event.bodyEn : event.bodyEs
      rows.push({
        eventKey: event.key,
        channel: 'in_app',
        locale,
        subject,
        body,
        availableTokens: ['documentType', 'entityName', 'expiresOn'],
        active: true,
      })
      rows.push({
        eventKey: event.key,
        channel: 'email',
        locale,
        subject,
        body,
        availableTokens: ['documentType', 'entityName', 'expiresOn'],
        active: true,
      })
    }
  }

  await db.insertMany(notificationTemplates, rows)
}

async function seedOversizeRules(db: TenantDb) {
  await db.insertMany(oversizeRules, defaultOversizeRules())
}
