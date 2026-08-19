import { describe, expect, it } from 'vitest'
import {
  LOAD_STATUSES,
  LOAD_STATUS_TRANSITIONS,
  canTransition,
  isTerminalStatus,
  legalDestinationsFrom,
  type LoadStatus,
} from '@/server/loads/status-machine'

const READY_CONTEXT = {
  hasCarrier: true,
  dispatchGateOk: true,
  hasApprovedPod: true,
  hasInvoice: true,
}

describe('canTransition — every legal edge', () => {
  for (const from of LOAD_STATUSES) {
    for (const to of legalDestinationsFrom(from)) {
      it(`allows ${from} → ${to} once every readiness fact is satisfied`, () => {
        expect(canTransition(from, to, READY_CONTEXT)).toEqual({ allowed: true })
      })
    }
  }
})

describe('canTransition — a representative set of illegal edges', () => {
  const illegalEdges: Array<[LoadStatus, LoadStatus]> = [
    ['draft', 'dispatched'],
    ['draft', 'in_transit'],
    ['draft', 'invoiced'],
    ['available', 'dispatched'],
    ['available', 'delivered'],
    ['assigned', 'available'],
    ['assigned', 'pod_received'],
    ['dispatched', 'assigned'],
    ['dispatched', 'delivered'],
    ['en_route_to_pickup', 'in_transit'],
    ['at_pickup', 'at_delivery'],
    ['in_transit', 'delivered'],
    ['at_delivery', 'pod_received'],
    ['delivered', 'invoiced'],
    ['pod_received', 'paid'],
    ['invoiced', 'draft'],
  ]

  for (const [from, to] of illegalEdges) {
    it(`refuses ${from} → ${to}`, () => {
      const decision = canTransition(from, to, READY_CONTEXT)
      expect(decision.allowed).toBe(false)
      expect(decision.reasonKey).toBe('errors.loadStatusTransition')
    })
  }

  it('refuses a status transitioning to itself', () => {
    for (const status of LOAD_STATUSES) {
      expect(canTransition(status, status).allowed).toBe(false)
    }
  })
})

describe('canTransition — nothing leaves paid or cancelled', () => {
  for (const from of ['paid', 'cancelled'] as const) {
    it(`${from} has no legal destinations at all`, () => {
      expect(legalDestinationsFrom(from)).toEqual([])
      expect(isTerminalStatus(from)).toBe(true)
    })

    for (const to of LOAD_STATUSES) {
      if (to === from) continue
      it(`refuses ${from} → ${to}`, () => {
        expect(canTransition(from, to, READY_CONTEXT).allowed).toBe(false)
      })
    }
  }
})

describe('canTransition — cancellation is reachable from anything before invoiced, and only from there', () => {
  const cancellableFrom: LoadStatus[] = [
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
  ]

  for (const from of cancellableFrom) {
    it(`allows ${from} → cancelled`, () => {
      expect(canTransition(from, 'cancelled').allowed).toBe(true)
    })
  }

  for (const from of ['invoiced', 'paid'] as const) {
    it(`refuses ${from} → cancelled`, () => {
      expect(canTransition(from, 'cancelled').allowed).toBe(false)
    })
  }
})

describe('canTransition — readiness gates', () => {
  it('refuses available → assigned without a carrier', () => {
    const decision = canTransition('available', 'assigned', { ...READY_CONTEXT, hasCarrier: false })
    expect(decision).toEqual({ allowed: false, reasonKey: 'load.errors.carrierRequiredForAssignment' })
  })

  it('refuses assigned → dispatched while the dispatch gate is not clear', () => {
    const decision = canTransition('assigned', 'dispatched', { ...READY_CONTEXT, dispatchGateOk: false })
    expect(decision).toEqual({ allowed: false, reasonKey: 'load.errors.dispatchGateBlocked' })
  })

  it('refuses delivered → pod_received without an approved POD', () => {
    const decision = canTransition('delivered', 'pod_received', { ...READY_CONTEXT, hasApprovedPod: false })
    expect(decision).toEqual({ allowed: false, reasonKey: 'load.errors.podRequired' })
  })

  it('refuses pod_received → invoiced without an invoice', () => {
    const decision = canTransition('pod_received', 'invoiced', { ...READY_CONTEXT, hasInvoice: false })
    expect(decision).toEqual({ allowed: false, reasonKey: 'load.errors.invoiceRequired' })
  })

  it('allows invoiced → paid with no extra readiness facts required', () => {
    expect(canTransition('invoiced', 'paid')).toEqual({ allowed: true })
  })
})

describe('LOAD_STATUS_TRANSITIONS — table shape', () => {
  it('covers exactly the 13 documented statuses', () => {
    expect(Object.keys(LOAD_STATUS_TRANSITIONS).sort()).toEqual([...LOAD_STATUSES].sort())
    expect(LOAD_STATUSES).toHaveLength(13)
  })
})
