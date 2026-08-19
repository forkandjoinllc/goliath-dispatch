import type { Document, DocumentVersion } from '@/db/schema'

/**
 * Types and pure helpers shared across the client/server boundary.
 *
 * `_lib/queries.ts` is `server-only` because it holds database access; the
 * document table is a client component and needs the row type and the owner-key
 * helper, so those live here where both sides may import them.
 */

export interface TenantDocumentRow extends Document {
  currentVersion: DocumentVersion | null
}

/** Stable key for looking up a resolved owner display name in a lookup map. */
export function ownerLabelKey(ownerType: string, ownerId: string): string {
  return `${ownerType}:${ownerId}`
}
