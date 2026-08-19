import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { generatePermissionsDoc } from '../../../scripts/generate-permissions-doc'

/**
 * Guards against `docs/permissions.md` drifting from `catalog.ts`: if the
 * matrix changes and someone forgets `npm run docs:permissions`, this fails
 * CI rather than shipping a stale document.
 */
describe('docs/permissions.md generation', () => {
  it('matches freshly generated output from the current permission catalog', () => {
    const committed = readFileSync(resolve(process.cwd(), 'docs/permissions.md'), 'utf8')
    const fresh = generatePermissionsDoc()
    expect(committed).toBe(fresh)
  })

  it('flags the Accounting load-write guarantee as holding', () => {
    const doc = generatePermissionsDoc()
    expect(doc).toContain('`load:create` — absent ✓')
    expect(doc).toContain('`load:update` — absent ✓')
    expect(doc).toContain('`load:assign_resources` — absent ✓')
    expect(doc).toContain('`load:assign_carrier` — absent ✓')
  })

  it('flags the Driver status-change guarantee as holding', () => {
    const doc = generatePermissionsDoc()
    expect(doc).toContain('`load:status:update` — absent from the Driver matrix ✓')
  })
})
