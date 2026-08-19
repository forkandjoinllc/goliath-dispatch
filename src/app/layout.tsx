import type { Metadata, Viewport } from 'next'
import './globals.css'

/**
 * Root layout. The real document shell lives in `app/[locale]/layout.tsx`,
 * which knows the language; this exists only to satisfy the App Router and to
 * declare viewport/theme metadata that is locale-independent.
 */

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'),
  title: { default: 'Goliath Dispatch', template: '%s · Goliath Dispatch' },
  applicationName: 'Goliath Dispatch',
  formatDetection: { telephone: false },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#062B5C' },
    { media: '(prefers-color-scheme: dark)', color: '#041A36' },
  ],
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return children
}
