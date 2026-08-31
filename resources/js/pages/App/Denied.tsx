import { Link, usePage } from '@inertiajs/react'
import { AppLayout } from '@/layouts/AppLayout'
import { useI18n } from '@/lib/i18n'
import type { SharedProps } from '@/types'

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
  // El correo de soporte de la empresa, si lo han puesto. Es justo aquí donde
  // hace falta: «consulte con un administrador» es un consejo sin destinatario,
  // y quien acaba de chocarse con una puerta quiere una dirección, no un
  // sustantivo.
  const { shell } = usePage<SharedProps>().props
  const soporte = shell?.supportEmail ?? null

  return (
    <AppLayout
      title={t('common.states.permissionDenied')}
      crumbs={[{ label: t('common.states.permissionDenied') }]}
    >
      <div className="max-w-xl rounded border border-steel-200 bg-white p-8">
        <p className="text-sm text-carbon">{reason}</p>

        {/* Una cosa o la otra, nunca las dos. Con las dos se leía «consulte con
            un administrador si cree que debería tenerlo» seguido de «si cree que
            debería tener acceso, escriba a soporte@…»: la misma frase dicha dos
            veces, y la segunda dejando en evidencia que la primera no servía. */}
        {soporte !== null ? (
          <ContactoDeSoporte email={soporte} />
        ) : (
          <p className="mt-2 text-sm text-steel-700">{t('common.states.permissionDeniedHint')}</p>
        )}

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

/**
 * La frase de contacto, con la dirección como enlace.
 *
 * Se parte la traducción por el hueco `{email}` en vez de concatenar trozos:
 * una frase troceada en «escribe a» + dirección obliga a cada idioma a poner el
 * correo al final, y no todos lo hacen. Así el traductor decide dónde va.
 */
function ContactoDeSoporte({ email }: { email: string }) {
  const { t } = useI18n()
  const [antes, despues] = t('common.states.supportContact', { email: '\u0000' }).split('\u0000')

  return (
    <p className="mt-2 text-sm text-steel-700">
      {antes}
      <a href={`mailto:${email}`} className="font-medium text-navy-700 hover:underline">
        {email}
      </a>
      {despues}
    </p>
  )
}
