/**
 * Live adapter for Google Cloud Document AI. Selected only when
 * `OCR_DRIVER=docai`.
 *
 * `@google-cloud/documentai` is NOT a dependency of this project today — as
 * with `textract-adapter.ts`, the SDK is loaded lazily via `await import(…)`
 * so a missing package fails loudly and only when this driver is actually
 * selected, never at module load.
 *
 * To bring this adapter to life: `npm install @google-cloud/documentai`,
 * provide a service account via `GOOGLE_APPLICATION_CREDENTIALS` (standard
 * Google auth library convention — this project has no separate app-level
 * key for it), set `DOCAI_PROCESSOR_NAME` (the fully-qualified processor
 * resource name, e.g. `projects/…/locations/us/processors/…`), and flip
 * `OCR_DRIVER=docai`.
 */
import { logger } from '@/lib/logger'
import { mapProviderError, notConfiguredError } from '../_shared/errors'
import type { OcrProvider } from './provider'
import type { ExtractionResult } from './types'
import { extractVins } from './vin-extractor'

const PROVIDER_NAME = 'ocr.docai'

interface DocumentAiClientLike {
  processDocument(request: unknown): Promise<
    [{ document?: { text?: string; textStyles?: unknown } }]
  >
}

interface DocumentAiModule {
  DocumentProcessorServiceClient: new () => DocumentAiClientLike
}

export class DocAiOcrAdapter implements OcrProvider {
  readonly name = PROVIDER_NAME

  private readonly processorName: string

  constructor() {
    const processorName = process.env.DOCAI_PROCESSOR_NAME
    if (!processorName) {
      throw notConfiguredError(PROVIDER_NAME, 'integrations.ocr.notConfigured')
    }
    this.processorName = processorName
  }

  async extractFromDocument(bytes: Uint8Array, contentType: string): Promise<ExtractionResult> {
    let sdk: DocumentAiModule
    try {
      // A variable (not a string literal) module specifier keeps TypeScript
      // from trying to resolve types for a package that may not be
      // installed — the whole expression is `Promise<any>` instead.
      const moduleName = '@google-cloud/documentai'
      sdk = (await import(moduleName)) as unknown as DocumentAiModule
    } catch {
      logger.error('document ai sdk not installed', { provider: PROVIDER_NAME })
      throw notConfiguredError(PROVIDER_NAME, 'integrations.ocr.sdkNotInstalled')
    }

    try {
      const client = new sdk.DocumentProcessorServiceClient()
      const [result] = await client.processDocument({
        name: this.processorName,
        rawDocument: { content: Buffer.from(bytes).toString('base64'), mimeType: contentType },
      })
      const rawText = result.document?.text ?? ''
      // Document AI doesn't return a single scalar confidence; a fixed
      // baseline is used until a per-entity confidence model is wired up.
      const confidence = rawText ? 80 : 0
      return { rawText, vins: extractVins(rawText), confidence, provider: PROVIDER_NAME }
    } catch (error) {
      throw mapProviderError(PROVIDER_NAME, error, 'integrations.ocr.unavailable')
    }
  }
}
