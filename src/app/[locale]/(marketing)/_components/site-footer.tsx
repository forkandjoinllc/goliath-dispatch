import Link from 'next/link'
import { Linkedin } from 'lucide-react'
import type { Locale } from '@/i18n/config'
import type { TranslateFn } from '@/i18n/translate'
import { formatPhone } from '@/lib/utils'
import type { MarketingContactBlock } from '@/server/marketing/queries'
import { footerCompanyLinks, footerLegalLinks, footerProductLinks } from './nav-links'

const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const

export function SiteFooter({
  t,
  locale,
  contact,
}: {
  t: TranslateFn
  locale: Locale
  contact: MarketingContactBlock
}) {
  const year = new Date().getFullYear()

  return (
    <footer className="border-t border-steel-200 bg-navy-900 text-steel-200">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid gap-10 md:grid-cols-2 lg:grid-cols-5">
          <div className="lg:col-span-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/logo-full-inverse.svg" alt={t('marketing.illustrations.logoAlt')} className="h-9 w-auto" />
            <p className="mt-4 max-w-sm text-sm text-steel-300">{t('marketing.footer.tagline')}</p>
            <div className="mt-4 flex gap-3">
              {Object.entries(contact.socialLinks).map(([key, href]) => (
                <a
                  key={key}
                  href={href}
                  target="_blank"
                  rel="noreferrer noopener"
                  aria-label={`${t('marketing.footer.followHeading')}: ${key}`}
                  className="rounded-full border border-white/20 p-2 text-white transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
                >
                  <Linkedin className="size-4" aria-hidden="true" />
                </a>
              ))}
            </div>
          </div>

          <nav aria-label={t('marketing.footer.productHeading')}>
            <h2 className="text-sm font-bold uppercase tracking-wide text-white">{t('marketing.footer.productHeading')}</h2>
            <ul className="mt-4 space-y-2 text-sm">
              {footerProductLinks(t, locale).map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)] rounded">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <nav aria-label={t('marketing.footer.companyHeading')}>
            <h2 className="text-sm font-bold uppercase tracking-wide text-white">{t('marketing.footer.companyHeading')}</h2>
            <ul className="mt-4 space-y-2 text-sm">
              {footerCompanyLinks(t, locale).map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)] rounded">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
            <h2 className="mt-6 text-sm font-bold uppercase tracking-wide text-white">{t('marketing.footer.legalHeading')}</h2>
            <ul className="mt-4 space-y-2 text-sm">
              {footerLegalLinks(t, locale).map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)] rounded">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <div>
            <h2 className="text-sm font-bold uppercase tracking-wide text-white">{t('marketing.footer.contactHeading')}</h2>
            <ul className="mt-4 space-y-2 text-sm">
              <li>
                <a href={`tel:${contact.phone.replace(/[^\d+]/g, '')}`} className="hover:text-white">
                  {formatPhone(contact.phone)}
                </a>
              </li>
              <li>
                <a href={`mailto:${contact.email}`} className="hover:text-white">
                  {contact.email}
                </a>
              </li>
              <li className="text-steel-300">
                {contact.addressLine1}
                {contact.addressLine2 ? `, ${contact.addressLine2}` : ''}
                <br />
                {contact.city}, {contact.state} {contact.postalCode}
              </li>
            </ul>

            <h2 className="mt-6 text-sm font-bold uppercase tracking-wide text-white">{t('marketing.footer.hoursHeading')}</h2>
            <ul className="mt-4 space-y-1 text-sm text-steel-300">
              {DAY_ORDER.map((day) => {
                const entry = contact.businessHours.find((h) => h.day === day)
                return (
                  <li key={day} className="flex justify-between gap-4">
                    <span>{t(`marketing.footer.hours.${day}`)}</span>
                    <span>
                      {!entry || entry.closed ? t('marketing.footer.hours.closed') : `${entry.open} – ${entry.close}`}
                    </span>
                  </li>
                )
              })}
            </ul>
          </div>
        </div>

        <div className="mt-10 border-t border-white/10 pt-6 text-xs text-steel-400">
          {t('marketing.footer.copyright', { year })}
        </div>
      </div>
    </footer>
  )
}
