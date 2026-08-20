/**
 * Goliath Dispatch — brand constants for React/TypeScript.
 *
 * Mirrors resources/css/tokens.css exactly. If you change a hex value in
 * one file, change it in the other — nothing here reads the CSS file at
 * build time. When in doubt, the CSS tokens are canonical (Tailwind
 * classes generated from @theme use them directly); this file exists for
 * places that need the raw value in JS — canvas/SVG drawing, chart
 * colours, `<meta theme-color>`, PDF/print generation, etc.
 *
 * See docs/brand.md for the full usage guide, the accessibility rules,
 * and the reasoning behind the bilingual tagline.
 */

/** The four brand colours, unmodified, straight from the brand guide. */
export const BRAND_COLORS = {
  navy: "#062B5C",
  safetyOrange: "#FF5A00",
  steelGray: "#9B9B9B",
  carbon: "#111827",
} as const;

/**
 * Full tint/shade ramps. Generated from BRAND_COLORS by interpolating
 * HSL lightness toward white/black — see resources/css/tokens.css for
 * the generator and rationale. The brand hex lands exactly on the
 * canonical step in each ramp:
 *   navy[700]   === BRAND_COLORS.navy
 *   safety[500] === BRAND_COLORS.safetyOrange
 *   steel[400]  === BRAND_COLORS.steelGray
 */
export const NAVY = {
  50: "#F1F7FD",
  100: "#BED7F8",
  200: "#8AB7F3",
  300: "#5698EF",
  400: "#2078EC",
  500: "#105DC4",
  600: "#0A4490",
  700: "#062B5C",
  800: "#052043",
  900: "#04142A",
  950: "#020912",
} as const;

/**
 * safety[500] is the canonical Safety Orange. Measured contrast against
 * white is ~3.13:1 — below the 4.5:1 WCAG text threshold, above the 3:1
 * UI-boundary/large-text threshold. Use safety[500] for borders, icons,
 * fills, the hazard stripe, and large display type (>=24px, or >=19px
 * bold). Use safety[600] (~5.03:1 on white) for orange body text, orange
 * text on a light background, and for any fill that carries white text
 * (buttons, solid badges). Full measurements: tests/brand/contrast.mjs.
 */
export const SAFETY = {
  50: "#FEF5F0",
  100: "#FCD7C2",
  200: "#FCB893",
  300: "#FC9963",
  400: "#FD7A32",
  500: "#FF5A00",
  600: "#C24602",
  700: "#873103",
  800: "#4D1D02",
  900: "#140701",
} as const;

/**
 * steel[400] is the canonical Steel Gray. Like safety[500], it is a
 * decorative/UI-boundary colour (~2.78:1 on white) — never text. Use
 * steel[600] (~6.19:1 on white) or darker for any steel-family text.
 */
export const STEEL = {
  50: "#F7F7F7",
  100: "#E0E0E0",
  200: "#C9C9C9",
  300: "#B2B2B2",
  400: "#9B9B9B",
  500: "#7E7E7E",
  600: "#616161",
  700: "#444444",
  800: "#272727",
  900: "#0A0A0A",
} as const;

/** Semantic status colours — distinct hues from the brand so a status
 * chip is never mistaken for a brand accent. `500` is for icons/fills/
 * large text; `700` is the text-safe step on white or on the matching
 * `50` tint. Both are verified in tests/brand/contrast.mjs. */
export const STATUS = {
  success: { 50: "#F0FDF4", 500: "#16A34A", 700: "#15803D" },
  warning: { 50: "#FFFBEB", 500: "#F59E0B", 700: "#A16207" },
  danger: { 50: "#FEF2F2", 500: "#DC2626", 700: "#B91C1C" },
  info: { 50: "#F0F9FF", 500: "#0284C7", 700: "#0369A1" },
} as const;

/** Roboto Condensed, self-hosted (public/brand/fonts) — never Google Fonts. */
export const FONT_STACKS = {
  sans: '"Roboto Condensed", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Arial, sans-serif',
  display: '"Roboto Condensed", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Arial, sans-serif',
} as const;

/** Logo and icon assets, relative to the public web root. Pick the
 * variant by background, not by convenience — see docs/brand.md. */
export const LOGO_ASSETS = {
  primary: "/brand/logo-primary.png",
  primary2x: "/brand/logo-primary@2x.png",
  reversed: "/brand/logo-reversed.png",
  reversed2x: "/brand/logo-reversed@2x.png",
  monochrome: "/brand/logo-monochrome.png",
  monochrome2x: "/brand/logo-monochrome@2x.png",
  monochromeWhite: "/brand/logo-monochrome-white.png",
  monochromeWhite2x: "/brand/logo-monochrome-white@2x.png",
  icon: "/brand/icon.svg",
  iconMono: "/brand/icon-mono.svg",
  favicon: "/brand/favicon.svg",
  favicon32: "/brand/favicon-32.png",
  favicon180: "/brand/favicon-180.png",
  icon192: "/brand/icon-192.png",
  icon512: "/brand/icon-512.png",
  iconMaskable512: "/brand/icon-maskable-512.png",
  ogImage: "/brand/og-image.png",
} as const;

/**
 * Minimum digital sizes per the brand guide: 300px wide for the full
 * horizontal lockup, 32px for the icon alone. Below that, drop the
 * tagline before you drop the mark.
 */
export const LOGO_MIN_SIZE_PX = {
  lockup: 300,
  icon: 32,
} as const;

/**
 * The tagline, English and Spanish. The Spanish line is a deliberate
 * rework, not a literal translation — see docs/brand.md for why
 * "Movemos lo que otros no pueden." was chosen over a word-for-word
 * "Moviendo las cargas que otros no pueden."
 */
export const TAGLINE = {
  en: "Moving the loads others can't.",
  es: "Movemos lo que otros no pueden.",
} as const;

export type Locale = keyof typeof TAGLINE;

export function getTagline(locale: Locale): string {
  return TAGLINE[locale];
}
