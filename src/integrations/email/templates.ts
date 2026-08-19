import type { Locale } from '@/i18n/config'

/**
 * Dependency-free HTML/text email shell.
 *
 * This module owns layout only — navy header band, orange rule, footer with
 * the tenant's contact block — never copy. Every word of copy (subject,
 * body, and the small chrome strings like a "view in browser" preheader)
 * arrives already localized from the caller, which resolves it through the
 * app's `TranslateFn` (`src/i18n/translate.ts`) against the tenant's locale.
 * That is what "no hard-coded English" means here: grep this file for a
 * literal English word in a template and it's a bug.
 */

export interface EmailBranding {
  tenantDisplayName: string
  /** Hex, e.g. "#062B5C". Falls back to the product navy when absent. */
  primaryColorHex?: string | null
  /** Fully-resolved, publicly-fetchable logo URL (already signed if needed). */
  logoUrl?: string | null
  contactEmail?: string | null
  contactPhone?: string | null
  addressLines?: string[]
}

export interface EmailShellStrings {
  /** Hidden preheader text shown in inbox previews. */
  preheader?: string
  /** Already-localized sentence(s) for the footer, e.g. contact/support copy. */
  footerLine?: string
  /** Already-localized copyright/legal line. */
  legalLine?: string
}

export interface RenderEmailShellInput {
  locale: Locale
  branding: EmailBranding
  bodyHtml: string
  bodyText: string
  strings?: EmailShellStrings
}

export interface RenderedEmail {
  html: string
  text: string
}

const DEFAULT_NAVY = '#062B5C'
const DEFAULT_ORANGE = '#FF5A00'

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function renderEmailShell(input: RenderEmailShellInput): RenderedEmail {
  const { locale, branding, bodyHtml, bodyText, strings } = input
  const navy = branding.primaryColorHex || DEFAULT_NAVY
  const tenantName = escapeHtml(branding.tenantDisplayName)
  const logo = branding.logoUrl
    ? `<img src="${escapeHtml(branding.logoUrl)}" alt="${tenantName}" height="32" style="display:block;border:0;outline:none;" />`
    : `<span style="color:#ffffff;font-family:Helvetica,Arial,sans-serif;font-size:18px;font-weight:600;">${tenantName}</span>`

  const contactParts = [
    ...(branding.addressLines ?? []),
    branding.contactPhone ?? undefined,
    branding.contactEmail ?? undefined,
  ].filter((part): part is string => Boolean(part && part.trim().length > 0))

  const footerContactHtml = contactParts.map((part) => escapeHtml(part)).join('<br/>')

  const html = `<!doctype html>
<html lang="${locale}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${tenantName}</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f4f5f7;">
    ${strings?.preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(strings.preheader)}</div>` : ''}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f5f7;">
      <tr>
        <td align="center" style="padding:24px 12px;">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:8px;overflow:hidden;">
            <tr>
              <td style="background-color:${navy};padding:20px 28px;">${logo}</td>
            </tr>
            <tr>
              <td style="height:4px;background-color:${DEFAULT_ORANGE};font-size:0;line-height:0;">&nbsp;</td>
            </tr>
            <tr>
              <td style="padding:28px;font-family:Helvetica,Arial,sans-serif;color:#111827;font-size:15px;line-height:1.55;">
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:20px 28px;background-color:#f9fafb;border-top:1px solid #e5e7eb;font-family:Helvetica,Arial,sans-serif;color:#6b7280;font-size:12px;line-height:1.6;">
                <div style="font-weight:600;color:#374151;">${tenantName}</div>
                ${footerContactHtml ? `<div style="margin-top:4px;">${footerContactHtml}</div>` : ''}
                ${strings?.footerLine ? `<div style="margin-top:8px;">${escapeHtml(strings.footerLine)}</div>` : ''}
                ${strings?.legalLine ? `<div style="margin-top:8px;">${escapeHtml(strings.legalLine)}</div>` : ''}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`

  const textFooterParts = [
    branding.tenantDisplayName,
    ...contactParts,
    strings?.footerLine,
    strings?.legalLine,
  ].filter((part): part is string => Boolean(part && part.trim().length > 0))

  const text = [bodyText.trim(), '', '—', ...textFooterParts].join('\n')

  return { html, text }
}
