import { readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { NAMESPACES } from '../src/i18n/namespaces'

/**
 * Static i18n-usage sweep.
 *
 * Scans `src/**\/*.tsx` and `src/**\/*.ts` for `t('…')` and `messageKey: '…'`
 * string-literal calls, resolves each dotted key against the en dictionary
 * (parity tests already guarantee es matches), and reports any key that does
 * not resolve to a string leaf.
 *
 * Only *string-literal* keys are checked — a template-literal or otherwise
 * dynamically built key (`t(\`status.${status}\`)`) cannot be resolved
 * statically and is reported separately as "dynamic (unverified)" so a human
 * can spot-check the call site instead of the scanner silently ignoring it.
 *
 * Run via `npm run check:i18n`. Also exercised by
 * `tests/unit/i18n/usage-scan.test.ts` so a newly introduced unresolved key
 * fails the test suite, not just an ad-hoc script run.
 */

type MessageTree = { [key: string]: string | MessageTree }

export interface Finding {
  file: string
  line: number
  key: string
  reason: string
}

export interface ScanResult {
  missing: Finding[]
  dynamic: Finding[]
}

function loadNamespace(root: string, locale: 'en' | 'es', namespace: string): MessageTree {
  const path = join(root, 'src', 'i18n', 'messages', locale, `${namespace}.json`)
  return JSON.parse(readFileSync(path, 'utf8')) as MessageTree
}

function resolveKey(
  enDictionary: Record<string, MessageTree>,
  key: string,
): 'ok' | 'missing-namespace' | 'missing-key' | 'not-a-string' {
  const [namespace, ...rest] = key.split('.')
  if (!namespace || !(namespace in enDictionary)) return 'missing-namespace'
  let node: MessageTree | string | undefined = enDictionary[namespace]
  for (const segment of rest) {
    if (typeof node !== 'object' || node === null) return 'missing-key'
    node = node[segment]
  }
  if (node === undefined) return 'missing-key'
  return typeof node === 'string' ? 'ok' : 'not-a-string'
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      walk(full, out)
    } else if (extname(entry) === '.ts' || extname(entry) === '.tsx') {
      out.push(full)
    }
  }
  return out
}

/** Matches `t('key')`, `t("key")`, `t.optional('key')`, `t.has('key')`. */
const T_CALL_RE = /\bt(?:\.optional|\.has)?\(\s*(['"])((?:[^'"\\]|\\.)*)\1/g
/** Matches `t(\`...\`)` — a template literal call, always dynamic-or-static-mix. */
const T_TEMPLATE_RE = /\bt(?:\.optional|\.has)?\(\s*`((?:[^`\\]|\\.)*)`/g
/** Matches `messageKey: 'key'` / `messageKey: "key"` object properties. */
const MESSAGE_KEY_RE = /\bmessageKey\s*:\s*(['"])((?:[^'"\\]|\\.)*)\1/g
/** Matches `messageKey: \`...\`` — dynamic. */
const MESSAGE_KEY_TEMPLATE_RE = /\bmessageKey\s*:\s*`((?:[^`\\]|\\.)*)`/g

/** Runs the sweep against a given repo root. Exported for the CLI and for tests. */
export function scanI18nUsage(root: string): ScanResult {
  const src = join(root, 'src')
  const enDictionary: Record<string, MessageTree> = Object.fromEntries(
    NAMESPACES.map((ns) => [ns, loadNamespace(root, 'en', ns)]),
  )

  const missing: Finding[] = []
  const dynamic: Finding[] = []
  const files = walk(src)

  for (const file of files) {
    const content = readFileSync(file, 'utf8')
    const relPath = relative(root, file)
    const lines = content.split('\n')

    function lineOf(index: number): number {
      let count = 0
      let line = 1
      for (const l of lines) {
        count += l.length + 1
        if (index < count) return line
        line++
      }
      return lines.length
    }

    for (const re of [T_CALL_RE, MESSAGE_KEY_RE]) {
      re.lastIndex = 0
      let match: RegExpExecArray | null
      while ((match = re.exec(content))) {
        const key = match[2]
        if (!key || !key.includes('.')) continue // not a dotted i18n key literal

        // A literal immediately followed by `+` is string concatenation with
        // a dynamic suffix (e.g. `t('equipment.actions.' + actionKeyFor(x))`)
        // — the *literal* portion is expected to be an incomplete/prefix
        // path, not a resolvable key on its own. Treat it as dynamic.
        const afterMatch = content.slice(re.lastIndex).match(/^\s*(\+)?/)
        if (afterMatch?.[1] === '+') {
          dynamic.push({
            file: relPath,
            line: lineOf(match.index),
            key: `${key}<concat>`,
            reason: 'dynamic concat',
          })
          continue
        }

        const status = resolveKey(enDictionary, key)
        if (status !== 'ok') {
          missing.push({ file: relPath, line: lineOf(match.index), key, reason: status })
        }
      }
    }

    for (const re of [T_TEMPLATE_RE, MESSAGE_KEY_TEMPLATE_RE]) {
      re.lastIndex = 0
      let match: RegExpExecArray | null
      while ((match = re.exec(content))) {
        const key = match[1]
        if (!key) continue
        dynamic.push({ file: relPath, line: lineOf(match.index), key, reason: 'dynamic template' })
      }
    }
  }

  return { missing, dynamic }
}

function isMain(): boolean {
  if (!process.argv[1]) return false
  try {
    return fileURLToPath(import.meta.url) === resolve(process.argv[1])
  } catch {
    return false
  }
}

if (isMain()) {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const { missing, dynamic } = scanI18nUsage(root)

  if (missing.length > 0) {
    console.error(`\n✗ ${missing.length} unresolved i18n key(s):\n`)
    for (const m of missing) {
      console.error(`  ${m.file}:${m.line}  "${m.key}"  (${m.reason})`)
    }
  } else {
    console.log('✓ All statically-resolvable t()/messageKey string-literal keys resolve.')
  }

  console.log(`\n${dynamic.length} dynamic (template-literal) key usage(s) found — not statically verified:`)
  for (const d of dynamic) {
    console.log(`  ${d.file}:${d.line}  \`${d.key}\``)
  }

  if (missing.length > 0) {
    process.exitCode = 1
  }
}
