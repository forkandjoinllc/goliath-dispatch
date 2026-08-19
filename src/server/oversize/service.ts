import 'server-only'
import { desc, eq } from 'drizzle-orm'
import type { TenantDb } from '@/db/tenant-db'
import { loads, oversizeEvaluations, type OversizeEvaluation } from '@/db/schema'
import { notFound } from '@/lib/errors'
import { currentOrCalculateRoute } from '@/server/routes/service'
import { ensureRequiredEscorts, ensureRequiredPermits } from '@/server/permits/service'
import { evaluateOversize, type OversizeLoadInputs } from './evaluate'
import { encodeGuidanceNote } from './notes'
import { getRulesForStates, toEngineRuleInput } from './rules'

/**
 * `runEvaluation` and `validateEvaluation` — the persisted half of the
 * oversize engine. `evaluateOversize` (pure) decides the outcome;
 * everything here is plumbing: gathering inputs, snapshotting them so a
 * later dimension edit can never rewrite history (`gates.ts`'s
 * `isEvaluationCurrentForLoad` reads `inputs` for exactly that reason), and
 * turning "this state needs a permit/escort" into an actionable `pending`
 * row via `src/server/permits/service.ts`.
 */

export interface RunEvaluationExtraInputs {
  /** Not a load column — entered at evaluation time (see `evaluate.ts`'s header comment). */
  axleWeightPounds?: number | null
  /** Overrides `loads.axleConfiguration` for this evaluation only, if provided. */
  axleConfiguration?: string | null
}

export async function runEvaluation(
  db: TenantDb,
  loadId: string,
  extra: RunEvaluationExtraInputs = {},
): Promise<OversizeEvaluation> {
  const load = await db.requireById(loads, loadId, 'load')

  const route = await currentOrCalculateRoute(db, loadId)
  const stateCodes = route?.states.map((s) => s.stateCode) ?? []
  const rules = await getRulesForStates(db, stateCodes)

  const engineInputs: OversizeLoadInputs = {
    widthInches: load.widthInches,
    heightInches: load.heightInches,
    lengthInches: load.lengthInches,
    grossWeightPounds: load.grossVehicleWeightPounds,
    axleWeightPounds: extra.axleWeightPounds ?? null,
    axleConfiguration: extra.axleConfiguration ?? load.axleConfiguration,
  }

  const result = evaluateOversize(engineInputs, rules.map(toEngineRuleInput))

  const missingDataWarnings = [...result.missingDataWarnings]
  if (!route) {
    missingDataWarnings.push(encodeGuidanceNote('oversize.warnings.noRoute'))
  }

  return db.transaction(async (tx) => {
    const created = await tx.insert(oversizeEvaluations, {
      loadId,
      routeId: route?.route.id ?? null,
      outcome: result.outcome,
      permitLikelyRequired: result.permitLikelyRequired,
      escortLikelyRequired: result.escortLikelyRequired,
      policeEscortLikelyRequired: result.policeEscortLikelyRequired,
      inputs: {
        // `weightPounds` mirrors `loads.weightPounds` (cargo weight) purely
        // so `compliance/gates.ts`'s dimension comparison can detect
        // staleness on a later edit — the legal gross-weight check itself
        // runs against `grossVehicleWeightPounds` below, which is what
        // `evaluateOversize` actually compared against each state's limit.
        weightPounds: load.weightPounds,
        lengthInches: load.lengthInches,
        widthInches: load.widthInches,
        heightInches: load.heightInches,
        grossVehicleWeightPounds: load.grossVehicleWeightPounds,
        axleWeightPounds: engineInputs.axleWeightPounds,
        axleConfiguration: engineInputs.axleConfiguration,
        routeStates: stateCodes,
      },
      stateResults: result.stateResults,
      missingDataWarnings,
      humanValidationStatus: 'pending',
      evaluatedAt: new Date(),
    })

    const permitStates = result.stateResults.filter((r) => r.permitRequired).map((r) => r.stateCode)
    await ensureRequiredPermits(tx, loadId, permitStates)

    const escortRequirements = result.stateResults
      .filter((r) => r.escortRequired)
      .map((r) => ({ stateCode: r.stateCode, escortType: 'pilot_car' as const }))
    const policeRequirements = result.stateResults
      .filter((r) => r.policeEscortRequired)
      .map((r) => ({ stateCode: r.stateCode, escortType: 'police' as const }))
    await ensureRequiredEscorts(tx, loadId, [...escortRequirements, ...policeRequirements])

    return created
  })
}

export async function getCurrentEvaluation(db: TenantDb, loadId: string): Promise<OversizeEvaluation | null> {
  return db.findFirst(oversizeEvaluations, {
    where: eq(oversizeEvaluations.loadId, loadId),
    orderBy: desc(oversizeEvaluations.evaluatedAt),
  })
}

export async function listEvaluationsForLoad(db: TenantDb, loadId: string): Promise<OversizeEvaluation[]> {
  return db.findMany(oversizeEvaluations, {
    where: eq(oversizeEvaluations.loadId, loadId),
    orderBy: desc(oversizeEvaluations.evaluatedAt),
  })
}

export interface ValidateEvaluationInput {
  status: 'validated' | 'rejected'
  notes?: string | null
}

/**
 * The human sign-off `compliance/gates.ts::oversizeGate` requires before
 * dispatch. Admin-only in practice (`oversize:validate`) — enforced by the
 * permission matrix, not re-checked here; `evaluateLoadForDispatch` re-reads
 * `validatedByUserId`'s actual role before trusting this row, as defence in
 * depth against a future permission-override grant.
 */
export async function validateEvaluation(
  db: TenantDb,
  actor: { userId: string },
  evaluationId: string,
  input: ValidateEvaluationInput,
): Promise<OversizeEvaluation> {
  await db.requireById(oversizeEvaluations, evaluationId, 'oversizeEvaluation')

  const updated = await db.update(oversizeEvaluations, evaluationId, {
    humanValidationStatus: input.status,
    validatedByUserId: actor.userId,
    validatedAt: new Date(),
    validationNotes: input.notes ?? null,
  })
  if (!updated) throw notFound('errors.notFound', { entity: 'oversizeEvaluation' })
  return updated
}
