import { Link } from '@inertiajs/react'
import { AddressBlock } from '@/components/Marketing/AddressBlock'
import { useI18n } from '@/lib/i18n'
import type { MarketingNav } from '@/types/marketing'

function LinkColumn({ heading, links }: { heading: string; links: MarketingNav['footerProduct'] }) {
  const { t } = useI18n()

  return (
    <div>
      <h2 className="uppercase-heading text-xs text-steel-300">{heading}</h2>
      <ul className="mt-4 flex flex-col gap-2">
        {links.map((link) => (
          <li key={link.route}>
            <Link href={link.href} className="text-sm text-steel-100 transition hover:text-white">
              {t(link.labelKey)}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function Footer({ nav, year }: { nav: MarketingNav; year: number }) {
  const { t } = useI18n()

  return (
    <footer className="bg-navy-700 text-white">
      {/* La franja de peligro cita la identidad sin gritar: 4 px arriba del pie,
          el mismo patrón que marca una carga sobredimensionada en la app. */}
      <div className="hazard-stripe-sm h-1" aria-hidden="true" />

      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid gap-10 md:grid-cols-2 lg:grid-cols-4">
          <div>
            <img
              src="/brand/logo-reversed.png"
              srcSet="/brand/logo-reversed.png 1x, /brand/logo-reversed@2x.png 2x"
              alt="Goliath Dispatch"
              width={168}
              height={40}
              className="h-9 w-auto"
            />
            <p className="mt-4 max-w-xs text-sm text-steel-100">{t('marketing.footer.tagline')}</p>

            {/* El domicilio va bajo el logo porque es donde lo busca quien lo
                busca: un cliente comprobando con quién está tratando, o una
                gestoría buscando a quién dirigir un papel. */}
            <div className="mt-6">
              <h2 className="uppercase-heading text-xs text-steel-300">
                {t('marketing.company.officeHeading')}
              </h2>
              <div className="mt-2">
                <AddressBlock tone="dark" />
              </div>
            </div>
          </div>

          <LinkColumn heading={t('marketing.footer.productHeading')} links={nav.footerProduct} />
          <LinkColumn heading={t('marketing.footer.companyHeading')} links={nav.footerCompany} />
          <LinkColumn heading={t('marketing.footer.legalHeading')} links={nav.footerLegal} />
        </div>

        <div className="mt-10 border-t border-navy-600 pt-6">
          <p className="text-xs text-steel-200">{t('marketing.footer.copyright', { year })}</p>
        </div>
      </div>
    </footer>
  )
}
