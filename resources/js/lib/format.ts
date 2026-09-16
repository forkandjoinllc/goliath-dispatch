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

/**
 * Un DÍA del calendario, en el idioma de quien mira.
 *
 * El servidor manda diez caracteres —`2026-06-01`— y aquí se le pega
 * `T00:00:00` antes de construir la fecha. Sin eso, `new Date('2026-06-01')` se
 * interpreta como medianoche **UTC** y el navegador la vuelve a convertir a su
 * huso: con el reloj en Chicago, una licencia que caduca el 1 de junio se pinta
 * «31 may». Un día de menos en el papel que permite que un camión salga.
 *
 * Con `T00:00:00` y sin huso, la fecha es medianoche LOCAL y el día no se mueve.
 *
 * Esta función existe para que ese truco no se copie una quinta vez: estaba
 * escrito bien en la pantalla de Documentos y mal en las otras cuatro. Ver
 * `App\Support\Time\CalendarDates`.
 */
export function formatDay(value: string | null | undefined, locale: Locale): string {
  if (value === null || value === undefined || value === '') {
    return '—'
  }

  return new Intl.DateTimeFormat(LOCALE_TAGS[locale], { dateStyle: 'medium' }).format(
    new Date(`${value.slice(0, 10)}T00:00:00`),
  )
}

/**
 * Un INSTANTE: cuándo pasó algo dentro del sistema.
 *
 * Aquí sí se convierte, y por eso es otra función con otro nombre: el valor
 * llega en ISO 8601 con su huso, y `new Date()` lo lleva al del navegador, que
 * es lo correcto para «cuándo se aprobó», «cuándo entró el mensaje».
 *
 * Las dos se llamaban `day()` y `date()` dentro de cada pantalla, copiadas a
 * mano, y por eso la mitad trataba un día como si fuera una hora.
 */
export function formatInstant(
  value: string | null | undefined,
  locale: Locale,
  withTime = false,
): string {
  if (value === null || value === undefined || value === '') {
    return '—'
  }

  return new Intl.DateTimeFormat(LOCALE_TAGS[locale], {
    dateStyle: 'medium',
    ...(withTime ? { timeStyle: 'short' } : {}),
  }).format(new Date(value))
}
