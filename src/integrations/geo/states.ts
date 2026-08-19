/**
 * US state adjacency and a same-package `statesBetween` fallback.
 *
 * Used by:
 *  - the mock router, to derive a plausible ordered state list between two
 *    cities with no routing engine at all;
 *  - any live route response that comes back without a state list — a
 *    degraded-but-useful path rather than an empty permits/escort workflow.
 *
 * This is a topological approximation (shortest hop count through
 * neighboring states), not a real route — it is not meant to replace a
 * geometry-based state lookup, only to keep the product usable without one.
 */

export type StateCode =
  | 'AL' | 'AK' | 'AZ' | 'AR' | 'CA' | 'CO' | 'CT' | 'DE' | 'FL' | 'GA' | 'HI' | 'ID' | 'IL' | 'IN'
  | 'IA' | 'KS' | 'KY' | 'LA' | 'ME' | 'MD' | 'MA' | 'MI' | 'MN' | 'MS' | 'MO' | 'MT' | 'NE' | 'NV'
  | 'NH' | 'NJ' | 'NM' | 'NY' | 'NC' | 'ND' | 'OH' | 'OK' | 'OR' | 'PA' | 'RI' | 'SC' | 'SD' | 'TN'
  | 'TX' | 'UT' | 'VT' | 'VA' | 'WA' | 'WV' | 'WI' | 'WY' | 'DC' | 'PR'

/** Land-border adjacency for the 48 contiguous states + DC. AK, HI and PR have no land neighbors. */
export const STATE_ADJACENCY: Record<StateCode, StateCode[]> = {
  AL: ['FL', 'GA', 'MS', 'TN'],
  AK: [],
  AZ: ['CA', 'CO', 'NM', 'NV', 'UT'],
  AR: ['LA', 'MS', 'MO', 'OK', 'TN', 'TX'],
  CA: ['AZ', 'NV', 'OR'],
  CO: ['AZ', 'KS', 'NE', 'NM', 'OK', 'UT', 'WY'],
  CT: ['MA', 'NY', 'RI'],
  DE: ['MD', 'NJ', 'PA'],
  FL: ['AL', 'GA'],
  GA: ['AL', 'FL', 'NC', 'SC', 'TN'],
  HI: [],
  ID: ['MT', 'NV', 'OR', 'UT', 'WA', 'WY'],
  IL: ['IN', 'IA', 'KY', 'MO', 'WI'],
  IN: ['IL', 'KY', 'MI', 'OH'],
  IA: ['IL', 'MN', 'MO', 'NE', 'SD', 'WI'],
  KS: ['CO', 'MO', 'NE', 'OK'],
  KY: ['IL', 'IN', 'MO', 'OH', 'TN', 'VA', 'WV'],
  LA: ['AR', 'MS', 'TX'],
  ME: ['NH'],
  MD: ['DE', 'PA', 'VA', 'WV', 'DC'],
  MA: ['CT', 'NH', 'NY', 'RI', 'VT'],
  MI: ['IN', 'OH', 'WI'],
  MN: ['IA', 'ND', 'SD', 'WI'],
  MS: ['AL', 'AR', 'LA', 'TN'],
  MO: ['AR', 'IL', 'IA', 'KS', 'KY', 'NE', 'OK', 'TN'],
  MT: ['ID', 'ND', 'SD', 'WY'],
  NE: ['CO', 'IA', 'KS', 'MO', 'SD', 'WY'],
  NV: ['AZ', 'CA', 'ID', 'OR', 'UT'],
  NH: ['ME', 'MA', 'VT'],
  NJ: ['DE', 'NY', 'PA'],
  NM: ['AZ', 'CO', 'OK', 'TX', 'UT'],
  NY: ['CT', 'MA', 'NJ', 'PA', 'VT'],
  NC: ['GA', 'SC', 'TN', 'VA'],
  ND: ['MN', 'MT', 'SD'],
  OH: ['IN', 'KY', 'MI', 'PA', 'WV'],
  OK: ['AR', 'CO', 'KS', 'MO', 'NM', 'TX'],
  OR: ['CA', 'ID', 'NV', 'WA'],
  PA: ['DE', 'MD', 'NJ', 'NY', 'OH', 'WV'],
  RI: ['CT', 'MA'],
  SC: ['GA', 'NC'],
  SD: ['IA', 'MN', 'MT', 'ND', 'NE', 'WY'],
  TN: ['AL', 'AR', 'GA', 'KY', 'MS', 'MO', 'NC', 'VA'],
  TX: ['AR', 'LA', 'NM', 'OK'],
  UT: ['AZ', 'CO', 'ID', 'NV', 'NM', 'WY'],
  VT: ['MA', 'NH', 'NY'],
  VA: ['KY', 'MD', 'NC', 'TN', 'WV', 'DC'],
  WA: ['ID', 'OR'],
  WV: ['KY', 'MD', 'OH', 'PA', 'VA'],
  WI: ['IL', 'IA', 'MI', 'MN'],
  WY: ['CO', 'ID', 'MT', 'NE', 'SD', 'UT'],
  DC: ['MD', 'VA'],
  PR: [],
}

/**
 * Shortest hop-count path of states between `fromState` and `toState`,
 * inclusive of both endpoints. Falls back to `[fromState, toState]` when no
 * land path exists (Alaska, Hawaii, Puerto Rico) rather than throwing — a
 * degraded two-state answer is more useful to a permits workflow than none.
 */
export function statesBetween(fromState: StateCode, toState: StateCode): StateCode[] {
  if (fromState === toState) return [fromState]

  const queue: StateCode[] = [fromState]
  const cameFrom = new Map<StateCode, StateCode>()
  const visited = new Set<StateCode>([fromState])

  while (queue.length > 0) {
    const current = queue.shift() as StateCode
    if (current === toState) {
      const path: StateCode[] = [current]
      let step = current
      while (cameFrom.has(step)) {
        step = cameFrom.get(step) as StateCode
        path.unshift(step)
      }
      return path
    }
    for (const neighbor of STATE_ADJACENCY[current] ?? []) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor)
        cameFrom.set(neighbor, current)
        queue.push(neighbor)
      }
    }
  }

  // No land path (e.g. AK/HI/PR involved) — degrade to the two endpoints.
  return [fromState, toState]
}
