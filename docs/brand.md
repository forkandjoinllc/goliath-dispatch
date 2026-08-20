# Goliath Dispatch — brand implementation guide

This is the developer-facing guide to the brand system implemented under
`public/brand/`, `resources/css/`, `resources/js/lib/brand.ts`, and
verified by `tests/brand/contrast.mjs`. You should not need to open
`resources/brand-source/brand-guide.pdf` to use any of this — everything
you need to build a screen is here.

## Source of truth

- **Design tokens (CSS):** `resources/css/tokens.css` — the canonical hex
  values. If a number here and a number in `brand.ts` ever disagree,
  `tokens.css` wins; fix `brand.ts` to match.
- **JS/TS constants:** `resources/js/lib/brand.ts` — the same values for
  code that needs raw hex (canvas, SVG, chart libraries, PDF export,
  `<meta theme-color>`).
- **Contrast checks:** `tests/brand/contrast.mjs` — run it after touching
  either file: `node tests/brand/contrast.mjs`.

## The brand, in short

- **Colours:** Goliath Navy `#062B5C`, Safety Orange `#FF5A00`, Steel Gray
  `#9B9B9B`, Carbon `#111827`. Nothing else — every colour in the app is
  one of these four or a computed tint/shade of one of these four.
- **Type:** Roboto Condensed only, in Bold Italic / Bold / Regular. It is
  used for headings **and** body copy — there is no separate body face.
  Short headings and operational labels (status chips, table headers,
  section titles) are set in uppercase; body copy is sentence case.
- **Tagline:** "Moving the loads others can't." / "Movemos lo que otros
  no pueden." — see [Bilingual tagline](#bilingual-tagline).
- **Personality:** Strong, Precise, Reliable, Forward. In practice: small
  radii, shallow shadows, tight information density, no ornament. This is
  dispatch software people rely on at 6am, not a marketing microsite.

## Logo — which file, where

All logo assets live in `public/brand/`. Reference them from React via
`LOGO_ASSETS` in `brand.ts`, not by hardcoding paths.

| File | Use it when… |
|---|---|
| `logo-primary.png` / `@2x` | Full lockup on a light/white background. This is the raster the brand guide's art actually is — there is no vector source (see [No vector source](#no-vector-source-what-i-could-not-do-well)) — so use it wherever the layout allows a raster image (headers, print, email, login screens, marketing surfaces). |
| `logo-reversed.png` / `@2x` | Full lockup on Goliath Navy or any other dark field. Navy → white, Safety Orange stays orange. |
| `logo-monochrome.png` / `@2x` | Single colour (navy), for one-colour production: stamps, engraving, watermarks, fax headers. |
| `logo-monochrome-white.png` / `@2x` | Same, in white, for one-colour production on a dark or navy surface. |
| `icon.svg` | The G monogram alone, hand-redrawn as vector (see below). Use for the app's favicon source, in-app navy-on-light brand marks, and anywhere the icon needs to scale crisply from 16px to a few hundred px. Navy + orange, for light backgrounds. |
| `icon-mono.svg` | Single-colour (navy) vector version of the same mark, for contexts that can't render two fills — a print letterhead mark, a one-colour stamp, an `<img>` you intend to recolour via a CSS mask. |
| `favicon.svg`, `favicon-32.png`, `favicon-180.png`, `icon-192.png`, `icon-512.png` | Browser tab icon, Apple touch icon, and PWA manifest icons. Wire these up in the `<head>`/manifest; nothing else in the app should reference favicon paths directly. |
| `icon-maskable-512.png` | PWA maskable icon: navy background fill, white/orange mark scaled to the ~62% safe zone so Android's circular/squircle masks don't clip it. Use only where the manifest asks for a `purpose: "maskable"` icon — it looks wrong (navy box) anywhere else. |
| `og-image.png` | 1200×630 social share card (Open Graph / Twitter). Static — regenerate it if the lockup or tagline changes (see [Regenerating assets](#regenerating-assets)). |

### Clear space and minimum size

Per the brand guide: clear space around the full lockup equals the
height of the tagline's capital "M"; treat that as a hard minimum
padding, not a suggestion. Minimum size is **300px wide (digital)** for
the full lockup and **32px** for the icon alone. `LOGO_MIN_SIZE_PX` in
`brand.ts` encodes both. Below the lockup's minimum, drop the tagline
before you drop the mark — a bare "GOLIATH DISPATCH" wordmark at small
size is legible; a tagline squeezed into the same space is not.

### What not to do

- Don't stretch, rotate, skew, or rearrange any piece of the lockup.
- Don't recolour the mark outside the four brand colours (no "dark mode
  purple," no tinting the G to match a data-viz series colour).
  Use the reversed or monochrome variant instead.
- Don't add drop shadows, glows, bevels, or outlines to the logo.
- Don't place the lockup over a busy photograph. If a hero image is
  unavoidable, put the lockup in a solid navy or white panel over it.
- Don't recreate the wordmark in system fonts as a "logo" substitute —
  use the actual asset.

## Icon redraw — how it was done, and how close it is

There is no vector source for this brand. The only source material is
`resources/brand-source/brand-guide.pdf`, which embeds the logo as a
200-ppi raster with the highway arc passing *behind* the wordmark — there
is no clean pixel column to crop an icon out of, and no outline data to
extract as a path.

`icon.svg` and `icon-mono.svg` were built by:

1. Cleaning the raster (see [Raster cleanup](#raster-cleanup-halo-removal)
   below) so every pixel is exactly one of the four brand hex values,
   with no anti-aliasing halo.
2. Isolating the G-monogram region and finding contours per colour
   (OpenCV `findContours`, `RETR_CCOMP` for the navy silhouette so the
   G's counter and the five wheel cut-outs come back as holes with the
   correct parent/child hierarchy; `RETR_EXTERNAL` for the orange dash
   pieces).
3. Simplifying each contour (`approxPolyDP`) to a clean polygon — this
   is where "redraw" actually happens: the output is a small set of
   angular line segments, not a pixel-perfect trace, which is both truer
   to the mark's own angular design language and what keeps the file
   under 6KB.
4. Reconstructing the five wheels as true circular arcs (`minEnclosingCircle`
   centre/radius → SVG arc commands) rather than polygon approximations,
   since polygonal "circles" are the first thing that reads as fake at
   small sizes.
5. Hand-assembling the result into a single `evenodd` navy `<path>`
   (three disconnected navy regions — the G's upper arm, the road's
   swept tail, and the lower body/deck/wheels — plus five circular
   holes) and a second orange `<path>` for the nine dash segments,
   wrapped in an SVG with `role="img"` and a `<title>`.

**Honest assessment:** at 512px this reads as essentially the same mark
as the raster — same G silhouette, same road sweep and dash rhythm, same
wheel/deck detail. At 32px (the guide's stated icon minimum) it is
unmistakably the same mark: G shape, road cutting through it, orange
dashes — but the finest details (the individual wheels, the small deck
accent stripe) blur together the way they would in any favicon-sized
rendering of a detailed logo. That's expected and matches how the
original raster behaves at the same size, not a regression introduced by
the redraw. `icon.svg` is 1.25KB and `icon-mono.svg` is 1.24KB, both
comfortably under the 6KB budget, using only navy and safety-orange (plus
white/transparent as the background, not a foreground colour).

`icon.svg` is built for **light backgrounds only** (the navy G
disappears on a navy field, by design — it's the same relationship the
raster lockup has). For a dark or navy surface, use `icon-mono.svg` with
its fill swapped to white, or `logo-monochrome-white.png` for the full
lockup.

### No vector source: what I could not do well

- The icon redraw is a careful reconstruction, not the designer's
  original bezier paths. If Goliath ever produces a true vector source
  (AI/EPS/SVG from whoever designed the mark), swap it in — the redraw
  is a solid stand-in, not a permanent replacement.
- The full lockup (`logo-primary.png` and friends) is necessarily raster,
  because the *wordmark* typography in the source PDF is also only
  available as raster art (it's routed the same as the icon — flattened
  into the page). It reproduces cleanly up to its native resolution
  (1857×559 for the `@2x` file) but will soften if scaled beyond that;
  don't stretch it larger than roughly 1900px wide.
- The gray accent parallelogram near the tagline underline in the
  original art is genuinely translucent (~46–55% alpha) by design, not an
  artifact of extraction — I verified this by sampling it directly (see
  below) and preserved that partial opacity rather than "fixing" it to a
  flat fill.

### Raster cleanup: halo removal

The PDF-extracted PNGs (`resources/brand-source/*.png`) came out of the
PDF with a white-matted alpha channel: edge pixels are a light-blue-gray
blend (e.g. `rgb(198,206,218)` at 11% alpha) rather than navy at reduced
alpha. Composited on a dark background, that produces a visible gray
"halo" tracing every edge — you can see it if you alpha-composite the raw
extraction over navy.

The fix (in the pipeline used to produce every `logo-*.png`):

1. Pixels within ~2px of an opaque (α ≥ 230) fill are treated as true
   anti-aliasing: unmatte them against a white backdrop
   (`true = (observed − 255·(1−α)) / α`), then snap the recovered colour
   to the nearest of the four brand hex values.
2. Pixels far from any opaque fill (i.e., not edge pixels — genuinely
   translucent design elements, like the gray accent bar) are classified
   directly from their raw hue/saturation/value and snapped to the
   nearest brand colour **without** unmatting, and keep their original
   alpha. Unmatting a genuinely-translucent 50%-alpha gray shape against
   a white-backdrop assumption drives it toward black, which is wrong —
   this two-path approach is what tells the difference.
3. Any remaining very-low-alpha (α < 4) or unclassifiable near-white
   noise is zeroed out rather than left as a faint fringe.

Verified by alpha-compositing every output over both white and navy and
inspecting the edges directly — the navy diagonal strokes blend cleanly
into a navy background with zero visible fringe, and the translucent gray
accent keeps its original ~46–55% opacity rather than turning solid or
disappearing.

## Colour and contrast

Read this before you reach for a colour. Full numbers:
`node tests/brand/contrast.mjs` (also see the table below, current as of
this writing).

### The rule

**Every colour in this system has a "vivid" step and, where the vivid
step isn't dark enough, a "text-safe" step at least one step darker.**
Use vivid for large/decorative/UI purposes, text-safe for anything a
person has to read.

| Purpose | Use |
|---|---|
| Body text, headings, icons meant to be read | the `-600`/`-700` step, or `carbon`/`navy-700` |
| Borders, fills, hazard stripe, chart series, large display type (≥24px, or ≥19px bold) | the `-500` step (or `-400` for steel) |
| Text on a coloured fill (buttons, solid badges) | the fill must be a `-600`/`-700` step, never `-500` |

### The Safety Orange finding

**Safety Orange `#FF5A00` measures 3.13:1 against white.** That is a
fact about the brand colour — it is a bright, mid-value orange, and
WCAG's 4.5:1 text threshold is not achievable at that lightness without
changing the hue or darkening it into a different-looking orange. It
clears the 3:1 threshold for UI boundaries and large text, so it is not
a broken colour — it is a colour with a job.

**What `safety-500` (`#FF5A00`) is for:** borders, icon strokes, fills,
badges/pills that also carry a dark-text label, the `.hazard-stripe`
utility, chart/data-viz series, and display type at 24px+ (or 19px+
bold) — anywhere the WCAG *large-text* 3:1 threshold applies instead of
the *text* 4.5:1 threshold.

**What `safety-500` is never for:** body copy, small labels, or as a
button fill with white text sitting directly on top of it (white on
`#FF5A00` is the same 3.13:1 — also a fail).

**The fix — `safety-600` (`#C24602`):** same hue, one step darker,
measured at **5.03:1** against white (and 5.03:1 for white text on a
`safety-600` fill, since contrast is symmetric). Use `safety-600` for:

- orange body text or orange links,
- orange text on a light background,
- any solid fill that carries white text (buttons, filled badges).

This mirrors how the other three status colours work too (see
`STATUS` in `brand.ts`): each has a `-500` "vivid" step that is fine for
large-scale/decorative use and a `-700` step that's the one you reach
for whenever text or a white-on-fill pairing is involved.
`warning-500` (`#F59E0B`) is the most extreme example — only 2.07:1 on
its own tint — precisely because amber is a light hue by nature; that's
why every status colour gets the same two-step treatment rather than
trusting the mid-tone.

### Steel Gray

`steel-400` (`#9B9B9B`, the canonical brand steel) measures **2.78:1**
against white — below even the 3:1 UI-boundary threshold, not just the
4.5:1 text threshold. Treat it as **decorative only**: chart gridlines,
disabled-state fills, non-essential dividers where the boundary isn't
required to understand the UI. If a border or icon needs to actually be
perceivable, use `steel-600` (`#616161`, 6.19:1 on white) or darker.

### Measured contrast table

Generated by `tests/brand/contrast.mjs` against the live values in
`resources/css/tokens.css` — re-run it rather than trusting this table
if you've touched a colour:

| Pair | Ratio | Threshold | Result |
|---|---|---|---|
| navy-700 on white | 13.93:1 | 4.5:1 (text) | PASS |
| white on navy-700 | 13.93:1 | 4.5:1 (text) | PASS |
| safety-500 on white | 3.13:1 | 3:1 (large text/UI) | PASS |
| white on safety-500 | 3.13:1 | 3:1 (large text/UI) | PASS |
| steel-600 on white | 6.19:1 | 4.5:1 (text) | PASS |
| steel-400 on white | 2.78:1 | — decorative only | INFO |
| carbon on white | 17.74:1 | 4.5:1 (text) | PASS |
| safety-600 on white (text-safe orange) | 5.03:1 | 4.5:1 (text) | PASS |
| white on safety-600 (button fill) | 5.03:1 | 4.5:1 (text) | PASS |
| success-700 / warning-700 / danger-700 / info-700 on own tint | 4.79 / 4.75 / 5.91 / 5.57 :1 | 4.5:1 (text) | PASS |
| success-700 / warning-700 / danger-700 / info-700 on white | 5.02 / 4.92 / 6.47 / 5.93 :1 | 4.5:1 (text) | PASS |
| white on success-700 / warning-700 / danger-700 / info-700 | same as above (symmetric) | 4.5:1 (text) | PASS |
| success-500 / warning-500 / danger-500 / info-500 on own tint | 3.15 / 2.07 / 4.41 / 3.84 :1 | — decorative only | INFO |

## Typography

Roboto Condensed, self-hosted from `public/brand/fonts/` (see
[Fonts](#fonts) below), loaded once in `resources/css/fonts.css` and
referenced everywhere via the `--font-sans` / `--font-display` theme
variables (they're the same stack — there is one type family in this
brand, used at different weights/styles):

```css
font-family: var(--font-sans); /* body */
font-family: var(--font-display); /* headings, same family */
```

- **Bold Italic** — the tagline, and only the tagline. Don't reuse it for
  emphasis in body copy; it's a brand signature, not a text style.
- **Bold** — headings, operational labels, button labels.
- **Regular** — body copy, form labels, table content.

**Case rule:** short headings and operational labels (page titles,
section headers, status chips, table column headers) are set in
**uppercase**. Body copy — anything a person reads in sentences — is
**sentence case**, never uppercase (all-caps body text is what the brand
guide is explicitly steering away from). Use the `.uppercase-heading`
utility from `resources/css/utilities.css` for the former; do not add
`text-transform: uppercase` ad hoc elsewhere.

```html
<h2 class="uppercase-heading text-xl">Active loads</h2>
<p>Driver confirmed pickup at the Odessa yard this morning.</p>
```

## Design tokens

`resources/css/tokens.css` is a Tailwind v4 `@theme` block — every value
in it becomes a Tailwind utility automatically (`bg-navy-700`,
`text-safety-600`, `rounded-md`, `shadow-sm`, …). Import order, set up in
`resources/css/app.css`:

```css
@import "tailwindcss";
@import "./fonts.css";
@import "./tokens.css";
@import "./base.css";
@import "./utilities.css";
```

### Colour ramps

`navy` (50–950), `safety` (50–900), `steel` (50–900) are **generated**,
not hand-picked: each base hex is converted to HSL, and every other step
is produced by interpolating lightness toward white (lighter steps) or
black (darker steps), holding hue constant with a small saturation taper
at the extremes so the 50-step doesn't look grey and the 900/950-step
doesn't look neon. The brand hex is pinned exactly to its canonical step
— `navy-700`, `safety-500`, `steel-400` are the *only* three values in
the whole ramp set that are not computed. `carbon` (`#111827`) is a
single fixed token, not a ramp — it's the ink colour for body text.

### Elevation, radius, spacing

Kept restrained on purpose — shallow shadows (`--shadow-xs` through
`--shadow-lg`, all low-opacity navy rather than black, so they read as
"lifted paper" not "drop shadow"), small radii (`--radius-sm` 3px through
`--radius-lg` 8px), and three control-height tokens
(`--spacing-control-sm/md/lg`) for consistent input/button/table-row
sizing. This is dense operational software; don't add bigger shadows or
rounder corners than these to make something "pop" — that fights the
Precise/Reliable personality.

### `.hazard-stripe`

45° navy/safety-orange repeating stripe, for marking oversize and
overweight loads — permit banners, load-detail flags, printed placards.

```html
<div class="hazard-stripe h-3 rounded-sm"></div>
<!-- or the compact version for chips/badges -->
<span class="hazard-stripe-sm inline-block h-2 w-6 rounded-sm"></span>
```

It uses `safety-500` (a fill, not text), which is exactly the case that
colour is right for.

### Base layer

`resources/css/base.css` sets, and none of these should be removed or
overridden:

- **`:focus-visible`** — a 2px `safety-600` outline with offset (bumped
  to `safety-400` automatically inside a navy surface via the
  `.bg-navy-700/800/900 :focus-visible` rule). Never ship `outline: none`
  without an equivalent replacement — there isn't one in this codebase.
- **`prefers-reduced-motion: reduce`** — collapses animation/transition
  durations to effectively zero and disables smooth scrolling.
- **`[data-numeric]`** — `font-variant-numeric: tabular-nums` for any
  element holding numbers that need to line up in a column (weights,
  distances, ETAs, currency). Tailwind's own `tabular-nums` utility class
  works too if you'd rather opt in per-element than via attribute.
- **`@media print`** — strips colour/background/shadow for ink-friendly
  printouts (permits, BOLs, rate confirmations), expands linked URLs
  inline, and forces visible table borders. Mark anything that shouldn't
  print with `class="print:hidden"` or `data-print="hidden"`.

## Fonts

Roboto Condensed is **self-hosted** — `public/brand/fonts/*.woff2` — and
is never fetched from Google Fonts. Two reasons, both hard constraints
here: the build environment has no network access to
`fonts.googleapis.com`/`fonts.gstatic.com`, and a third-party font
request is a CSP exception this app doesn't need to carry.

Files (all WOFF2, all Latin subset, ~87KB total):

```
roboto-condensed-latin-400-normal.woff2   Regular
roboto-condensed-latin-400-italic.woff2   Italic
roboto-condensed-latin-700-normal.woff2   Bold
roboto-condensed-latin-700-italic.woff2   Bold Italic
```

They came from `@fontsource/roboto-condensed` on npm (OFL-1.1 licensed,
freely redistributable) — `resources/css/fonts.css` declares the
matching `@font-face` rules pointing at `/brand/fonts/...`. To update or
add a weight, install the package again and copy the new file(s) in:

```bash
npm install @fontsource/roboto-condensed
cp node_modules/@fontsource/roboto-condensed/files/roboto-condensed-latin-<weight>-<style>.woff2 \
   public/brand/fonts/
```

then add the matching `@font-face` block to `fonts.css`.

## Bilingual tagline

`TAGLINE` in `brand.ts`:

```ts
en: "Moving the loads others can't."
es: "Movemos lo que otros no pueden."
```

The Spanish line is a deliberate rework, not a literal translation. A
word-for-word rendering — "Moviendo las cargas que otros no pueden." —
is grammatically fine but reads flat: Spanish marketing copy leans
active/first-person far more than English does, and a present-participle
opener ("Moviendo…") without a stated subject sounds like a translated
sentence rather than something a carrier would actually say. "Movemos lo
que otros no pueden." ("We move what others can't.") keeps the exact
meaning and the confident, capability-first tone the brand guide asks
for (Strong/Precise/Reliable/Forward), scans in the same rhythm as the
English line, and is the phrasing a native Spanish-speaking dispatcher or
owner-operator in the US trucking market would actually say out loud.
This is for a bilingual product serving US drivers and carriers, not a
translation for a different market — "loads" stays implicit ("lo que")
rather than forcing "cargas," which keeps it terse and avoids the slight
redundancy of naming the object twice.

Use `getTagline(locale)` (or index `TAGLINE` directly) rather than
hardcoding either string, and drive the choice off the same `Locale`
value the backend already uses (`App\Enums\Locale`, `'en' | 'es'`) so the
tagline follows the user's locale automatically.

## Regenerating assets

There is no build script for the logo assets — they were produced by a
one-off Python/PIL/OpenCV pipeline against the files in
`resources/brand-source/`. If the source PDF or PNGs change:

1. Re-run the colour-snapping pipeline (unmatte + classify, described
   above under [Raster cleanup](#raster-cleanup-halo-removal)) against
   the new source to get a clean 4-colour RGBA PNG.
2. Regenerate `logo-primary(@2x).png` by trimming to content and halving
   for the 1x size.
3. Regenerate `logo-reversed(@2x).png` by remapping navy→white and
   steel→a light steel tint, leaving safety orange untouched.
4. Regenerate `logo-monochrome(-white)(@2x).png` by setting every
   non-transparent pixel to navy (or white).
5. If the icon geometry changed, redo the contour extraction
   (`cv2.findContours` on the cleaned raster, `approxPolyDP` to
   simplify, `minEnclosingCircle` for the wheels) rather than hand-typing
   new path coordinates.
6. Regenerate the PNG/favicon exports from the SVGs with `sharp`
   (`sharp('public/brand/icon.svg').resize(N,N).png().toFile(...)`), and
   `og-image.png` with the PIL script that composites the reversed
   lockup over a navy field.
7. Run `node tests/brand/contrast.mjs` — it doesn't check images, but if
   you also touched a token while you were in there, this is the gate.

None of this is checked into a repeatable script in this repo (out of
scope for this pass); treat this section as the runbook if you need to
redo it.
