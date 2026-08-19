import { beforeEach, describe, expect, it } from 'vitest'
import { MockEmailAdapter, clearOutbox, readOutbox } from '@/integrations/email/mock-adapter'
import { renderEmailShell } from '@/integrations/email/templates'

describe('MockEmailAdapter outbox', () => {
  beforeEach(() => clearOutbox())

  it('records a sent message and clears on demand', async () => {
    const adapter = new MockEmailAdapter()
    const result = await adapter.send({
      to: 'dispatcher@example.com',
      subject: 'Load 1042 dispatched',
      html: '<p>Hi</p>',
      text: 'Hi',
      tags: ['load-dispatched'],
    })

    expect(result.providerMessageId).toMatch(/^mock-email-/)
    expect(readOutbox()).toHaveLength(1)
    expect(readOutbox()[0]).toMatchObject({ to: 'dispatcher@example.com', subject: 'Load 1042 dispatched' })

    clearOutbox()
    expect(readOutbox()).toHaveLength(0)
  })

  it('records multiple messages independently', async () => {
    const adapter = new MockEmailAdapter()
    await adapter.send({ to: 'a@example.com', subject: 'A', html: '<p>A</p>', text: 'A' })
    await adapter.send({ to: 'b@example.com', subject: 'B', html: '<p>B</p>', text: 'B' })
    expect(readOutbox().map((m) => m.to)).toEqual(['a@example.com', 'b@example.com'])
  })
})

describe('renderEmailShell', () => {
  it('wraps body content in the branded shell without introducing hard-coded copy', () => {
    const { html, text } = renderEmailShell({
      locale: 'es',
      branding: {
        tenantDisplayName: 'Summit Heavy Haul',
        contactEmail: 'ops@summitheavyhaul.com',
        contactPhone: '(512) 555-1234',
      },
      bodyHtml: '<p>Cuerpo del mensaje.</p>',
      bodyText: 'Cuerpo del mensaje.',
      strings: { footerLine: 'Responda a este correo si tiene preguntas.' },
    })

    expect(html).toContain('lang="es"')
    expect(html).toContain('Summit Heavy Haul')
    expect(html).toContain('Cuerpo del mensaje.')
    expect(html).toContain('ops@summitheavyhaul.com')
    expect(html).toContain('Responda a este correo si tiene preguntas.')
    // Layout chrome (header band + orange rule) is present.
    expect(html).toContain('#FF5A00')

    expect(text).toContain('Cuerpo del mensaje.')
    expect(text).toContain('Summit Heavy Haul')
    expect(text).toContain('ops@summitheavyhaul.com')
  })

  it('escapes HTML in branding fields to avoid injection from tenant-controlled data', () => {
    const { html } = renderEmailShell({
      locale: 'en',
      branding: { tenantDisplayName: '<script>alert(1)</script>' },
      bodyHtml: '<p>Body</p>',
      bodyText: 'Body',
    })
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
  })
})
