'use client'

import * as React from 'react'
import { canAny, type Actor, type PermissionKey, type TenantPolicy } from '@/lib/permissions'
import { useTranslate } from '@/components/providers/i18n-provider'
import { cn } from '@/lib/utils'
import { NAV_ICONS, type NavIconName } from './nav-icons'

export interface MobileNavItem {
  /** Looked up as `nav.primary.<key>`. */
  key: string
  href: string
  /** Resolved against `NAV_ICONS` — see that module's doc comment for why this is a name, not the icon component itself. */
  icon: NavIconName
  permission?: PermissionKey | PermissionKey[]
}

export interface MobileNavProps {
  items: MobileNavItem[]
  actor: Actor
  policy?: TenantPolicy | null
  activePath: string
  LinkComponent?: React.ElementType
  className?: string
}

/** Bottom tab bar for the carrier/driver personas. Large touch targets, ≤5 items. */
export function MobileNav({ items, actor, policy, activePath, LinkComponent = 'a', className }: MobileNavProps) {
  const t = useTranslate()
  const visible = items
    .filter(
      (item) =>
        !item.permission ||
        canAny(actor, Array.isArray(item.permission) ? item.permission : [item.permission], policy),
    )
    .slice(0, 5)

  return (
    <nav
      aria-label={t('nav.mainNav')}
      className={cn(
        'grid border-t border-steel-200 bg-white pb-[env(safe-area-inset-bottom)]',
        className,
      )}
      style={{ gridTemplateColumns: `repeat(${visible.length}, minmax(0, 1fr))` }}
    >
      {visible.map((item) => {
        const isActive = activePath === item.href || activePath.startsWith(`${item.href}/`)
        const Icon = NAV_ICONS[item.icon]
        return (
          <LinkComponent
            key={item.key}
            href={item.href}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'flex min-h-[44px] flex-col items-center justify-center gap-0.5 py-2 text-xs font-medium transition-colors',
              'focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--focus-ring)]',
              isActive ? 'text-navy-700' : 'text-steel-500',
            )}
          >
            <Icon className={cn('size-5', isActive && 'text-safety-500')} aria-hidden="true" />
            <span className="truncate">{t(`nav.primary.${item.key}`)}</span>
          </LinkComponent>
        )
      })}
    </nav>
  )
}
