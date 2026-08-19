import path from 'node:path'
import type { Locator } from '@playwright/test'

/** `tests/e2e/fixtures/**` — tiny, deliberately synthetic files, never real scanned documents. */
const FIXTURES_DIR = path.resolve(__dirname, '../fixtures')

export type FixtureFile = 'sample.pdf' | 'sample.jpg'

/** Resolves a fixture name to its absolute path under `tests/e2e/fixtures/`. */
export function fixturePath(name: FixtureFile): string {
  return path.join(FIXTURES_DIR, name)
}

/** Sets a fixture file on a native `<input type="file">` locator. */
export async function uploadFixture(input: Locator, name: FixtureFile): Promise<void> {
  await input.setInputFiles(fixturePath(name))
}
