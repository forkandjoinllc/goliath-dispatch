import 'server-only'
import { z } from 'zod'
import type { ReportDefinition } from './types'

/**
 * Generic introspection of a report's own filter schema, so the filter bar
 * never needs a bespoke per-report component. Every report's `filterSchema`
 * is a `z.object(...)` at runtime (only the exported type is widened to
 * `z.ZodType<...>` for the `.default()` variance workaround — see
 * `types.ts`), so this can walk `.shape` safely. `range` is excluded: the
 * date-range preset picker is handled separately by every report that sets
 * `supportsDateRange`.
 */

export interface ReportFilterFieldDescriptor {
  key: string
  kind: 'enum' | 'string' | 'uuid' | 'boolean'
  options?: string[]
  optional: boolean
}

function unwrap(schema: z.ZodTypeAny): z.ZodTypeAny {
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) return unwrap(schema.unwrap())
  if (schema instanceof z.ZodDefault) return unwrap(schema._def.innerType)
  return schema
}

export function reportFilterFields<TFilters>(definition: ReportDefinition<TFilters>): ReportFilterFieldDescriptor[] {
  const schema = definition.filterSchema as unknown as z.ZodTypeAny
  if (!(schema instanceof z.ZodObject)) return []

  const fields: ReportFilterFieldDescriptor[] = []
  for (const [key, raw] of Object.entries(schema.shape as Record<string, z.ZodTypeAny>)) {
    if (key === 'range') continue
    const optional = raw instanceof z.ZodOptional || raw instanceof z.ZodDefault
    const inner = unwrap(raw)

    if (inner instanceof z.ZodEnum) {
      fields.push({ key, kind: 'enum', options: inner.options as string[], optional })
    } else if (inner instanceof z.ZodBoolean) {
      fields.push({ key, kind: 'boolean', optional })
    } else if (inner instanceof z.ZodString) {
      const isUuid = inner._def.checks?.some((c: { kind: string }) => c.kind === 'uuid')
      fields.push({ key, kind: isUuid ? 'uuid' : 'string', optional })
    }
  }
  return fields
}
