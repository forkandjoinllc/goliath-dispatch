import 'server-only'
import { z } from 'zod'
import { AppError, isAppError, validationFailed } from '@/lib/errors'
import { logger } from '@/lib/logger'
import { authorize, type PermissionKey, type ResourceContext, type Actor } from '@/lib/permissions'
import { recordAudit, type AuditInput } from '@/lib/audit'
import { getRequestMeta, getTenantPolicy, requireActor } from './context'
import { tenantDb, type TenantDb } from '@/db/tenant-db'

/**
 * Server-action harness.
 *
 * Every mutation in the application is declared through `defineAction`, which
 * guarantees, in order:
 *   1. an authenticated Actor,
 *   2. Zod validation of the input,
 *   3. a server-side permission check (never a role-name comparison),
 *   4. a tenant-bound database handle,
 *   5. an audit event,
 *   6. an error shape the client can render in either language.
 *
 * Skipping a step is not possible without writing a bespoke action, which code
 * review can see immediately.
 */

export interface ActionSuccess<T> {
  ok: true
  data: T
}

export interface ActionFailure {
  ok: false
  error: { code: string; messageKey: string; params: Record<string, string | number> }
  /** Field-level messages keyed by dotted form path, for React Hook Form. */
  fieldErrors?: Record<string, string[]>
}

export type ActionResult<T> = ActionSuccess<T> | ActionFailure

export interface ActionContext {
  actor: Actor & { tenantId: string }
  db: TenantDb
  request: { ipAddress: string | null; userAgent: string | null; requestId: string }
  /** Records an audit event with the actor and request already applied. */
  audit: (input: AuditInput) => Promise<void>
}

export interface DefineActionOptions<TInput, TOutput> {
  name: string
  /** Permission required to run. Use `null` only for self-service actions. */
  permission: PermissionKey | null
  input: z.ZodType<TInput>
  /** Derives the resource facts used to evaluate a narrow scope. */
  resource?: (input: TInput, ctx: { actor: Actor }) => ResourceContext | Promise<ResourceContext>
  handler: (input: TInput, ctx: ActionContext) => Promise<TOutput>
  /** Audit written automatically on success. */
  audit?: (input: TInput, output: TOutput, ctx: ActionContext) => AuditInput | null
}

export function defineAction<TInput, TOutput>(options: DefineActionOptions<TInput, TOutput>) {
  return async function run(rawInput: unknown): Promise<ActionResult<TOutput>> {
    const request = await getRequestMeta()
    const log = logger.child({ action: options.name, requestId: request.requestId })

    try {
      const actor = await requireActor()
      if (!actor.tenantId) {
        throw new AppError('forbidden', 'errors.forbidden')
      }

      const parsed = options.input.safeParse(rawInput)
      if (!parsed.success) {
        return {
          ok: false,
          error: {
            code: 'validation_failed',
            messageKey: 'errors.validationFailed',
            params: {},
          },
          fieldErrors: flattenIssues(parsed.error),
        }
      }

      if (options.permission) {
        const policy = await getTenantPolicy(actor.tenantId)
        const resource = options.resource
          ? await options.resource(parsed.data, { actor })
          : undefined
        authorize(actor, options.permission, resource, policy)
      }

      const db = tenantDb(actor.tenantId)
      const ctx: ActionContext = {
        actor: actor as Actor & { tenantId: string },
        db,
        request,
        audit: (input) => recordAudit(actor, request, input),
      }

      const output = await options.handler(parsed.data, ctx)

      const auditInput = options.audit?.(parsed.data, output, ctx)
      if (auditInput) await recordAudit(actor, request, auditInput)

      return { ok: true, data: output }
    } catch (error) {
      if (isAppError(error)) {
        if (error.code === 'internal') {
          log.error('Action failed', { error, detail: error.detail })
        } else {
          log.info('Action rejected', { code: error.code, messageKey: error.messageKey })
        }
        return { ok: false, error: error.toClient() }
      }

      log.error('Unhandled action error', { error })
      return {
        ok: false,
        error: { code: 'internal', messageKey: 'errors.internal', params: {} },
      }
    }
  }
}

/**
 * Read-side equivalent: enforces the permission and returns a tenant handle,
 * throwing rather than returning a result shape (React Server Components render
 * an error boundary instead).
 */
export async function loadFor(
  permission: PermissionKey,
  resource?: ResourceContext,
): Promise<ActionContext> {
  const actor = await requireActor()
  if (!actor.tenantId) throw new AppError('forbidden', 'errors.forbidden')
  const request = await getRequestMeta()
  const policy = await getTenantPolicy(actor.tenantId)
  authorize(actor, permission, resource, policy)
  return {
    actor: actor as Actor & { tenantId: string },
    db: tenantDb(actor.tenantId),
    request,
    audit: (input) => recordAudit(actor, request, input),
  }
}

function flattenIssues(error: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const issue of error.issues) {
    const path = issue.path.join('.') || '_root'
    ;(out[path] ??= []).push(issue.message)
  }
  return out
}

export function actionFailure(error: unknown): ActionFailure {
  if (isAppError(error)) return { ok: false, error: error.toClient() }
  return { ok: false, error: { code: 'internal', messageKey: 'errors.internal', params: {} } }
}

export { validationFailed }
