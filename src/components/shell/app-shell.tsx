'use client'

import * as React from 'react'
import { Menu, Truck } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { Actor, TenantPolicy } from '@/lib/permissions'
import { useTranslate } from '@/components/providers/i18n-provider'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { SidebarNav, type SidebarNavGroupDef } from './sidebar-nav'
import { MobileNav, type MobileNavItem } from './mobile-nav'
import { TopBar, type TopBarProps } from './top-bar'
import { ImpersonationBanner, type ImpersonationBannerProps } from './impersonation-banner'
import { GlobalSearch, type GlobalSearchProps } from './global-search'

export interface AppShellProps {
  actor: Actor
  policy?: TenantPolicy | null
  activePath: string
  sidebarGroups: SidebarNavGroupDef[]
  mobileNavItems: MobileNavItem[]
  LinkComponent?: React.ElementType
  logoIcon?: LucideIcon
  appName: string
  topBar: Omit<TopBarProps, 'onOpenSearch' | 'LinkComponent'>
  search: Omit<GlobalSearchProps, 'open' | 'onOpenChange'>
  impersonation?: Omit<ImpersonationBannerProps, 'children'>
  children: React.ReactNode
}

/**
 * The application shell: desktop sidebar + main region, mobile drawer +
 * bottom tab bar, skip-to-content link, and the global search overlay wired
 * to the `/` shortcut.
 */
export function AppShell({
  actor,
  policy,
  activePath,
  sidebarGroups,
  mobileNavItems,
  LinkComponent = 'a',
  logoIcon: LogoIcon = Truck,
  appName,
  topBar,
  search,
  impersonation,
  children,
}: AppShellProps) {
  const t = useTranslate()
  const [drawerOpen, setDrawerOpen] = React.useState(false)
  const [searchOpen, setSearchOpen] = React.useState(false)

  React.useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      const isTyping = target && ['INPUT', 'TEXTAREA'].includes(target.tagName)
      if (event.key === '/' && !isTyping && !event.metaKey && !event.ctrlKey) {
        event.preventDefault()
        setSearchOpen(true)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main-content" className="sr-only-focusable fixed left-2 top-2 z-[200] rounded-md bg-navy-700 px-4 py-2 text-sm font-semibold text-white">
        {t('nav.skipToContent')}
      </a>

      {impersonation ? <ImpersonationBanner {...impersonation} /> : null}

      <div className="flex flex-1 overflow-hidden">
        {/* Desktop sidebar */}
        <aside className="hidden w-60 shrink-0 flex-col bg-navy-700 lg:flex">
          <div className="flex h-14 items-center gap-2 border-b border-white/10 px-4">
            <LogoIcon className="size-5 text-safety-500" aria-hidden="true" />
            <span className="truncate font-heading text-sm font-bold text-white">{appName}</span>
          </div>
          <SidebarNav
            groups={sidebarGroups}
            actor={actor}
            policy={policy}
            activePath={activePath}
            LinkComponent={LinkComponent}
            className="flex-1 py-2"
          />
        </aside>

        {/* Mobile drawer */}
        <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
          <SheetContent side="left" closeLabel={t('common.actions.close')} className="w-72 bg-navy-700 p-0">
            <div className="flex h-14 items-center gap-2 border-b border-white/10 px-4">
              <LogoIcon className="size-5 text-safety-500" aria-hidden="true" />
              <span className="truncate font-heading text-sm font-bold text-white">{appName}</span>
            </div>
            <SidebarNav
              groups={sidebarGroups}
              actor={actor}
              policy={policy}
              activePath={activePath}
              LinkComponent={LinkComponent}
              className="py-2"
            />
          </SheetContent>
        </Sheet>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center border-b border-steel-200 bg-white lg:hidden">
            <Button
              variant="ghost"
              size="icon"
              className="m-1"
              aria-label={t('nav.openMenu')}
              onClick={() => setDrawerOpen(true)}
            >
              <Menu aria-hidden="true" />
            </Button>
            <div className="flex-1">
              <TopBar {...topBar} LinkComponent={LinkComponent} onOpenSearch={() => setSearchOpen(true)} />
            </div>
          </div>
          <div className="hidden lg:block">
            <TopBar {...topBar} LinkComponent={LinkComponent} onOpenSearch={() => setSearchOpen(true)} />
          </div>

          <main id="main-content" tabIndex={-1} className="flex-1 overflow-y-auto bg-[var(--surface-subtle)] p-4 pb-20 lg:pb-4">
            {children}
          </main>

          <MobileNav
            items={mobileNavItems}
            actor={actor}
            policy={policy}
            activePath={activePath}
            LinkComponent={LinkComponent}
            className="fixed inset-x-0 bottom-0 z-20 lg:hidden"
          />
        </div>
      </div>

      <GlobalSearch {...search} open={searchOpen} onOpenChange={setSearchOpen} />
    </div>
  )
}
