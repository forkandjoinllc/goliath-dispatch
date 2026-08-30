import { Link } from '@inertiajs/react'
import { AppLayout } from '@/layouts/AppLayout'
import { useI18n } from '@/lib/i18n'

/**
 * La empresa está suspendida.
 *
 * Va dentro del armazón a propósito, igual que la de acceso denegado: quien
 * llega aquí tiene que poder cerrar sesión o cambiarse a otra empresa sin usar
 * el botón de atrás. Una pantalla sin salidas convierte una suspensión
 * administrativa en una sensación de avería.
 *
 * Dice qué hacer y a quién escribir. «No tiene acceso» a secas manda a la gente
 * a soporte a preguntar algo que se podía haber contestado aquí.
 */
export default function Suspended() {
  const { t } = useI18n()

  return (
    <AppLayout title={t('platform.suspended.title')} crumbs={[{ label: t('platform.suspended.title') }]}>
      <div className="mx-auto max-w-2xl rounded border border-warning-300 bg-warning-50 p-8">
        <h1 className="font-display text-2xl font-bold text-carbon">{t('platform.suspended.title')}</h1>
        <p className="mt-2 text-sm text-carbon">{t('platform.suspended.body')}</p>
        <p className="mt-4 text-sm text-steel-700">{t('platform.suspended.contact')}</p>

        <div className="mt-6 flex flex-wrap gap-4 text-sm">
          <Link href="/logout" method="post" as="button" className="text-navy-700 underline">
            {t('platform.suspended.signOut')}
          </Link>
        </div>
      </div>
    </AppLayout>
  )
}
