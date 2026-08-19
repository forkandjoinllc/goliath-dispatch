import { DEFAULT_LOCALE, type Locale } from './config'
import { NAMESPACES, type Namespace } from './namespaces'

/**
 * Message loading.
 *
 * Dictionaries are plain JSON so translators can work on them directly and so a
 * missing key is a build-visible data problem rather than a runtime surprise.
 * English is the fallback: a Spanish gap renders English, never a raw key.
 */

export type MessageTree = { [key: string]: string | MessageTree }
export type Dictionary = Record<string, MessageTree>

const loaders: Record<Locale, Record<Namespace, () => Promise<{ default: MessageTree }>>> = {
  en: Object.fromEntries(
    NAMESPACES.map((ns) => [ns, () => import(`./messages/en/${ns}.json`)]),
  ) as Record<Namespace, () => Promise<{ default: MessageTree }>>,
  es: Object.fromEntries(
    NAMESPACES.map((ns) => [ns, () => import(`./messages/es/${ns}.json`)]),
  ) as Record<Namespace, () => Promise<{ default: MessageTree }>>,
}

const cache = new Map<string, Dictionary>()

export async function getDictionary(
  locale: Locale,
  namespaces: readonly Namespace[] = NAMESPACES,
): Promise<Dictionary> {
  const cacheKey = `${locale}:${[...namespaces].sort().join(',')}`
  const cached = cache.get(cacheKey)
  if (cached) return cached

  const entries = await Promise.all(
    namespaces.map(async (ns) => {
      const [primary, fallback] = await Promise.all([
        loaders[locale][ns]().then((m) => m.default).catch(() => ({}) as MessageTree),
        locale === DEFAULT_LOCALE
          ? Promise.resolve({} as MessageTree)
          : loaders[DEFAULT_LOCALE][ns]().then((m) => m.default).catch(() => ({}) as MessageTree),
      ])
      return [ns, deepMerge(fallback, primary)] as const
    }),
  )

  const dictionary = Object.fromEntries(entries) as Dictionary
  cache.set(cacheKey, dictionary)
  return dictionary
}

function deepMerge(base: MessageTree, override: MessageTree): MessageTree {
  const out: MessageTree = { ...base }
  for (const [key, value] of Object.entries(override)) {
    const existing = out[key]
    out[key] =
      typeof value === 'object' && typeof existing === 'object'
        ? deepMerge(existing as MessageTree, value as MessageTree)
        : value
  }
  return out
}

/** Test/CI helper: clears the module-level cache. */
export function __resetDictionaryCache() {
  cache.clear()
}
