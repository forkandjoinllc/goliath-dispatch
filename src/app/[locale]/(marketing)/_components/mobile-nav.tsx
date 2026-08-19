'use client'

import * as React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Menu } from 'lucide-react'
import { Sheet, SheetClose, SheetContent } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import type { MarketingNavLink } from './nav-links'

/**
 * The only client component in the header. Everything else — logo, desktop
 * nav, language switcher — renders server-side; this drawer needs open/close
 * state and Escape/focus-trap behavior, which is why it's isolated here
 * rather than making the whole header a client component.
 */
export function MobileNav({
  links,
  openLabel,
  closeLabel,
  navLabel,
  ctaHref,
  ctaLabel,
}: {
  links: MarketingNavLink[]
  openLabel: string
  closeLabel: string
  navLabel: string
  ctaHref: string
  ctaLabel: string
}) {
  const [open, setOpen] = React.useState(false)
  const pathname = usePathname()

  React.useEffect(() => {
    setOpen(false)
  }, [pathname])

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <Button
        variant="ghost"
        size="icon"
        aria-label={openLabel}
        className="md:hidden"
        onClick={() => setOpen(true)}
      >
        <Menu aria-hidden="true" />
      </Button>
      <SheetContent side="right" aria-label={navLabel} closeLabel={closeLabel} className="w-4/5 max-w-xs gap-6">
        <nav aria-label={navLabel} className="mt-8 flex flex-col gap-1">
          {links.map((link) => (
            <SheetClose asChild key={link.href}>
              <Link
                href={link.href}
                className="rounded-md px-3 py-3 text-base font-semibold text-navy-700 hover:bg-navy-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
              >
                {link.label}
              </Link>
            </SheetClose>
          ))}
        </nav>
        <SheetClose asChild>
          <Button asChild variant="accent" size="lg">
            <Link href={ctaHref}>{ctaLabel}</Link>
          </Button>
        </SheetClose>
      </SheetContent>
    </Sheet>
  )
}
