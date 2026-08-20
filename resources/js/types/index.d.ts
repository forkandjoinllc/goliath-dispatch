import type { Config as ZiggyConfig } from 'ziggy-js'

export type Locale = 'en' | 'es'

export interface LocaleOption {
  code: Locale
  label: string
  tag: string
}

export interface AuthUser {
  id: string
  firstName: string
  lastName: string
  email: string
}

/** Un diccionario anidado: los valores hoja son cadenas. */
export type DictionaryNode = string | { [key: string]: DictionaryNode }

export interface SharedProps {
  locale: Locale
  localeTag: string
  locales: LocaleOption[]
  dictionary: Record<string, DictionaryNode>
  auth: { user: AuthUser | null }
  flash: { success: string | null; error: string | null }
  ziggy: ZiggyConfig & { location: string }
  [key: string]: unknown
}
