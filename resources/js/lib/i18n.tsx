import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { usePage } from '@inertiajs/react'
import type { DictionaryNode, Locale, SharedProps } from '@/types'

/**
 * Traducción en el cliente.
 *
 * Las claves son con puntos y llevan el espacio de nombres delante:
 * `t('marketing.home.hero.title')`. El espacio tiene que venir en la lista que
 * la página declaró en el servidor (ver App\Support\Dictionary); si no, la clave
 * no viaja y `t` devuelve la clave misma.
 *
 * Devolver la clave —y no una cadena vacía— es deliberado: una traducción que
 * falta debe ser visible en la página, no un hueco en blanco que nadie nota
 * hasta que un cliente lo señala.
 */

interface I18nValue {
  locale: Locale
  localeTag: string
  t: (key: string, params?: Record<string, string | number>) => string
  /** Para listas: devuelve el nodo crudo cuando la traducción es un array. */
  list: (key: string) => string[]
  has: (key: string) => boolean
}

const I18nContext = createContext<I18nValue | null>(null)

function lookup(dictionary: Record<string, DictionaryNode>, key: string): DictionaryNode | undefined {
  let node: DictionaryNode | undefined = dictionary as DictionaryNode
  for (const segment of key.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined
    node = (node as Record<string, DictionaryNode>)[segment]
  }
  return node
}

/** Sustituye {name} por su valor. Sin motor de plantillas: no hace falta. */
function interpolate(text: string, params?: Record<string, string | number>): string {
  if (!params) return text
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  )
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const { locale, localeTag, dictionary } = usePage<SharedProps>().props

  const value = useMemo<I18nValue>(() => {
    const t = (key: string, params?: Record<string, string | number>): string => {
      const found = lookup(dictionary, key)
      if (typeof found === 'string') return interpolate(found, params)
      if (import.meta.env.DEV && found === undefined) {
        // Ruidoso en desarrollo, silencioso en producción: en una página de
        // marketing una clave suelta es fea, pero una pantalla en blanco por una
        // excepción es peor.
        console.warn(`[i18n] falta la clave "${key}" en "${locale}"`)
      }
      return key
    }

    return {
      locale,
      localeTag,
      t,
      list: (key: string): string[] => {
        const found = lookup(dictionary, key)
        if (Array.isArray(found)) return found as unknown as string[]
        if (found && typeof found === 'object') return Object.values(found).filter(
          (v): v is string => typeof v === 'string',
        )
        return []
      },
      has: (key: string): boolean => lookup(dictionary, key) !== undefined,
    }
  }, [dictionary, locale, localeTag])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nValue {
  const context = useContext(I18nContext)
  if (context === null) {
    throw new Error('useI18n necesita estar dentro de <I18nProvider>')
  }
  return context
}

/** Atajo para el caso más común. */
export function useT() {
  return useI18n().t
}
