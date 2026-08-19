import { PDFDocument, StandardFonts } from 'pdf-lib'

/**
 * Builds a real, minimal PDF (via `pdf-lib`) whose `Subject` metadata field
 * contains the given VINs — the exact shape `mockCoiWithVins()` in
 * `src/integrations/ocr/mock-adapter.ts` produces for its own registered
 * fixtures. That registry lives in the *server's* Node process, unreachable
 * from here, but `MockOcrAdapter.extractFromDocument()` has a second,
 * registry-independent path: for any PDF it can parse, it reads `Subject`
 * back and runs the same VIN-extraction heuristic on it. Building the PDF
 * the same way lets an E2E test drive real COI/VIN verification end to end
 * without touching the server process at all.
 */
export async function buildCoiPdfWithVins(vins: string[]): Promise<Buffer> {
  const rawText = `CERTIFICATE OF INSURANCE (E2E FIXTURE)\nVINs:\n${vins.join('\n')}\n`
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
  return Buffer.from(bytes)
}
