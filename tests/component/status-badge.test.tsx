import * as React from 'react'
import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from './test-utils'
import { StatusBadge } from '@/components/status/status-badge'
import { STATUS_REGISTRY, type LoadStatus } from '@/components/status/status-config'
import navEn from '@/i18n/messages/en/nav.json'

const LOAD_STATUSES = Object.keys(STATUS_REGISTRY.load) as LoadStatus[]

describe('StatusBadge', () => {
  it('covers all thirteen load statuses', () => {
    expect(LOAD_STATUSES).toHaveLength(13)
  })

  it.each(LOAD_STATUSES)('renders a translated label and an icon for load status "%s"', (status) => {
    const { container } = renderWithProviders(<StatusBadge kind="load" value={status} />)
    const config = STATUS_REGISTRY.load[status]
    const key = config.i18nKey.replace('nav.', '')
    const expectedLabel = key.split('.').reduce<unknown>((node, segment) => {
      return typeof node === 'object' && node !== null ? (node as Record<string, unknown>)[segment] : undefined
    }, navEn)

    expect(typeof expectedLabel).toBe('string')
    expect(screen.getByText(expectedLabel as string)).toBeInTheDocument()
    expect(container.querySelector('svg')).toBeInTheDocument()
  })
})
