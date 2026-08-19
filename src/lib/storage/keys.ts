import { forbidden, validationFailed } from '@/lib/errors'
import { slugify } from '@/lib/utils'

/**
 * Tenant-scoped object key builder.
 *
 * Every key produced here starts `tenants/{tenantId}/…`. That prefix is the
 * second line of defence (after the permission check) against a guessed or
 * replayed key: `assertKeyBelongsToTenant` refuses anything that does not
 * start with the caller's own tenant prefix, so a signed URL for tenant A's
 * document can never be minted for tenant B, even by a bug that only checked
 * the document id.
 */

/** Mirrors the polymorphic owner column on `documents` (`_shared.ts` comment). */
export type DocumentOwnerType =
  | 'carrier'
  | 'truck'
  | 'trailer'
  | 'driver'
  | 'load'
  | 'tenant'
  | 'invoice'

const OWNER_TYPE_SEGMENT: Record<DocumentOwnerType, string> = {
  carrier: 'carriers',
  truck: 'trucks',
  trailer: 'trailers',
  driver: 'drivers',
  load: 'loads',
  tenant: 'tenant-owned',
  invoice: 'invoices',
}

export interface BuildKeyInput {
  tenantId: string
  ownerType: DocumentOwnerType
  ownerId: string
  documentId: string
  versionNumber: number
  /** Original filename as uploaded; sanitised before it becomes part of the key. */
  filename: string
}

/**
 * A UUID (or any other identifier we accept for these fields) must never
 * itself carry a path separator — that is the only way a caller-controlled
 * value could smuggle a directory traversal into a key built entirely from
 * "safe" segments.
 */
function assertPathSafeSegment(value: string, field: string): void {
  if (!value || value.includes('/') || value.includes('\\') || value.includes('..')) {
    throw validationFailed('errors.validationFailed', { field, value: '[redacted]' })
  }
}

/**
 * Strips directory traversal, path separators and anything outside a
 * conservative charset from a client-supplied filename, while preserving a
 * lowercase, alphanumeric extension. `../../etc/passwd.pdf` becomes
 * `etc-passwd.pdf` — inert, but still recognisable enough for support to
 * reason about.
 */
export function sanitizeFilename(filename: string): string {
  const trimmed = filename.trim()
  const lastDot = trimmed.lastIndexOf('.')
  const hasExtension = lastDot > 0 && lastDot < trimmed.length - 1
  const rawExtension = hasExtension ? trimmed.slice(lastDot + 1) : ''
  const rawBase = hasExtension ? trimmed.slice(0, lastDot) : trimmed

  const extension = rawExtension.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10)
  const base = slugify(rawBase, 120) || 'file'

  return extension ? `${base}.${extension}` : base
}

/** Builds `tenants/{tenantId}/{ownerType}s/{ownerId}/documents/{documentId}/v{n}/{filename}`. */
export function buildKey(input: BuildKeyInput): string {
  assertPathSafeSegment(input.tenantId, 'tenantId')
  assertPathSafeSegment(input.ownerId, 'ownerId')
  assertPathSafeSegment(input.documentId, 'documentId')

  if (!Number.isInteger(input.versionNumber) || input.versionNumber < 1) {
    throw validationFailed('errors.validationFailed', { field: 'versionNumber' })
  }

  const ownerSegment = OWNER_TYPE_SEGMENT[input.ownerType]
  const filename = sanitizeFilename(input.filename)

  return [
    'tenants',
    input.tenantId,
    ownerSegment,
    input.ownerId,
    'documents',
    input.documentId,
    `v${input.versionNumber}`,
    filename,
  ].join('/')
}

/**
 * The single choke point every storage read/write/sign passes through.
 * Throws rather than returning a boolean so a forgetful call site fails
 * loudly instead of silently proceeding with an unchecked key.
 */
export function assertKeyBelongsToTenant(key: string, tenantId: string): void {
  const prefix = `tenants/${tenantId}/`
  if (key.includes('..') || !key.startsWith(prefix)) {
    throw forbidden('errors.crossTenant')
  }
}
