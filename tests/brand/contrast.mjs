#!/usr/bin/env node
/**
 * Goliath Dispatch — WCAG 2.2 contrast verification.
 *
 * Plain Node, no dependencies, no test framework: `node tests/brand/contrast.mjs`.
 * Reads the real values out of resources/css/tokens.css (no hand-copied
 * hex here to drift out of sync) and checks every foreground/background
 * pair the design system actually uses, against:
 *   - 4.5:1 for normal text pairs
 *   - 3:1 for UI-boundary / large-text / decorative pairs
 *
 * Exits non-zero and prints a failure summary if anything falls short.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOKENS_PATH = path.resolve(__dirname, "../../resources/css/tokens.css");

// ---------------------------------------------------------------------
// 1. Parse `--color-*: #hex;` custom properties straight out of tokens.css
// ---------------------------------------------------------------------

function parseTokens(cssText) {
  const colors = {};
  const re = /--color-([a-z0-9-]+):\s*(#[0-9A-Fa-f]{6});/g;
  let m;
  while ((m = re.exec(cssText))) {
    colors[m[1]] = m[2].toUpperCase();
  }
  return colors;
}

const cssText = readFileSync(TOKENS_PATH, "utf8");
const colors = parseTokens(cssText);
colors["white"] = "#FFFFFF";
colors["black"] = "#000000";

function need(name) {
  const v = colors[name];
  if (!v) {
    throw new Error(`Token --color-${name} not found in ${TOKENS_PATH}`);
  }
  return v;
}

// ---------------------------------------------------------------------
// 2. WCAG 2.2 relative luminance + contrast ratio
// ---------------------------------------------------------------------

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

function srgbToLinear(c) {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex) {
  const [r, g, b] = hexToRgb(hex).map(srgbToLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(hexA, hexB) {
  const lA = relativeLuminance(hexA);
  const lB = relativeLuminance(hexB);
  const lighter = Math.max(lA, lB);
  const darker = Math.min(lA, lB);
  return (lighter + 0.05) / (darker + 0.05);
}

// ---------------------------------------------------------------------
// 3. Every pair the design system actually uses
// ---------------------------------------------------------------------

const TEXT_MIN = 4.5;
const UI_MIN = 3.0;

/**
 * kind: "text"       -> must clear 4.5:1
 *       "large-text"  -> must clear 3:1  (>=24px, or >=19px bold display type)
 *       "ui"          -> must clear 3:1  (borders, icon strokes, focus rings that carry meaning)
 *       "decorative"  -> no enforced minimum; measured and reported (INFO) so the number is on
 *                        the record, but the pairing is never used for text or required-boundary
 *                        meaning, so WCAG doesn't require it to clear either threshold.
 */
const pairs = [
  // --- Required minimum set from the brief ---
  { label: "navy-700 text on white", fg: "navy-700", bg: "white", kind: "text" },
  { label: "white text on navy-700", fg: "white", bg: "navy-700", kind: "text" },
  { label: "safety-500 text on white", fg: "safety-500", bg: "white", kind: "large-text" },
  { label: "white text on safety-500", fg: "white", bg: "safety-500", kind: "large-text" },
  { label: "steel-600 text on white", fg: "steel-600", bg: "white", kind: "text" },
  {
    label: "steel-400 text on white (decorative only — see docs/brand.md)",
    fg: "steel-400",
    bg: "white",
    kind: "decorative",
  },
  { label: "carbon text on white", fg: "carbon", bg: "white", kind: "text" },
  { label: "success-700 text on success-50", fg: "success-700", bg: "success-50", kind: "text" },
  { label: "warning-700 text on warning-50", fg: "warning-700", bg: "warning-50", kind: "text" },
  { label: "danger-700 text on danger-50", fg: "danger-700", bg: "danger-50", kind: "text" },
  { label: "info-700 text on info-50", fg: "info-700", bg: "info-50", kind: "text" },

  // --- The orange-text fix: the darker step, verified ---
  { label: "safety-600 text on white (text-safe orange)", fg: "safety-600", bg: "white", kind: "text" },
  { label: "white text on safety-600 (button fill)", fg: "white", bg: "safety-600", kind: "text" },

  // --- Everyday app surfaces ---
  { label: "carbon text on steel-50 (app background)", fg: "carbon", bg: "steel-50", kind: "text" },
  { label: "navy-700 text on steel-50", fg: "navy-700", bg: "steel-50", kind: "text" },
  { label: "white text on navy-900 (dark surface)", fg: "white", bg: "navy-900", kind: "text" },
  { label: "navy-700 border on white (UI boundary)", fg: "navy-700", bg: "white", kind: "ui" },
  { label: "safety-500 border on white (UI boundary)", fg: "safety-500", bg: "white", kind: "ui" },
  { label: "safety-600 focus ring on white (UI boundary)", fg: "safety-600", bg: "white", kind: "ui" },
  {
    label: "steel-300 divider on white (decorative only)",
    fg: "steel-300",
    bg: "white",
    kind: "decorative",
  },

  // --- Status colours: the 500 step against its own tint is large-icon/decorative
  //     only (some, like warning-500, fall below 3:1 — same shape as safety-500).
  //     Small icons and any text use the 700 step instead, checked below. ---
  { label: "success-500 large icon on success-50 (decorative)", fg: "success-500", bg: "success-50", kind: "decorative" },
  { label: "warning-500 large icon on warning-50 (decorative)", fg: "warning-500", bg: "warning-50", kind: "decorative" },
  { label: "danger-500 large icon on danger-50 (decorative)", fg: "danger-500", bg: "danger-50", kind: "decorative" },
  { label: "info-500 large icon on info-50 (decorative)", fg: "info-500", bg: "info-50", kind: "decorative" },

  // --- Status colours as text directly on white, and as solid fills with white text ---
  { label: "success-700 text on white", fg: "success-700", bg: "white", kind: "text" },
  { label: "warning-700 text on white", fg: "warning-700", bg: "white", kind: "text" },
  { label: "danger-700 text on white", fg: "danger-700", bg: "white", kind: "text" },
  { label: "info-700 text on white", fg: "info-700", bg: "white", kind: "text" },
  { label: "white text on success-700 (solid badge fill)", fg: "white", bg: "success-700", kind: "text" },
  { label: "white text on warning-700 (solid badge fill)", fg: "white", bg: "warning-700", kind: "text" },
  { label: "white text on danger-700 (solid badge fill)", fg: "white", bg: "danger-700", kind: "text" },
  { label: "white text on info-700 (solid badge fill)", fg: "white", bg: "info-700", kind: "text" },
];

// ---------------------------------------------------------------------
// 4. Run + report
// ---------------------------------------------------------------------

const thresholds = { text: TEXT_MIN, "large-text": UI_MIN, ui: UI_MIN, decorative: null };

let failed = 0;
let enforced = 0;
const rows = [];

for (const pair of pairs) {
  const fgHex = need(pair.fg);
  const bgHex = need(pair.bg);
  const ratio = contrastRatio(fgHex, bgHex);
  const min = thresholds[pair.kind];
  const isEnforced = min !== null;
  const pass = !isEnforced || ratio >= min;
  if (isEnforced) {
    enforced++;
    if (!pass) failed++;
  }
  rows.push({ ...pair, fgHex, bgHex, ratio, min, pass, isEnforced });
}

const fmt = (n) => n.toFixed(2);
const colWidth = Math.max(...rows.map((r) => r.label.length)) + 2;

console.log("Goliath Dispatch — WCAG 2.2 contrast report\n");
console.log(
  "STATUS".padEnd(7) +
    "LABEL".padEnd(colWidth) +
    "FG".padEnd(9) +
    "BG".padEnd(9) +
    "RATIO".padEnd(9) +
    "MIN".padEnd(9) +
    "KIND"
);
console.log("-".repeat(colWidth + 50));

for (const r of rows) {
  const status = !r.isEnforced ? "INFO" : r.pass ? "PASS" : "FAIL";
  console.log(
    status.padEnd(7) +
      r.label.padEnd(colWidth) +
      r.fgHex.padEnd(9) +
      r.bgHex.padEnd(9) +
      `${fmt(r.ratio)}:1`.padEnd(9) +
      (r.isEnforced ? `${fmt(r.min)}:1` : "n/a").padEnd(9) +
      r.kind
  );
}

console.log("");
console.log(
  `${enforced} pairs enforced (text >= ${fmt(TEXT_MIN)}:1, ui/large-text >= ${fmt(UI_MIN)}:1), ` +
    `${rows.length - enforced} decorative pairs reported for the record only.\n`
);

if (failed > 0) {
  console.error(`FAILED: ${failed} of ${enforced} enforced pairs fell below their WCAG 2.2 threshold.\n`);
  for (const r of rows.filter((r) => r.isEnforced && !r.pass)) {
    console.error(
      `  - ${r.label}: ${fmt(r.ratio)}:1 measured, needs >= ${fmt(r.min)}:1 (${r.kind})`
    );
  }
  console.error(
    "\nSee docs/brand.md 'Colour and contrast' for which step to use instead."
  );
  process.exit(1);
} else {
  console.log(`PASSED: all ${enforced} enforced pairs clear their WCAG 2.2 threshold.`);
  process.exit(0);
}
