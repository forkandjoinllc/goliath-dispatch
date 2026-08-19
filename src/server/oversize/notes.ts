/**
 * Guidance note encoding.
 *
 * `oversizeEvaluations.stateResults[].notes` / `.travelRestrictions` and
 * `missingDataWarnings` are all typed `string[]` in the schema (a plain
 * array of strings, not `{ key, params }` objects) — but every engine-emitted
 * statement must still be a translatable key with params, never baked
 * English/Spanish prose. This module is the one place that reconciles the
 * two: it encodes a key and its params into a single string the schema can
 * hold, and decodes it back on the read side (the oversize panel component
 * and the unit tests are the only other callers).
 *
 * Encoding: `key` or `key?param1=value1&param2=value2` (values URL-encoded).
 * Deliberately not JSON — this stays greppable in a database client and
 * trivially distinguishes "no params" from "empty params object".
 */

export interface GuidanceNote {
  key: string
  params: Record<string, string>
}

export function encodeGuidanceNote(key: string, params?: Record<string, string | number>): string {
  if (!params || Object.keys(params).length === 0) return key
  const query = Object.entries(params)
    .map(([name, value]) => `${name}=${encodeURIComponent(String(value))}`)
    .join('&')
  return `${key}?${query}`
}

export function decodeGuidanceNote(note: string): GuidanceNote {
  const separatorIndex = note.indexOf('?')
  if (separatorIndex === -1) return { key: note, params: {} }

  const key = note.slice(0, separatorIndex)
  const query = note.slice(separatorIndex + 1)
  const params: Record<string, string> = {}
  for (const pair of query.split('&')) {
    if (!pair) continue
    const [name, value] = pair.split('=')
    if (name) params[name] = decodeURIComponent(value ?? '')
  }
  return { key, params }
}
