import { Link, usePage } from '@inertiajs/react'
import { AppLayout } from '@/layouts/AppLayout'
import { useI18n } from '@/lib/i18n'
import type { SharedProps } from '@/types'

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
 *
 * Y hasta el lote 55 lo decía a medias: el comentario prometía «a quién
 * escribir» y la pantalla enseñaba «póngase en contacto con Goliath Dispatch»,
 * sin dirección. El correo de soporte se editaba en configuración y no se
 * enseñaba en ningún sitio.
 */
export default function Suspended() {
  const { t } = useI18n()
  const { shell } = usePage<SharedProps>().props
  const soporte = shell?.supportEmail ?? null

  return (
    <AppLayout title={t('platform.suspended.title')} crumbs={[{ label: t('platform.suspended.title') }]}>
      <div className="mx-auto max-w-2xl rounded border border-warning-300 bg-warning-50 p-8">
        <h1 className="font-display text-2xl font-bold text-carbon">{t('platform.suspended.title')}</h1>
        <p className="mt-2 text-sm text-carbon">{t('platform.suspended.body')}</p>
        <p className="mt-4 text-sm text-steel-700">{t('platform.suspended.contact')}</p>

        {soporte !== null ? <ContactoDeSoporte email={soporte} /> : null}

        <div className="mt-6 flex flex-wrap gap-4 text-sm">
          <Link href="/logout" method="post" as="button" className="text-navy-700 underline">
            {t('platform.suspended.signOut')}
          </Link>
        </div>
      </div>
    </AppLayout>
  )
}

/** La frase de contacto, con la dirección como enlace. Ver App/Denied.tsx. */
function ContactoDeSoporte({ email }: { email: string }) {
  const { t } = useI18n()
  const [antes, despues] = t('common.states.supportContactGeneric', { email: '\u0000' }).split('\u0000')

  return (
    <p className="mt-1 text-sm text-steel-700">
      {antes}
      <a href={`mailto:${email}`} className="font-medium text-navy-700 hover:underline">
        {email}
      </a>
      {despues}
    </p>
  )
}
