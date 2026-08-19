/**
 * The load status machine.
 *
 * Thirteen statuses, encoded as data rather than scattered `if` statements,
 * so the whole table is reviewable in one place and exhaustively
 * unit-testable (see `tests/unit/loads/status-machine.test.ts`).
 *
 * `canTransition` is pure — no database access, no permission check. Who
 * may call `transitionStatus` at all is already decided by
 * `load:status:update` in the permission matrix (drivers simply do not hold
 * it, at any scope — see `catalog.ts` — so this file never special-cases
 * the driver role). What this file decides is narrower: whether the
 * *transition itself* is legal given the load's current status and the
 * facts the caller supplies about its readiness.
 */

export type LoadStatus =
  | 'draft'
  | 'available'
  | 'assigned'
  | 'dispatched'
  | 'en_route_to_pickup'
  | 'at_pickup'
  | 'in_transit'
  | 'at_delivery'
  | 'delivered'
  | 'pod_received'
  | 'invoiced'
  | 'paid'
  | 'cancelled'

export const LOAD_STATUSES: LoadStatus[] = [
  'draft',
  'available',
  'assigned',
  'dispatched',
  'en_route_to_pickup',
  'at_pickup',
  'in_transit',
  'at_delivery',
  'delivered',
  'pod_received',
  'invoiced',
  'paid',
  'cancelled',
]

/** Who/what initiated the transition. Recorded on every `loadStatusHistory` row. */
export type TransitionSource = 'user' | 'tracking_provider' | 'system_job' | 'webhook'

/**
 * The legal destinations from each status. `cancelled` is reachable from
 * every status up to and including `pod_received` — i.e. anything before
 * `invoiced` — and nothing leaves `paid` or `cancelled`.
 */
export const LOAD_STATUS_TRANSITIONS: Record<LoadStatus, LoadStatus[]> = {
  draft: ['available', 'cancelled'],
  available: ['assigned', 'cancelled'],
  assigned: ['dispatched', 'cancelled'],
  dispatched: ['en_route_to_pickup', 'cancelled'],
  en_route_to_pickup: ['at_pickup', 'cancelled'],
  at_pickup: ['in_transit', 'cancelled'],
  in_transit: ['at_delivery', 'cancelled'],
  at_delivery: ['delivered', 'cancelled'],
  delivered: ['pod_received', 'cancelled'],
  pod_received: ['invoiced', 'cancelled'],
  invoiced: ['paid'],
  paid: [],
  cancelled: [],
}

export interface TransitionContext {
  /** Required to move `available` → `assigned`. */
  hasCarrier?: boolean
  /** Required to move `assigned` → `dispatched` — the composite dispatch gate (`evaluateLoadForDispatch`). */
  dispatchGateOk?: boolean
  /** Required to move `delivered` → `pod_received` — an approved POD document exists. */
  hasApprovedPod?: boolean
  /** Required to move `pod_received` → `invoiced` — an invoice row exists for the load. */
  hasInvoice?: boolean
}

export interface TransitionDecision {
  allowed: boolean
  reasonKey?: string
  params?: Record<string, string | number>
}

function allowed(): TransitionDecision {
  return { allowed: true }
}

function blocked(reasonKey: string, params?: Record<string, string | number>): TransitionDecision {
  return { allowed: false, reasonKey, params }
}

/**
 * Decides whether `from → to` is legal right now. The transition-table check
 * comes first (an edge absent from the table is refused regardless of
 * context); the readiness checks below it only run for edges the table
 * already permits.
 */
export function canTransition(
  from: LoadStatus,
  to: LoadStatus,
  context: TransitionContext = {},
): TransitionDecision {
  if (from === to) {
    return blocked('errors.loadStatusTransition', { from, to })
  }

  const legalDestinations = LOAD_STATUS_TRANSITIONS[from]
  if (!legalDestinations.includes(to)) {
    return blocked('errors.loadStatusTransition', { from, to })
  }

  if (to === 'assigned' && !context.hasCarrier) {
    return blocked('load.errors.carrierRequiredForAssignment')
  }

  if (to === 'dispatched' && !context.dispatchGateOk) {
    return blocked('load.errors.dispatchGateBlocked')
  }

  if (to === 'pod_received' && !context.hasApprovedPod) {
    return blocked('load.errors.podRequired')
  }

  if (to === 'invoiced' && !context.hasInvoice) {
    return blocked('load.errors.invoiceRequired')
  }

  return allowed()
}

/** Every status a load may reach directly from `from`, ignoring readiness context — used to render available actions in the UI. */
export function legalDestinationsFrom(from: LoadStatus): LoadStatus[] {
  return LOAD_STATUS_TRANSITIONS[from]
}

export function isTerminalStatus(status: LoadStatus): boolean {
  return LOAD_STATUS_TRANSITIONS[status].length === 0
}
