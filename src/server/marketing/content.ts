/**
 * Static marketing content that isn't a page template: legal document
 * versioning and the Resources index structure.
 *
 * Policy versions are exported constants (not derived from a file hash or a
 * database row) so that a `consent_records.policy_version` value written
 * today is guaranteed to still mean the same thing when it's read back in an
 * audit five years from now — bumping the copy always means bumping the
 * constant in the same commit.
 */

export const PRIVACY_POLICY_VERSION = '2026-08-18'
export const PRIVACY_POLICY_LAST_UPDATED = '2026-08-18'

export const TERMS_VERSION = '2026-08-18'
export const TERMS_LAST_UPDATED = '2026-08-18'

/**
 * Resources index. This release ships no articles — the structure exists so a
 * future content pipeline (CMS import, or the platform team publishing
 * compliance bulletins) has a stable shape to write into, and the empty state
 * is real rather than a handful of placeholder cards.
 */
export type ResourceCategory = 'guide' | 'bulletin' | 'checklist' | 'template'

export interface ResourceEntry {
  slug: string
  category: ResourceCategory
  /** i18n key under `marketing.resources.items.<slug>.title` */
  titleKey: string
  descriptionKey: string
  /** Set once a downloadable asset or article route exists. */
  href?: string
  publishedAt?: string
}

/** Intentionally empty for this release — see the module doc above. */
export const RESOURCE_ENTRIES: ResourceEntry[] = []
