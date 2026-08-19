import 'server-only'
import { z } from 'zod'
import { tenantDb, type TenantDb } from '@/db/tenant-db'
import { documents, documentVersions } from '@/db/schema'
import { notFound } from '@/lib/errors'
import { assertKeyBelongsToTenant, getStorage } from '@/lib/storage'
import { watermarkImage, watermarkPdf } from '@/lib/pdf/watermark'
import { getTenant } from '@/server/context'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator } from '@/i18n/translate'
import type { Locale } from '@/i18n/config'
import { defineJob, type JobContext } from '../registry'

/**
 * Pre-generates and caches a watermarked variant of a document version.
 *
 * This is a companion to, not a replacement for, `documents/service.ts`'s
 * `getDownloadUrl({ watermark: true })`, which renders a fresh watermark
 * synchronously on every download under a random, one-time key (see that
 * function's own comment on why: a short-TTL signed URL is the actual thing
 * making the download "one-time" in practice, and a brand-new random key is
 * how it never collides). This job instead writes under a **deterministic
 * derived key** — `<version-dir>/watermarks/cache/<locale>.pdf` — so the
 * same (version, locale) pair always reuses the same object: calling this
 * job twice for the same version and locale overwrites the same key with an
 * equivalent artifact, never creating a second one. Nothing currently reads
 * from the cache key this job writes to; it exists so the documents module
 * can adopt it later as a fast path for a locale/version combination that is
 * downloaded often, without a jobs-agent change.
 */

const payloadSchema = z.object({
  documentId: z.string().uuid(),
  documentVersionId: z.string().uuid(),
  locale: z.enum(['en', 'es']).default('en'),
})

function cacheKeyFor(originalKey: string, locale: Locale): string {
  const lastSlash = originalKey.lastIndexOf('/')
  const dir = lastSlash === -1 ? '' : originalKey.slice(0, lastSlash)
  return `${dir}/watermarks/cache/${locale}.pdf`
}

async function buildWatermarkedBytes(
  db: TenantDb,
  originalBytes: Buffer,
  contentType: string,
  locale: Locale,
): Promise<Uint8Array | null> {
  const tenant = await getTenant(db.tenantId)
  const dictionary = await getDictionary(locale, ['document', 'common'])
  const t = createTranslator(dictionary, locale)
  const stampOptions = {
    downloadedAt: new Date(),
    locale,
    tenantName: tenant?.displayName ?? 'Goliath Dispatch',
    timezone: tenant?.defaultTimezone ?? 'America/New_York',
    // No specific downloader for a pre-generated cache entry — the stamp
    // shows the generation moment and tenant, never a fabricated email.
    downloadedByEmail: null,
  }

  if (contentType === 'application/pdf') return watermarkPdf(originalBytes, stampOptions, t)
  if (contentType === 'image/png' || contentType === 'image/jpeg') {
    return watermarkImage(originalBytes, contentType, stampOptions, t)
  }
  return null // Nothing to stamp (e.g. a non-renderable content type) — not an error.
}

export async function generateWatermarkCacheEntry(payload: z.infer<typeof payloadSchema>, ctx: JobContext): Promise<void> {
  if (!ctx.tenantId) throw new Error('document.watermark_generate requires a tenantId')
  const db = tenantDb(ctx.tenantId)

  const document = await db.requireById(documents, payload.documentId, 'document')
  const version = await db.findById(documentVersions, payload.documentVersionId)
  if (!version || version.documentId !== document.id) {
    throw notFound('document.errors.versionNotFound')
  }

  assertKeyBelongsToTenant(version.storageKey, db.tenantId)
  const storage = getStorage()
  const original = await storage.get(version.storageKey)

  const watermarked = await buildWatermarkedBytes(db, original.body, version.contentType, payload.locale)
  if (!watermarked) return // Content type has no watermark rendering — nothing to cache.

  const cacheKey = cacheKeyFor(version.storageKey, payload.locale)
  assertKeyBelongsToTenant(cacheKey, db.tenantId)
  await storage.put({ key: cacheKey, body: Buffer.from(watermarked), contentType: 'application/pdf' })
}

defineJob('document.watermark_generate', {
  schema: payloadSchema,
  handler: generateWatermarkCacheEntry,
  defaultMaxAttempts: 3,
  description: 'Pre-generates and caches a watermarked variant of a document version under a deterministic key.',
})
