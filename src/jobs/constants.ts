/**
 * Shared sentinel for background work.
 *
 * A background job has no signed-in user. `runVerification`'s
 * `RunVerificationOptions.actorUserId` is typed `string` but — verified by
 * reading `src/server/verification/fmcsa-service.ts` — is never written to a
 * database column, so a non-UUID marker string is safe there specifically.
 * It must NOT be reused anywhere an `actorUserId`/`userId` is actually
 * persisted to a `uuid` foreign-key column (e.g. `loadStatusHistory.actorUserId`,
 * `financialSnapshots.computedByUserId`) — those take `null` instead, exactly
 * like `finance/snapshots.ts`'s own system-triggered recomputes do.
 */
export const SYSTEM_ACTOR_USER_ID = 'system:jobs'
