/**
 * Live adapter for Amazon Textract (`AnalyzeDocument` / raw text detection).
 * Selected only when `OCR_DRIVER=textract`.
 *
 * `@aws-sdk/client-textract` is NOT a dependency of this project today — the
 * SDK is loaded lazily via `await import(...)` inside `extractFromDocument`
 * so that:
 *  - importing this module (or the whole `ocr` package) never fails when the
 *    package isn't installed, which matters because `OCR_DRIVER=mock` is the
 *    default and this file is still reachable from `./index.ts`'s driver
 *    switch, and
 *  - selecting `textract` without having installed the package fails with a
 *    clear `integration_unavailable` at call time instead of an unreadable
 *    module-resolution error at build/import time.
 *
 * To bring this adapter to life: `npm install @aws-sdk/client-textract`, set
 * `FMCSA`-style credentials via the standard AWS credential chain (env vars,
 * instance role, etc. — Textract has no separate app-level API key), and
 * flip `OCR_DRIVER=textract`.
 */
import { logger } from '@/lib/logger'
import { mapProviderError, notConfiguredError } from '../_shared/errors'
import type { OcrProvider } from './provider'
import type { ExtractionResult } from './types'
import { extractVins } from './vin-extractor'

const PROVIDER_NAME = 'ocr.textract'

interface TextractClientLike {
  send(command: unknown): Promise<{ Blocks?: Array<{ BlockType?: string; Text?: string; Confidence?: number }> }>
}

interface TextractModule {
  TextractClient: new (config: { region: string }) => TextractClientLike
  DetectDocumentTextCommand: new (input: { Document: { Bytes: Uint8Array } }) => unknown
}

export class TextractOcrAdapter implements OcrProvider {
  readonly name = PROVIDER_NAME

  private readonly region: string

  constructor() {
    // `AWS_TEXTRACT_REGION` is not part of the shared server env contract
    // (`src/lib/env.ts`) — it is AWS SDK configuration, read directly.
    this.region = process.env.AWS_TEXTRACT_REGION ?? 'us-east-1'
  }

  async extractFromDocument(bytes: Uint8Array, _contentType: string): Promise<ExtractionResult> {
    let sdk: TextractModule
    try {
      // Deferred so a missing dependency only breaks the `textract` driver, never module load.
      // A variable (not a string literal) module specifier keeps TypeScript
      // from trying to resolve types for a package that may not be
      // installed — the whole expression is `Promise<any>` instead.
      const moduleName = '@aws-sdk/client-textract'
      sdk = (await import(moduleName)) as unknown as TextractModule
    } catch {
      logger.error('textract sdk not installed', { provider: PROVIDER_NAME })
      throw notConfiguredError(PROVIDER_NAME, 'integrations.ocr.sdkNotInstalled')
    }

    try {
      const client = new sdk.TextractClient({ region: this.region })
      const response = await client.send(
        new sdk.DetectDocumentTextCommand({ Document: { Bytes: bytes } }),
      )
      const lines = (response.Blocks ?? []).filter((b) => b.BlockType === 'LINE')
      const rawText = lines.map((b) => b.Text ?? '').join('\n')
      const confidences = lines.map((b) => b.Confidence ?? 0).filter((c) => c > 0)
      const confidence =
        confidences.length > 0 ? Math.round(confidences.reduce((a, b) => a + b, 0) / confidences.length) : 0

      return { rawText, vins: extractVins(rawText), confidence, provider: PROVIDER_NAME }
    } catch (error) {
      throw mapProviderError(PROVIDER_NAME, error, 'integrations.ocr.unavailable')
    }
  }
}
