/**
 * Message namespaces. Splitting by feature keeps each JSON file reviewable and
 * lets a page load only what it renders.
 */
export const NAMESPACES = [
  'common',
  'nav',
  'auth',
  'errors',
  'validation',
  'marketing',
  'onboarding',
  'carrier',
  'document',
  'signature',
  'equipment',
  'driver',
  'assignment',
  'customer',
  'load',
  'tracking',
  'oversize',
  'finance',
  'report',
  'settings',
  'notification',
  'platform',
] as const

export type Namespace = (typeof NAMESPACES)[number]
