import { Head, Link } from '@inertiajs/react'
import type { ReactNode } from 'react'
import { useI18n } from '@/lib/i18n'

/**
 * El envoltorio de las pantallas de acceso.
 *
 * Deliberadamente austero comparado con el sitio público: aquí no hay
 * navegación, ni pie, ni enlaces a las páginas de marketing más allá del logo.
 * Quien llega a esta pantalla viene a entrar, y cada enlace de más es una
 * oportunidad de irse.
 */
export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string
  subtitle?: string
  children: ReactNode
  footer?: ReactNode
}) {
  const { locale } = useI18n()

  return (
    <>
      <Head title={title} />

      <div className="flex min-h-dvh flex-col bg-navy-50">
        <div className="hazard-stripe h-1.5" aria-hidden="true" />

        <div className="flex flex-1 items-center justify-center px-4 py-12">
          <div className="w-full max-w-md">
            <Link href={`/${locale}`} className="mb-8 inline-block">
              <img
                src="/brand/logo-primary.png"
                srcSet="/brand/logo-primary.png 1x, /brand/logo-primary@2x.png 2x"
                alt="Goliath Dispatch"
                width={168}
                height={40}
                className="h-9 w-auto"
              />
            </Link>

            <div className="rounded border border-steel-200 bg-white p-8">
              <h1 className="font-display text-2xl font-bold text-navy-700">{title}</h1>
              {subtitle ? <p className="mt-2 text-sm text-steel-700">{subtitle}</p> : null}

              <div className="mt-8">{children}</div>
            </div>

            {footer ? <div className="mt-6 text-center text-sm text-steel-700">{footer}</div> : null}
          </div>
        </div>
      </div>
    </>
  )
}
