import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator } from '@/i18n/translate'
import { watermarkImage, watermarkPdf } from '@/lib/pdf/watermark'

async function translator(locale: 'en' | 'es' = 'en') {
  const dictionary = await getDictionary(locale)
  return createTranslator(dictionary, locale)
}

async function makeSourcePdf(pageCount: number): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  for (let i = 0; i < pageCount; i += 1) {
    pdf.addPage([300, 300])
  }
  return pdf.save()
}

describe('watermarkPdf', () => {
  it('produces a valid PDF with the same page count as the source', async () => {
    const source = await makeSourcePdf(3)
    const t = await translator('en')

    const stamped = await watermarkPdf(
      source,
      { downloadedAt: new Date('2026-01-15T12:00:00Z'), locale: 'en', tenantName: 'Acme Dispatch', timezone: 'America/New_York' },
      t,
    )

    expect(Buffer.from(stamped).subarray(0, 4).toString()).toBe('%PDF')
    const reloaded = await PDFDocument.load(stamped)
    expect(reloaded.getPageCount()).toBe(3)
  })

  it('leaves the input bytes untouched', async () => {
    const source = await makeSourcePdf(1)
    const copy = Uint8Array.from(source)
    const t = await translator('en')

    await watermarkPdf(source, { downloadedAt: new Date(), locale: 'en', tenantName: 'Acme', timezone: 'UTC' }, t)

    expect(source).toEqual(copy)
  })

  it('works with the Spanish locale as well', async () => {
    const source = await makeSourcePdf(1)
    const t = await translator('es')

    const stamped = await watermarkPdf(
      source,
      { downloadedAt: new Date(), locale: 'es', tenantName: 'Transportes Acme', timezone: 'America/Mexico_City' },
      t,
    )
    const reloaded = await PDFDocument.load(stamped)
    expect(reloaded.getPageCount()).toBe(1)
  })
})

describe('watermarkImage', () => {
  it('wraps a stamped PNG into a valid single-page PDF', async () => {
    // A minimal real 1x1 PNG, so the magic-byte sniffing pdf-lib does internally succeeds.
    const onePixelPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    )
    const t = await translator('en')

    const stamped = await watermarkImage(
      onePixelPng,
      'image/png',
      { downloadedAt: new Date(), locale: 'en', tenantName: 'Acme', timezone: 'UTC' },
      t,
    )

    expect(Buffer.from(stamped).subarray(0, 4).toString()).toBe('%PDF')
    const reloaded = await PDFDocument.load(stamped)
    expect(reloaded.getPageCount()).toBe(1)
  })
})
