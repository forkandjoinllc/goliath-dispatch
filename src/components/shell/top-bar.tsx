'use client'

import * as React from 'react'
import { Bell, Building2, ChevronsUpDown, LogOut, Search, Settings, ShieldCheck, User } from 'lucide-react'
import { Breadcrumb, type BreadcrumbItem } from '@/components/ui/breadcrumb'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useTranslate } from '@/components/providers/i18n-provider'
import { initialsOf } from '@/lib/utils'
import { LanguageSwitcher } from './language-switcher'
import type { Locale } from '@/i18n/config'

export interface TopBarUser {
  firstName: string
  lastName: string
  email: string
  avatarUrl?: string | null
}

export interface TenantOption {
  id: string
  name: string
}

export interface TopBarProps {
  breadcrumb?: BreadcrumbItem[]
  homeLabel?: string
  homeHref?: string
  LinkComponent?: React.ElementType
  user: TopBarUser
  locale: Locale
  unreadNotificationCount?: number
  onOpenSearch: () => void
  onOpenNotifications?: () => void
  onProfile?: () => void
  onSecurity?: () => void
  onPreferences?: () => void
  onSignOut: () => void
  /** Present only for a Platform Super Admin. */
  tenantSwitcher?: { current: TenantOption; options: TenantOption[]; onSwitch: (tenantId: string) => void }
  className?: string
}

export function TopBar({
  breadcrumb,
  homeLabel,
  homeHref,
  LinkComponent,
  user,
  locale,
  unreadNotificationCount = 0,
  onOpenSearch,
  onOpenNotifications,
  onProfile,
  onSecurity,
  onPreferences,
  onSignOut,
  tenantSwitcher,
  className,
}: TopBarProps) {
  const t = useTranslate()

  return (
    <header className={`flex h-14 items-center gap-3 border-b border-steel-200 bg-white px-4 ${className ?? ''}`}>
      <div className="min-w-0 flex-1">
        {breadcrumb && breadcrumb.length > 0 ? (
          <Breadcrumb items={breadcrumb} homeLabel={homeLabel} homeHref={homeHref} LinkComponent={LinkComponent} />
        ) : null}
      </div>

      <button
        type="button"
        onClick={onOpenSearch}
        className="hidden items-center gap-2 rounded-md border border-steel-300 bg-steel-50 px-3 py-1.5 text-sm text-steel-600 transition-colors hover:border-steel-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)] sm:flex"
      >
        <Search className="size-4" aria-hidden="true" />
        <span>{t('nav.search.placeholder')}</span>
        <kbd className="ml-4 rounded border border-steel-300 bg-white px-1.5 py-0.5 text-xs font-semibold">/</kbd>
      </button>
      <Button variant="ghost" size="icon" aria-label={t('nav.search.placeholder')} onClick={onOpenSearch} className="sm:hidden">
        <Search aria-hidden="true" />
      </Button>

      {tenantSwitcher ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary" size="sm">
              <Building2 aria-hidden="true" />
              <span className="hidden max-w-[10rem] truncate md:inline">{tenantSwitcher.current.name}</span>
              <ChevronsUpDown className="size-3.5" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>{t('nav.primary.tenants')}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {tenantSwitcher.options.map((tenant) => (
              <DropdownMenuItem
                key={tenant.id}
                onSelect={() => tenantSwitcher.onSwitch(tenant.id)}
                aria-current={tenant.id === tenantSwitcher.current.id}
              >
                {tenant.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      {onOpenNotifications ? (
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={t('nav.primary.notifications')}
          onClick={onOpenNotifications}
        >
          <Bell aria-hidden="true" />
          {unreadNotificationCount > 0 ? (
            <Badge
              tone="danger"
              className="absolute -right-1 -top-1 min-w-4 justify-center px-1 py-0"
              aria-label={String(unreadNotificationCount)}
            >
              {unreadNotificationCount > 99 ? '99+' : unreadNotificationCount}
            </Badge>
          ) : null}
        </Button>
      ) : null}

      <LanguageSwitcher currentLocale={locale} label={t('common.labels.language')} />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex items-center gap-2 rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
            aria-label={`${user.firstName} ${user.lastName}`}
          >
            <Avatar>
              {user.avatarUrl ? <AvatarImage src={user.avatarUrl} alt="" /> : null}
              <AvatarFallback>{initialsOf(user.firstName, user.lastName)}</AvatarFallback>
            </Avatar>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>
            {user.firstName} {user.lastName}
            <p className="text-xs font-normal text-steel-500">{user.email}</p>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {onProfile ? (
            <DropdownMenuItem onSelect={onProfile}>
              <User className="size-4" aria-hidden="true" />
              {t('nav.userMenu.profile')}
            </DropdownMenuItem>
          ) : null}
          {onSecurity ? (
            <DropdownMenuItem onSelect={onSecurity}>
              <ShieldCheck className="size-4" aria-hidden="true" />
              {t('nav.userMenu.security')}
            </DropdownMenuItem>
          ) : null}
          {onPreferences ? (
            <DropdownMenuItem onSelect={onPreferences}>
              <Settings className="size-4" aria-hidden="true" />
              {t('nav.userMenu.preferences')}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onSignOut} destructive>
            <LogOut className="size-4" aria-hidden="true" />
            {t('nav.userMenu.signOut')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  )
}
