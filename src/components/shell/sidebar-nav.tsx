'use client'

import * as React from 'react'
import { ChevronDown } from 'lucide-react'
import { canAny, type Actor, type PermissionKey, type TenantPolicy } from '@/lib/permissions'
import { useTranslate } from '@/components/providers/i18n-provider'
import { cn } from '@/lib/utils'
import { NAV_ICONS, type NavIconName } from './nav-icons'

export interface SidebarNavItem {
  /** Looked up as `nav.primary.<key>`. */
  key: string
  href: string
  /** Resolved against `NAV_ICONS` — see that module's doc comment for why this is a name, not the icon component itself. */
  icon: NavIconName
  /** Any one of these permissions makes the item visible. Omit for always-visible items. */
  permission?: PermissionKey | PermissionKey[]
  badge?: React.ReactNode
}

export interface SidebarNavGroupDef {
  /** Looked up as `nav.groups.<key>`. */
  key: string
  items: SidebarNavItem[]
}

export interface SidebarNavProps {
  groups: SidebarNavGroupDef[]
  actor: Actor
  policy?: TenantPolicy | null
  activePath: string
  LinkComponent?: React.ElementType
  className?: string
}

/**
 * Grouped, permission-filtered navigation. `can()` here controls visibility
 * only — the server action behind every route re-checks — but a link the
 * actor cannot use is simply never rendered.
 */
export function SidebarNav({
  groups,
  actor,
  policy,
  activePath,
  LinkComponent = 'a',
  className,
}: SidebarNavProps) {
  const t = useTranslate()
  const [collapsed, setCollapsed] = React.useState<Record<string, boolean>>({})

  const visibleGroups = groups
    .map((group) => ({
      ...group,
      items: group.items.filter(
        (item) =>
          !item.permission ||
          canAny(actor, Array.isArray(item.permission) ? item.permission : [item.permission], policy),
      ),
    }))
    .filter((group) => group.items.length > 0)

  return (
    <nav aria-label={t('nav.mainNav')} className={cn('flex flex-col gap-1 overflow-y-auto', className)}>
      {visibleGroups.map((group) => {
        const isCollapsed = collapsed[group.key] ?? false
        const groupId = `sidebar-group-${group.key}`
        return (
          <div key={group.key} className="px-2">
            <button
              type="button"
              aria-expanded={!isCollapsed}
              aria-controls={groupId}
              onClick={() => setCollapsed((c) => ({ ...c, [group.key]: !isCollapsed }))}
              className="flex w-full items-center justify-between rounded-md px-2 py-2 text-xs font-semibold uppercase tracking-wide text-navy-200 transition-colors hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
            >
              {t(`nav.groups.${group.key}`)}
              <ChevronDown
                className={cn('size-3.5 transition-transform', isCollapsed && '-rotate-90')}
                aria-hidden="true"
              />
            </button>
            {!isCollapsed ? (
              <ul id={groupId} className="mt-0.5 space-y-0.5">
                {group.items.map((item) => {
                  const isActive = activePath === item.href || activePath.startsWith(`${item.href}/`)
                  const Icon = NAV_ICONS[item.icon]
                  return (
                    <li key={item.key}>
                      <LinkComponent
                        href={item.href}
                        aria-current={isActive ? 'page' : undefined}
                        className={cn(
                          'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors',
                          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]',
                          isActive
                            ? 'bg-white text-navy-700'
                            : 'text-white/85 hover:bg-white/10 hover:text-white',
                        )}
                      >
                        <Icon className="size-4 shrink-0" aria-hidden="true" />
                        <span className="flex-1 truncate">{t(`nav.primary.${item.key}`)}</span>
                        {item.badge}
                      </LinkComponent>
                    </li>
                  )
                })}
              </ul>
            ) : null}
          </div>
        )
      })}
    </nav>
  )
}
