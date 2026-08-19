/**
 * Branding colour contrast check.
 *
 * WCAG 2.1 requires a 4.5:1 contrast ratio for normal text. The branding
 * screen renders the tenant's chosen text/accent colours against a white
 * surface (the default `surfaceColor`), so this checks each candidate colour
 * against pure white and returns the ratio the UI shows next to a live
 * preview swatch.
 */

export interface HexColor {
  r: number
  g: number
  b: number
}

export function parseHexColor(hex: string): HexColor | null {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim())
  if (!match) return null
  const value = match[1]!
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  }
}

function channelLuminance(channel8bit: number): number {
  const c = channel8bit / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

export function relativeLuminance(color: HexColor): number {
  return 0.2126 * channelLuminance(color.r) + 0.7152 * channelLuminance(color.g) + 0.0722 * channelLuminance(color.b)
}

export function contrastRatio(a: HexColor, b: HexColor): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const lighter = Math.max(la, lb)
  const darker = Math.min(la, lb)
  return (lighter + 0.05) / (darker + 0.05)
}

const WHITE: HexColor = { r: 255, g: 255, b: 255 }

export const WCAG_AA_NORMAL_TEXT_RATIO = 4.5

/** Contrast ratio of `hex` against a white surface. Returns `null` for an unparsable value. */
export function contrastRatioAgainstWhite(hex: string): number | null {
  const color = parseHexColor(hex)
  if (!color) return null
  return contrastRatio(color, WHITE)
}

export interface ContrastCheckResult {
  ratio: number | null
  passesAA: boolean
}

export function checkContrastAgainstWhite(hex: string): ContrastCheckResult {
  const ratio = contrastRatioAgainstWhite(hex)
  return { ratio, passesAA: ratio !== null && ratio >= WCAG_AA_NORMAL_TEXT_RATIO }
}
