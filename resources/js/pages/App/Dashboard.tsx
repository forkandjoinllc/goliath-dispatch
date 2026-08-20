import { Head, Link, router, usePage } from '@inertiajs/react'
import { useI18n } from '@/lib/i18n'
import type { SharedProps } from '@/types'

interface Permission {
  key: string
  action: string
  scope: string | null
  description: string
}

interface Props {
  actor: {
    name: string
    email: string
    role: string | null
    isPlatformSuperAdmin: boolean
    tenantId: string | null
    mfaRequired: boolean
    mfaSatisfied: boolean
  }
  tenant: { display_name: string; slug: string; status: string } | null
  memberships: { id: string; name: string; role: string }[]
  permissions: Record<string, Permission[]>
  totals: { granted: number; catalog: number; roleGrants: number }
}

/** Cada ámbito con su color. El naranja de marca marca lo más ancho. */
const SCOPE_STYLE: Record<string, string> = {
  platform: 'bg-safety-100 text-safety-800',
  tenant: 'bg-navy-100 text-navy-800',
  assigned: 'bg-steel-100 text-steel-800',
  carrier: 'bg-steel-100 text-steel-800',
  own: 'bg-steel-100 text-steel-700',
}

export default function Dashboard({ actor, tenant, memberships, permissions, totals }: Props) {
  const { t, locale } = useI18n()
  const { props } = usePage<SharedProps>()

  const resources = Object.keys(permissions)

  return (
    <>
      <Head title={actor.role ?? 'Goliath Dispatch'} />

      <div className="min-h-dvh bg-navy-50">
        <header className="border-b border-steel-200 bg-white">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-4 py-3 sm:px-6">
            <Link href={`/${locale}`}>
              <img
                src="/brand/logo-primary.png"
                srcSet="/brand/logo-primary.png 1x, /brand/logo-primary@2x.png 2x"
                alt="Goliath Dispatch"
                width={168}
                height={40}
                className="h-8 w-auto"
              />
            </Link>

            <div className="ml-auto flex items-center gap-4">
              <div className="text-right">
                <p className="text-sm font-medium text-carbon">{actor.name}</p>
                <p className="text-xs text-steel-600">{actor.email}</p>
              </div>

              <Link
                href="/logout"
                method="post"
                as="button"
                className="rounded border border-steel-300 px-3 py-2 text-sm font-medium text-navy-700 transition hover:bg-navy-50"
              >
                {t('common.actions.signOut')}
              </Link>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
          {/* Quién eres y dónde estás actuando */}
          <section className="rounded border border-steel-200 bg-white p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="uppercase-heading text-xs text-steel-600">
                  {tenant ? tenant.display_name : 'Goliath Dispatch'}
                </p>
                <h1 className="mt-2 font-display text-3xl font-bold text-navy-700">
                  {actor.role
                    ? actor.role.replace(/_/g, ' ')
                    : actor.isPlatformSuperAdmin
                      ? 'platform super admin'
                      : '—'}
                </h1>
                {tenant ? (
                  <p className="mt-1 text-sm text-steel-700">
                    <code className="rounded bg-navy-50 px-1.5 py-0.5 text-xs">{tenant.slug}</code>{' '}
                    · {tenant.status}
                  </p>
                ) : (
                  // Sin empresa activa no es un error: el Super Admin de
                  // plataforma no pertenece a ninguna, y un usuario con varias
                  // aún no ha elegido.
                  <p className="mt-1 text-sm text-steel-700">
                    {actor.isPlatformSuperAdmin
                      ? 'Ámbito de plataforma — sin empresa activa'
                      : 'Sin empresa activa'}
                  </p>
                )}
              </div>

              <dl className="flex gap-6 text-right">
                <div>
                  <dt className="text-xs text-steel-600">permisos</dt>
                  <dd className="font-display text-2xl font-bold text-navy-700">{totals.granted}</dd>
                </div>
                <div>
                  <dt className="text-xs text-steel-600">catálogo</dt>
                  <dd className="font-display text-2xl font-bold text-steel-500">{totals.catalog}</dd>
                </div>
              </dl>
            </div>

            {actor.mfaRequired && !actor.mfaSatisfied ? (
              <p role="alert" className="mt-4 rounded border-l-4 border-safety-500 bg-safety-50 p-3 text-sm">
                {t('auth.mfa.required')}
              </p>
            ) : null}
          </section>

          {/* Conmutador de empresa, solo si hay más de una */}
          {memberships.length > 1 ? (
            <section className="mt-6 rounded border border-steel-200 bg-white p-6">
              <h2 className="uppercase-heading text-xs text-steel-600">
                {memberships.length} empresas
              </h2>
              <div className="mt-3 flex flex-wrap gap-2">
                {memberships.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => router.post('/switch-tenant', { tenant_id: m.id })}
                    className={`rounded border px-3 py-2 text-sm transition ${
                      m.id === actor.tenantId
                        ? 'border-safety-600 bg-safety-50 font-medium text-navy-800'
                        : 'border-steel-300 hover:bg-navy-50'
                    }`}
                  >
                    {m.name}{' '}
                    <span className="text-xs text-steel-600">({m.role.replace(/_/g, ' ')})</span>
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          {/* Lo que este rol concede, con su ámbito */}
          <section className="mt-6">
            <h2 className="font-display text-xl font-bold text-navy-700">
              {locale === 'es' ? 'Lo que puede hacer este rol' : 'What this role can do'}
            </h2>

            {resources.length === 0 ? (
              <p className="mt-4 rounded border border-dashed border-steel-300 bg-white p-6 text-sm text-steel-700">
                {t('common.states.permissionDenied')} — {t('common.states.permissionDeniedHint')}
              </p>
            ) : (
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                {resources.map((resource) => (
                  <div key={resource} className="rounded border border-steel-200 bg-white p-5">
                    <h3 className="uppercase-heading text-xs text-safety-600">{resource}</h3>
                    <ul className="mt-3 flex flex-col gap-2">
                      {permissions[resource]!.map((p) => (
                        <li key={p.key} className="flex items-start gap-2 text-sm">
                          <span
                            className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                              SCOPE_STYLE[p.scope ?? 'own'] ?? 'bg-steel-100 text-steel-700'
                            }`}
                          >
                            {p.scope}
                          </span>
                          <span>
                            <span className="font-medium text-carbon">{p.action}</span>
                            <span className="block text-xs text-steel-600">{p.description}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </section>

          <p className="mt-8 text-xs text-steel-600">
            {props.flash.success ?? ''}
          </p>
        </main>
      </div>
    </>
  )
}
