import { Link } from '@inertiajs/react'
import { useI18n } from '@/lib/i18n'

/**
 * Las pestañas de la flota: camiones, remolques y conjuntos.
 *
 * Los tres se miran juntos y son el mismo dominio: partirlos en tres entradas
 * del menú obligaría a volver atrás cada vez. Vive en un componente y no
 * copiado en cada pantalla porque una pestaña añadida en una sola de ellas es
 * una pestaña que desaparece al cambiar de pestaña.
 */
export type EquipmentTab = 'trucks' | 'trailers' | 'combos'

const RUTAS: Record<EquipmentTab, string> = {
  trucks: '/equipment/trucks',
  trailers: '/equipment/trailers',
  combos: '/equipment/combos',
}

const ETIQUETAS: Record<EquipmentTab, string> = {
  trucks: 'equipment.index.trucksTab',
  trailers: 'equipment.index.trailersTab',
  combos: 'equipment.combos.tab',
}

export function EquipmentTabs({ active }: { active: EquipmentTab }) {
  const { t } = useI18n()

  return (
    <div className="flex gap-1 border-b border-steel-200">
      {(['trucks', 'trailers', 'combos'] as const).map((tab) => (
        <Link
          key={tab}
          href={RUTAS[tab]}
          aria-current={tab === active ? 'page' : undefined}
          className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition ${
            tab === active
              ? 'border-safety-600 text-navy-800'
              : 'border-transparent text-steel-600 hover:text-navy-700'
          }`}
        >
          {t(ETIQUETAS[tab])}
        </Link>
      ))}
    </div>
  )
}
