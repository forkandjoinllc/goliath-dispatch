import 'server-only'
import type { z } from 'zod'

/**
 * The job-type registry.
 *
 * Every background effect the application can queue is one entry here,
 * mapping a `jobType` string to its payload schema, its handler, a default
 * `maxAttempts`, and a human-readable description. `runner.ts` is the only
 * caller: it looks a claimed row's `jobType` up here, validates `payload`
 * against `schema` *before* the handler ever sees it, and dead-letters
 * anything that matches neither — an unknown job type or a payload that
 * fails validation never throws an unhandled exception into the drain loop,
 * it fails the one row with a clear, inspectable reason.
 *
 * Every handler receives an explicit `tenantId` (nullable only for the
 * handful of platform-level sweep jobs that fan out into per-tenant work
 * themselves) — there is no ambient tenant anywhere in `src/jobs/**`.
 */

export interface JobContext {
  jobId: string
  tenantId: string | null
  /** 1-based count of the attempt currently running (includes this one). */
  attempt: number
  maxAttempts: number
  workerId: string
}

export type JobHandler<TPayload> = (payload: TPayload, ctx: JobContext) => Promise<void>

export interface JobDefinition<TPayload = unknown> {
  // The third (`Input`) type parameter is deliberately left as `unknown` /
  // unconstrained rather than defaulting to `TPayload`: a payload schema
  // with a `.default(...)` field (e.g. a locale) has an input type that is
  // narrower than its parsed output type (the field is optional going in,
  // required coming out), which `z.ZodType<TPayload>`'s default `Input =
  // TPayload` would otherwise reject. `src/server/reports/types.ts` hits
  // the exact same shape and resolves it the same way.
  schema: z.ZodType<TPayload, z.ZodTypeDef, any>
  handler: JobHandler<TPayload>
  defaultMaxAttempts: number
  description: string
}

const registry = new Map<string, JobDefinition<unknown>>()

/** Registers one job type. Called exactly once per type, at module load, from `registry/index` below. */
export function defineJob<TPayload>(jobType: string, definition: JobDefinition<TPayload>): void {
  if (registry.has(jobType)) {
    throw new Error(`Job type "${jobType}" is already registered`)
  }
  registry.set(jobType, definition as JobDefinition<unknown>)
}

export function getJobDefinition(jobType: string): JobDefinition<unknown> | undefined {
  return registry.get(jobType)
}

export function listJobTypes(): string[] {
  return [...registry.keys()]
}

/** Test-only: clears every registration so a unit test can register a throwaway job type in isolation. */
export function __resetRegistryForTests(): void {
  registry.clear()
}

export type { z }
