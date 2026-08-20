import { Link } from '@inertiajs/react'
import { AppLayout } from '@/layouts/AppLayout'
import { useI18n } from '@/lib/i18n'

/**
 * La pantalla de acceso denegado.
 *
 * Dice el MOTIVO, no solo que no. «No tiene permiso» y «este registro está
 * fuera de los transportistas asignados a usted» mandan a la persona a sitios
 * distintos: la primera a pedir un permiso, la segunda a pedir una asignación.
 * Confundirlas cuesta una llamada a soporte.
 *
 * Va dentro del armazón para que el menú siga ahí: quien llega aquí necesita
 * poder irse a otra parte sin usar el botón de atrás.
 */
export default function Denied({ reason, permission }: { reason: string; permission: string | null }) {
  const { t } = useI18n()

  return (
    <AppLayout
      title={t('common.states.permissionDenied')}
      crumbs={[{ label: t('common.states.permissionDenied') }]}
    >
      <div className="max-w-xl rounded border border-steel-200 bg-white p-8">
        <p className="text-sm text-carbon">{reason}</p>
        <p className="mt-2 text-sm text-steel-700">{t('common.states.permissionDeniedHint')}</p>

        {permission ? (
          <p className="mt-4 text-xs text-steel-600">
            {/* La clave del permiso, para que quien pida ayuda pueda decir
                exactamente cuál le falta en vez de describir la pantalla. */}
            <code className="rounded bg-navy-50 px-1.5 py-0.5">{permission}</code>
          </p>
        ) : null}

        <Link
          href="/home"
          className="mt-6 inline-block rounded bg-navy-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-navy-800"
        >
          {t('nav.primary.dashboard')}
        </Link>
      </div>
    </AppLayout>
  )
}
