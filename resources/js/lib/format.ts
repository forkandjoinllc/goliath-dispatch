import type { Locale } from '@/types'

const LOCALE_TAGS: Record<Locale, string> = { en: 'en-US', es: 'es-US' }

/**
 * Formatea céntimos enteros como moneda.
 *
 * El servidor manda céntimos y el formateo ocurre aquí, con Intl y el idioma ya
 * resuelto. Mandar «$99.00» desde PHP obligaría al servidor a decidir el formato
 * de un idioma que no debería estar formateando, y a repetir esa decisión en
 * cada endpoint que devuelva dinero.
 *
 * Nunca se divide entre 100 para «convertir a dólares» y luego se redondea: se
 * pasan los céntimos a Intl y él coloca la coma. Un `cents / 100` en coma
 * flotante es exactamente donde aparecen los céntimos perdidos.
 */
export function formatCents(cents: number, locale: Locale, currency = 'USD'): string {
  return new Intl.NumberFormat(LOCALE_TAGS[locale], {
    style: 'currency',
    currency,
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100)
}
