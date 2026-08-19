import {
  Banknote,
  Building2,
  ClipboardCheck,
  Container,
  FileSignature,
  FileText,
  Gauge,
  History,
  IdCard,
  LayoutDashboard,
  MapPinned,
  MessageSquare,
  Receipt,
  Route,
  ScrollText,
  Settings,
  ShieldCheck,
  Truck,
  Users,
  UsersRound,
  Wallet,
  type LucideIcon,
} from 'lucide-react'

/**
 * Every icon the app shell's navigation (`_nav.ts`, `SidebarNav`,
 * `MobileNav`) can reference, keyed by name.
 *
 * `_nav.ts`'s `buildSidebarGroups`/`buildMobileNav` run in a Server
 * Component (`app/layout.tsx`) and their result is passed as a prop into
 * `SidebarNav`/`MobileNav`, both `'use client'`. A `LucideIcon` value is a
 * component reference (a function) — React's server/client boundary can
 * only carry plain serializable data across that prop, not a function, so
 * passing the icon component itself crashed every single authenticated page
 * with "Functions cannot be passed directly to Client Components" the
 * instant a real browser rendered past login. Passing this map's string
 * keys instead (`NavIconName`) and letting each client component resolve
 * the actual component from `NAV_ICONS` locally fixes that at the root.
 */
export const NAV_ICONS = {
  Banknote,
  Building2,
  ClipboardCheck,
  Container,
  FileSignature,
  FileText,
  Gauge,
  History,
  IdCard,
  LayoutDashboard,
  MapPinned,
  MessageSquare,
  Receipt,
  Route,
  ScrollText,
  Settings,
  ShieldCheck,
  Truck,
  Users,
  UsersRound,
  Wallet,
} satisfies Record<string, LucideIcon>

export type NavIconName = keyof typeof NAV_ICONS
