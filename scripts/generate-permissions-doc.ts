#!/usr/bin/env tsx
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import {
  ALL_PERMISSION_KEYS,
  PERMISSIONS,
  resolveRoleMatrix,
  permissionParts,
  type PermissionKey,
} from '../src/lib/permissions/catalog'
import type { Role, Scope } from '../src/lib/permissions/types'

/**
 * Generates `docs/permissions.md` from `src/lib/permissions/catalog.ts` — the
 * single authoritative statement of the permission matrix — so the document
 * cannot drift from the code. Run via `npm run docs:permissions`.
 *
 * `tests/unit/permissions/generate-permissions-doc.test.ts` asserts the
 * committed file matches this function's output byte-for-byte, so a matrix
 * change that forgets to regenerate the doc fails CI.
 */

const ROLES: Role[] = ['platform_super_admin', 'admin', 'accounting', 'dispatcher', 'carrier', 'driver']

const ROLE_LABELS: Record<Role, string> = {
  platform_super_admin: 'Super Admin',
  admin: 'Admin',
  accounting: 'Accounting',
  dispatcher: 'Dispatcher',
  carrier: 'Carrier',
  driver: 'Driver',
}

const SCOPE_DESCRIPTIONS: Record<Scope, string> = {
  platform: 'Across every tenant on the platform. Held only by the Platform Super Admin, and only for platform-level permissions — reaching into a specific tenant\'s operational data additionally requires an explicit support-access session (`platform:tenant:support_access`).',
  tenant: 'Every record inside the acting tenant.',
  assigned: 'Only records reachable through an explicit assignment — a Dispatcher\'s assigned carriers, and the trucks, trailers, drivers and groups granted to them directly or through a group they own.',
  carrier: "Only records belonging to the actor's own carrier company.",
  own: 'Only records the actor personally owns or created.',
}

function scopeCell(scope: Scope | undefined): string {
  return scope ? `\`${scope}\`` : '—'
}

function buildMatrixTable(): string {
  const header = `| Permission | Description | ${ROLES.map((r) => ROLE_LABELS[r]).join(' | ')} |`
  const divider = `|---|---|${ROLES.map(() => '---').join('|')}|`
  const rows = ALL_PERMISSION_KEYS.map((key) => {
    const description = PERMISSIONS[key]
    const cells = ROLES.map((role) => {
      const matrix = resolveRoleMatrix(role, null)
      return scopeCell(matrix[key])
    })
    return `| \`${key}\` | ${description} | ${cells.join(' | ')} |`
  })
  return [header, divider, ...rows].join('\n')
}

function buildResourceGroupedTable(): string {
  const groups = new Map<string, PermissionKey[]>()
  for (const key of ALL_PERMISSION_KEYS) {
    const { resource } = permissionParts(key)
    const list = groups.get(resource) ?? []
    list.push(key)
    groups.set(resource, list)
  }

  const sections: string[] = []
  for (const [resource, keys] of groups) {
    const header = `#### \`${resource}\``
    const tableHeader = `| Permission | Description | ${ROLES.map((r) => ROLE_LABELS[r]).join(' | ')} |`
    const divider = `|---|---|${ROLES.map(() => '---').join('|')}|`
    const rows = keys.map((key) => {
      const description = PERMISSIONS[key]
      const cells = ROLES.map((role) => scopeCell(resolveRoleMatrix(role, null)[key]))
      return `| \`${key}\` | ${description} | ${cells.join(' | ')} |`
    })
    sections.push([header, '', tableHeader, divider, ...rows].join('\n'))
  }
  return sections.join('\n\n')
}

function buildStructuralGuaranteesSection(): string {
  const accountingMatrix = resolveRoleMatrix('accounting', null)
  const driverMatrix = resolveRoleMatrix('driver', null)

  const loadWriteKeys: PermissionKey[] = ['load:create', 'load:update', 'load:assign_resources', 'load:assign_carrier']
  const missingFromAccounting = loadWriteKeys.filter((key) => !accountingMatrix[key])
  const statusKeyMissingFromDriver = !driverMatrix['load:status:update']

  const lines: string[] = []
  lines.push('### Structural guarantees')
  lines.push('')
  lines.push(
    'Two rules the product depends on are expressed structurally — by the *absence* of a permission from a role\'s matrix in `catalog.ts` — rather than by a runtime `if` somewhere that could be forgotten in one code path.',
  )
  lines.push('')
  lines.push('**Accounting cannot create or modify operational loads.** The following permissions are absent from the Accounting matrix:')
  lines.push('')
  for (const key of loadWriteKeys) {
    const held = accountingMatrix[key]
    lines.push(`- \`${key}\` — ${held ? `⚠️ present at \`${held}\` scope (guarantee violated)` : 'absent ✓'}`)
  }
  lines.push('')
  if (missingFromAccounting.length !== loadWriteKeys.length) {
    lines.push('> **Warning:** the generator detected that Accounting now holds one or more of these permissions. This guarantee no longer holds — review `catalog.ts`.')
    lines.push('')
  }
  lines.push('**Drivers do not change load status.** Status moves come only from tracking ingestion or a Dispatcher/Admin:')
  lines.push('')
  lines.push(`- \`load:status:update\` — ${statusKeyMissingFromDriver ? 'absent from the Driver matrix ✓' : `⚠️ present at \`${driverMatrix['load:status:update']}\` scope (guarantee violated)`}`)
  lines.push('')
  return lines.join('\n')
}

export function generatePermissionsDoc(): string {
  const generatedAtNotice =
    'This file is generated by `scripts/generate-permissions-doc.ts` (`npm run docs:permissions`) from `src/lib/permissions/catalog.ts`. Do not hand-edit — regenerate instead.'

  return `# Permission matrix

> ${generatedAtNotice}

## Scopes

A grant names a scope; the resource being acted on decides whether it actually falls inside that scope (\`resourceInScope()\` in \`src/lib/permissions/check.ts\`). Scopes rank \`own\` < \`carrier\` < \`assigned\` < \`tenant\` < \`platform\`, and when an actor holds more than one grant for a permission (e.g. a role grant plus a per-user override), the widest wins before the resource check narrows it back down.

${(Object.entries(SCOPE_DESCRIPTIONS) as Array<[Scope, string]>).map(([scope, description]) => `- **\`${scope}\`** — ${description}`).join('\n')}

## The tenant-configurable exception

Every grant in this document reflects the matrix with \`allowDispatcherResourceAssignment\` **off** (the default). \`resolveRoleMatrix()\` in \`catalog.ts\` is the single place this exception is applied: when a tenant turns the setting on, the Dispatcher role additionally gains:

- \`load:assign_resources\` at \`assigned\` scope

With the setting off, only an Admin may assign trucks, trailers and drivers to a load. This is the one place a tenant's own configuration — not a role change, not an override — widens a role's grants, and it is visible in exactly one function rather than scattered \`if (settings.x)\` checks.

${buildStructuralGuaranteesSection()}

## Full matrix

${buildMatrixTable()}

## By resource

${buildResourceGroupedTable()}
`
}

function isMainModule(): boolean {
  try {
    return fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? '')
  } catch {
    return false
  }
}

if (isMainModule()) {
  const outputPath = resolve(process.cwd(), 'docs/permissions.md')
  writeFileSync(outputPath, generatePermissionsDoc(), 'utf8')
  console.log(`Wrote ${outputPath}`)
}
