import { useI18n } from '@/lib/i18n'

/**
 * Los estados, con color.
 *
 * El color NO es el único portador del significado: cada insignia lleva su
 * texto traducido. Una tabla en la que el estado se distingue solo por el color
 * es ilegible para quien no distingue rojo de verde, que es alrededor de uno de
 * cada doce hombres.
 */

type Tone = 'neutral' | 'progress' | 'good' | 'warn' | 'bad'

const TONE: Record<Tone, string> = {
  neutral: 'bg-steel-100 text-steel-800 ring-steel-300',
  progress: 'bg-navy-100 text-navy-800 ring-navy-300',
  good: 'bg-success-50 text-success-700 ring-success-500/40',
  warn: 'bg-safety-100 text-safety-800 ring-safety-500/40',
  bad: 'bg-danger-50 text-danger-700 ring-danger-500/40',
}

const ONBOARDING: Record<string, Tone> = {
  draft: 'neutral',
  submitted: 'progress',
  under_review: 'progress',
  corrections_required: 'warn',
  approved: 'good',
  rejected: 'bad',
  suspended: 'bad',
}

const VERIFICATION: Record<string, Tone> = {
  not_started: 'neutral',
  pending: 'progress',
  verified: 'good',
  mismatch: 'warn',
  failed: 'bad',
  manually_overridden: 'warn',
  expired: 'bad',
}

const EQUIPMENT: Record<string, Tone> = {
  pending_verification: 'progress',
  active: 'good',
  out_of_service: 'bad',
  archived: 'neutral',
}

const DOCUMENT_REVIEW: Record<string, Tone> = {
  pending: 'neutral',
  in_review: 'progress',
  approved: 'good',
  rejected: 'bad',
  expired: 'bad',
  superseded: 'neutral',
}

const LOAD: Record<string, Tone> = {
  draft: 'neutral',
  available: 'neutral',
  assigned: 'progress',
  dispatched: 'progress',
  en_route_to_pickup: 'progress',
  at_pickup: 'progress',
  in_transit: 'progress',
  at_delivery: 'progress',
  delivered: 'good',
  pod_received: 'good',
  invoiced: 'good',
  paid: 'good',
  cancelled: 'bad',
}

// El tipo de `family` se deriva de este objeto, pero anotarlo como
// `Record<string, …>` haría que `keyof` fuese `string` y una familia
// inexistente pasaría el compilador para reventar en pantalla. Sin anotación,
// TypeScript infiere las claves literales y `family="load"` solo compila si
// existe de verdad.
const FAMILIES = {
  onboarding: { tones: ONBOARDING, prefix: 'nav.status.onboarding' },
  verification: { tones: VERIFICATION, prefix: 'nav.status.verification' },
  equipment: { tones: EQUIPMENT, prefix: 'nav.status.equipment' },
  document: { tones: DOCUMENT_REVIEW, prefix: 'nav.status.document' },
  load: { tones: LOAD, prefix: 'nav.status.load' },
} satisfies Record<string, { tones: Record<string, Tone>; prefix: string }>

/** `corrections_required` → `correctionsRequired`, que es la clave del diccionario. */
function camel(value: string): string {
  return value.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
}

export function StatusBadge({
  family,
  value,
}: {
  family: keyof typeof FAMILIES
  value: string | null
}) {
  const { t } = useI18n()

  if (!value) return null

  const config = FAMILIES[family]!
  const tone = config.tones[value] ?? 'neutral'
  const key = `${config.prefix}.${camel(value)}`
  const label = t(key)

  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TONE[tone]}`}
    >
      {/* Si falta la traducción `t` devuelve la clave; en ese caso vale más
          enseñar el valor crudo que una ruta con puntos. */}
      {label === key ? value.replace(/_/g, ' ') : label}
    </span>
  )
}
