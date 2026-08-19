import 'server-only'
import { and, asc, desc, eq, inArray, isNull, lt } from 'drizzle-orm'
import type { TenantDb } from '@/db/tenant-db'
import {
  signatureRequests,
  signatureTemplates,
  type SignatureRequest,
  type SignatureTemplate,
} from '@/db/schema'
import { sha256Hex } from '@/lib/crypto'
import { AppError, conflict, notFound } from '@/lib/errors'
import type { Locale } from '@/i18n/config'

/**
 * Signature templates: versioned, immutable once published.
 *
 * Editing a published template never mutates its row — it inserts version
 * N+1 with `active = true` and retires version N (`active = false`,
 * `retiredAt` set). Every signature request pins the exact `templateVersion`
 * and `templateContentHash` it was signed against, so a later edit can never
 * quietly change what an already-signed document says it was.
 */

export interface TemplateContentFields {
  titleEn: string
  titleEs: string
  bodyEn: string
  bodyEs: string
  consentCopyEn: string
  consentCopyEs: string
  requiredTokens: readonly string[]
}

/**
 * Fixed-order, `JSON.stringify`d serialization of a template's content.
 *
 * This is a compatibility contract: `contentHash = sha256(canonicalizeTemplate(...))`
 * is pinned onto every signature request that is ever signed against a given
 * version, so the function's output for a given input must never change.
 *
 *  - Stable across object key order: the fields are read positionally from a
 *    typed interface, never enumerated from an arbitrary object, so JS
 *    property-order quirks cannot affect the result.
 *  - Stable across `requiredTokens` array order: the array is sorted before
 *    serialization, since it is a set of requirements, not a sequence.
 *  - Versioned with a leading literal ('v1') so a future change to this
 *    format can be introduced without colliding with hashes already computed
 *    under the old one.
 */
export function canonicalizeTemplate(fields: TemplateContentFields): string {
  return JSON.stringify([
    'v1',
    fields.titleEn,
    fields.titleEs,
    fields.bodyEn,
    fields.bodyEs,
    fields.consentCopyEn,
    fields.consentCopyEs,
    [...fields.requiredTokens].sort(),
  ])
}

export function computeTemplateContentHash(fields: TemplateContentFields): string {
  return sha256Hex(canonicalizeTemplate(fields))
}

/** The single active (published, not retired) version for a template key, or null. */
export async function getActiveTemplate(
  db: TenantDb,
  templateKey: string,
): Promise<SignatureTemplate | null> {
  return db.findFirst(signatureTemplates, {
    where: and(eq(signatureTemplates.templateKey, templateKey), eq(signatureTemplates.active, true)),
  })
}

export async function requireActiveTemplate(db: TenantDb, templateKey: string): Promise<SignatureTemplate> {
  const template = await getActiveTemplate(db, templateKey)
  if (!template) throw notFound('signature.errors.templateNotFound', { templateKey })
  return template
}

/** Every version of a template, newest first — the version history view. */
export async function listTemplateVersions(db: TenantDb, templateKey: string): Promise<SignatureTemplate[]> {
  return db.findMany(signatureTemplates, {
    where: eq(signatureTemplates.templateKey, templateKey),
    orderBy: desc(signatureTemplates.version),
  })
}

/** Every template key that has at least one active version — the templates index. */
export async function listActiveTemplates(db: TenantDb): Promise<SignatureTemplate[]> {
  return db.findMany(signatureTemplates, {
    where: eq(signatureTemplates.active, true),
    orderBy: asc(signatureTemplates.templateKey),
  })
}

export interface CreateTemplateInput extends TemplateContentFields {
  templateKey: string
}

/** Creates the first version of a brand-new template key. */
export async function createTemplate(db: TenantDb, input: CreateTemplateInput): Promise<SignatureTemplate> {
  const existing = await getActiveTemplate(db, input.templateKey)
  if (existing) {
    throw conflict('signature.errors.templateAlreadyExists', { templateKey: input.templateKey })
  }

  return db.insert(signatureTemplates, {
    templateKey: input.templateKey,
    version: 1,
    titleEn: input.titleEn,
    titleEs: input.titleEs,
    bodyEn: input.bodyEn,
    bodyEs: input.bodyEs,
    consentCopyEn: input.consentCopyEn,
    consentCopyEs: input.consentCopyEs,
    contentHash: computeTemplateContentHash(input),
    requiredTokens: [...input.requiredTokens],
    active: true,
  })
}

/**
 * Publishes version N+1 and retires the current active version in the same
 * transaction — a template key is never left with zero or two active
 * versions. This is the operation that invalidates prior signatures for
 * compliance purposes: callers should follow it with
 * `findRequestsNeedingResignature` to see who now needs to sign again.
 */
export async function createNewTemplateVersion(
  db: TenantDb,
  templateKey: string,
  fields: TemplateContentFields,
): Promise<SignatureTemplate> {
  return db.transaction(async (tx) => {
    const current = await getActiveTemplate(tx, templateKey)
    if (!current) throw notFound('signature.errors.templateNotFound', { templateKey })

    const created = await tx.insert(signatureTemplates, {
      templateKey,
      version: current.version + 1,
      titleEn: fields.titleEn,
      titleEs: fields.titleEs,
      bodyEn: fields.bodyEn,
      bodyEs: fields.bodyEs,
      consentCopyEn: fields.consentCopyEn,
      consentCopyEs: fields.consentCopyEs,
      contentHash: computeTemplateContentHash(fields),
      requiredTokens: [...fields.requiredTokens],
      active: true,
    })

    await tx.update(signatureTemplates, current.id, { active: false, retiredAt: new Date() })

    return created
  })
}

/** Retires a template key entirely, with no replacement version. */
export async function retireTemplate(db: TenantDb, templateKey: string): Promise<SignatureTemplate> {
  const current = await getActiveTemplate(db, templateKey)
  if (!current) throw notFound('signature.errors.templateNotFound', { templateKey })
  const updated = await db.update(signatureTemplates, current.id, {
    active: false,
    retiredAt: new Date(),
  })
  if (!updated) throw notFound('signature.errors.templateNotFound', { templateKey })
  return updated
}

export interface RenderedTemplate {
  title: string
  body: string
  consentCopy: string
}

/**
 * Substitutes `{{token}}` placeholders with `tokenValues`, in the requested
 * locale. Throws — never silently renders a blank — when a token the
 * template declares `requiredTokens` is missing or empty: this text ends up
 * in a document a signer is asked to rely on, so an unresolved legal
 * placeholder is a defect, not a cosmetic gap.
 */
export function renderTemplate(
  template: SignatureTemplate,
  tokenValues: Record<string, string>,
  locale: Locale,
): RenderedTemplate {
  for (const token of template.requiredTokens) {
    const value = tokenValues[token]
    if (value === undefined || value === null || value.trim().length === 0) {
      throw new AppError('validation_failed', 'signature.errors.missingRequiredToken', {
        params: { token },
      })
    }
  }

  const substitute = (text: string) =>
    text.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, token: string) =>
      Object.prototype.hasOwnProperty.call(tokenValues, token) ? (tokenValues[token] ?? '') : match,
    )

  const title = locale === 'es' ? template.titleEs : template.titleEn
  const body = locale === 'es' ? template.bodyEs : template.bodyEn
  const consentCopy = locale === 'es' ? template.consentCopyEs : template.consentCopyEn

  return { title: substitute(title), body: substitute(body), consentCopy: substitute(consentCopy) }
}

/**
 * Every signed request pinned to a version of `templateKey` older than the
 * key's current active version, and not already superseded. This is the
 * driver for the "needs re-signature" view: bumping a template version does
 * not retroactively invalidate anything in the database — it changes what
 * this query returns, which is what the UI and any future automation acts on.
 */
export async function findRequestsNeedingResignature(
  db: TenantDb,
  templateKey: string,
): Promise<SignatureRequest[]> {
  const active = await getActiveTemplate(db, templateKey)
  if (!active) return []

  const versions = await db.findMany(signatureTemplates, {
    where: eq(signatureTemplates.templateKey, templateKey),
  })
  const versionIds = versions.map((v) => v.id)
  if (versionIds.length === 0) return []

  return db.findMany(signatureRequests, {
    where: and(
      inArray(signatureRequests.templateId, versionIds),
      eq(signatureRequests.status, 'signed'),
      lt(signatureRequests.templateVersion, active.version),
      isNull(signatureRequests.supersededByRequestId),
    ),
    orderBy: desc(signatureRequests.completedAt),
  })
}
