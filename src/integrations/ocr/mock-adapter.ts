import { PDFDocument, StandardFonts } from 'pdf-lib'
import { sha256Hex } from '@/lib/crypto'
import { logger } from '@/lib/logger'
import type { OcrProvider } from './provider'
import type { ExtractionResult } from './types'
import { extractVins } from './vin-extractor'

const PROVIDER_NAME = 'ocr.mock'

interface RegisteredFixture {
  vins: string[]
  rawText: string
}

/** Keyed by sha256 of the exact document bytes — see `mockCoiWithVins`. */
const FIXTURE_REGISTRY = new Map<string, RegisteredFixture>()

/**
 * Registers a fixture so a later `extractFromDocument(bytes, …)` call with
 * these exact bytes deterministically returns `vins`. Builds a real,
 * minimal PDF via `pdf-lib` (our own PDF tooling — see `document-builder.ts`
 * for the pattern the rest of the app uses) with the raw text both drawn on
 * the page (for a human opening it) and stored in the PDF `Subject` metadata
 * field, which is what makes it "our own pdf tooling" the adapter can read
 * back deterministically without a real OCR engine.
 *
 * Usage (seed or test):
 *   const { bytes, contentType } = await mockCoiWithVins(['1FUJA6CV12LM386420'])
 *   // upload `bytes` as the COI document, then:
 *   const result = await ocrProvider.extractFromDocument(bytes, contentType)
 *   // result.vins === ['1FUJA6CV12LM386420']
 */
export async function mockCoiWithVins(
  vins: string[],
  options: { rawText?: string } = {},
): Promise<{ bytes: Uint8Array; contentType: string; sha256: string }> {
  const rawText = options.rawText ?? `CERTIFICATE OF INSURANCE (MOCK FIXTURE)\nVINs:\n${vins.join('\n')}\n`
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const page = doc.addPage()
  page.drawText(rawText.slice(0, 3000), {
    x: 40,
    y: page.getHeight() - 60,
    size: 8,
    font,
    maxWidth: page.getWidth() - 80,
    lineHeight: 10,
  })
  doc.setSubject(rawText)
  doc.setKeywords(vins)
  const bytes = await doc.save()
  const hash = sha256Hex(bytes)
  FIXTURE_REGISTRY.set(hash, { vins: vins.map((v) => v), rawText })
  return { bytes, contentType: 'application/pdf', sha256: hash }
}

/** Test-only: clears every registered fixture. */
export function clearMockCoiFixtures(): void {
  FIXTURE_REGISTRY.clear()
}

function looksLikePdf(bytes: Uint8Array, contentType: string): boolean {
  if (contentType === 'application/pdf') return true
  return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 // "%PDF"
}

function bestEffortDecode(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  } catch {
    return ''
  }
}

export class MockOcrAdapter implements OcrProvider {
  readonly name = PROVIDER_NAME

  async extractFromDocument(bytes: Uint8Array, contentType: string): Promise<ExtractionResult> {
    const hash = sha256Hex(bytes)
    const fixture = FIXTURE_REGISTRY.get(hash)
    if (fixture) {
      logger.info('ocr mock: fixture hit', { provider: PROVIDER_NAME, vinCount: fixture.vins.length })
      return { rawText: fixture.rawText, vins: fixture.vins, confidence: 96, provider: PROVIDER_NAME }
    }

    if (looksLikePdf(bytes, contentType)) {
      try {
        const doc = await PDFDocument.load(bytes, { updateMetadata: false })
        const subject = doc.getSubject()
        if (subject) {
          const vins = extractVins(subject)
          return {
            rawText: subject,
            vins,
            confidence: vins.length > 0 ? 90 : 35,
            provider: PROVIDER_NAME,
          }
        }
      } catch {
        // Not a PDF we generated, or it's corrupt — fall through to the text heuristic.
      }
    }

    const decoded = bestEffortDecode(bytes)
    const vins = extractVins(decoded)
    return {
      rawText: vins.length > 0 ? decoded : '',
      vins,
      confidence: vins.length > 0 ? 60 : 0,
      provider: PROVIDER_NAME,
    }
  }
}
