/**
 * Client-side mirror of `src/server/settings/branding.ts`'s pure contrast
 * math, so the live preview can warn *before* submit. Deliberately
 * duplicated rather than imported — client components don't import from
 * `src/server/**`, and this is a few lines of pure arithmetic, not business
 * logic that could drift from the server's own enforcement (which always
 * re-checks on save regardless of what the client shows).
 */
const WCAG_AA_NORMAL_TEXT_RATIO = 4.5

function parseHexColor(hex: string): { r: number; g: number; b: number } | null {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim())
  if (!match) return null
  const value = match[1]!
  return { r: parseInt(value.slice(0, 2), 16), g: parseInt(value.slice(2, 4), 16), b: parseInt(value.slice(4, 6), 16) }
}

function channelLuminance(channel8bit: number): number {
  const c = channel8bit / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function relativeLuminance(color: { r: number; g: number; b: number }): number {
  return 0.2126 * channelLuminance(color.r) + 0.7152 * channelLuminance(color.g) + 0.0722 * channelLuminance(color.b)
}

export function contrastRatioAgainstWhite(hex: string): number | null {
  const color = parseHexColor(hex)
  if (!color) return null
  const white = { r: 255, g: 255, b: 255 }
  const la = relativeLuminance(color)
  const lb = relativeLuminance(white)
  const lighter = Math.max(la, lb)
  const darker = Math.min(la, lb)
  return (lighter + 0.05) / (darker + 0.05)
}

export function passesAA(hex: string): boolean {
  const ratio = contrastRatioAgainstWhite(hex)
  return ratio !== null && ratio >= WCAG_AA_NORMAL_TEXT_RATIO
}
