import * as React from 'react'
import { render, type RenderOptions } from '@testing-library/react'
import { I18nProvider } from '@/components/providers/i18n-provider'
import { ToastProvider } from '@/components/ui/toast'
import type { Dictionary, MessageTree } from '@/i18n/dictionary'
import commonEn from '@/i18n/messages/en/common.json'
import navEn from '@/i18n/messages/en/nav.json'
import documentEn from '@/i18n/messages/en/document.json'
import authEn from '@/i18n/messages/en/auth.json'
import errorsEn from '@/i18n/messages/en/errors.json'
import validationEn from '@/i18n/messages/en/validation.json'

/**
 * A real (English) dictionary assembled from the namespaces the components
 * under test actually resolve keys from — not a mock translator — so these
 * tests catch a missing/renamed i18n key the same way production would.
 */
export const testDictionary: Dictionary = {
  common: commonEn as unknown as MessageTree,
  nav: navEn as unknown as MessageTree,
  document: documentEn as unknown as MessageTree,
  auth: authEn as unknown as MessageTree,
  errors: errorsEn as unknown as MessageTree,
  validation: validationEn as unknown as MessageTree,
}

export function AllProviders({ children }: { children: React.ReactNode }) {
  return (
    <I18nProvider locale="en" timezone="America/Chicago" dictionary={testDictionary}>
      <ToastProvider>{children}</ToastProvider>
    </I18nProvider>
  )
}

export function renderWithProviders(ui: React.ReactElement, options?: Omit<RenderOptions, 'wrapper'>) {
  return render(ui, { wrapper: AllProviders, ...options })
}

export * from '@testing-library/react'
