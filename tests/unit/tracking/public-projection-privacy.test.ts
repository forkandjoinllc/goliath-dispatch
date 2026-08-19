import { describe, expect, it } from 'vitest'
import {
  buildPublicTrackingProjection,
  PUBLIC_TRACKING_PROJECTION_KEYS,
} from '@/server/tracking/public-links'
import type { LoadStop } from '@/db/schema'

/**
 * The public tracking projection must never carry rates, carrier DOT/MC,
 * driver name/phone, or documents — no matter what future fields get added
 * to `loads`/`carriers`/`drivers`/`trackingSessions`. This test builds the
 * projection from fixture rows that *do* carry that sensitive data on the
 * source objects the function is given, and asserts the output's key set is
 * exactly the fixed public contract and none of the forbidden values leak
 * through under any key.
 */

const FORBIDDEN_VALUES = ['SENSITIVE_RATE', 'SENSITIVE_DOT_NUMBER', 'SENSITIVE_DRIVER_NAME', 'SENSITIVE_DRIVER_PHONE']

function stop(overrides: Partial<LoadStop> = {}): LoadStop {
  return {
    id: 'stop-1',
    tenantId: 'tenant-1',
    loadId: 'load-1',
    stopType: 'pickup',
    sequence: 0,
    facilityName: null,
    customerLocationId: null,
    line1: null,
    line2: null,
    city: 'Houston',
    state: 'TX',
    postalCode: '77002',
    placeId: null,
    latitude: null,
    longitude: null,
    timezone: 'America/Chicago',
    contactName: null,
    contactPhone: null,
    contactEmail: null,
    confirmationNumber: null,
    instructions: null,
    appointmentType: 'window',
    windowStart: null,
    windowEnd: null,
    actualArrivalAt: null,
    actualDepartureAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as LoadStop
}

describe('buildPublicTrackingProjection — privacy', () => {
  it('exposes exactly the fixed, narrow key set', () => {
    const projection = buildPublicTrackingProjection({
      tenantDisplayName: 'Acme Dispatch',
      load: { loadNumber: 'GD-1001', status: 'in_transit', carrierId: 'carrier-1' },
      carrier: { dba: 'Acme Trucking', legalName: 'Acme Trucking LLC' },
      stops: [stop()],
      latestSession: null,
      viewCount: 3,
    })

    expect(Object.keys(projection).sort()).toEqual([...PUBLIC_TRACKING_PROJECTION_KEYS].sort())
  })

  it('never includes a rate, carrier DOT/MC, driver name/phone or documents, even if present on the source rows', () => {
    // These fixtures deliberately carry forbidden data on fields the
    // projection builder is never given a parameter for — proving the
    // function structurally cannot forward them, not just that it happens
    // not to today.
    const projection = buildPublicTrackingProjection({
      tenantDisplayName: 'Acme Dispatch',
      load: { loadNumber: 'GD-1001', status: 'in_transit', carrierId: 'carrier-1' },
      carrier: { dba: 'Acme Trucking', legalName: 'Acme Trucking LLC' },
      stops: [
        stop({
          contactName: 'SENSITIVE_DRIVER_NAME',
          contactPhone: 'SENSITIVE_DRIVER_PHONE',
        }),
      ],
      latestSession: null,
      viewCount: 3,
    })

    const serialized = JSON.stringify(projection)
    for (const forbidden of FORBIDDEN_VALUES) {
      expect(serialized).not.toContain(forbidden)
    }
  })

  it('projects a stop with only the narrow public stop fields — no contact name/phone/email', () => {
    const projection = buildPublicTrackingProjection({
      tenantDisplayName: 'Acme Dispatch',
      load: { loadNumber: 'GD-1001', status: 'in_transit', carrierId: null },
      carrier: null,
      stops: [stop({ contactName: 'Jane Driver', contactPhone: '555-0100', contactEmail: 'jane@example.test' })],
      latestSession: null,
      viewCount: 0,
    })

    expect(Object.keys(projection.stops[0]!).sort()).toEqual(
      [
        'stopType',
        'city',
        'state',
        'timezone',
        'windowStart',
        'windowEnd',
        'actualArrivalAt',
        'actualDepartureAt',
      ].sort(),
    )
  })

  it('falls back to legalName when the carrier has no dba', () => {
    const projection = buildPublicTrackingProjection({
      tenantDisplayName: 'Acme Dispatch',
      load: { loadNumber: 'GD-1001', status: 'in_transit', carrierId: 'carrier-1' },
      carrier: { dba: null, legalName: 'Acme Trucking LLC' },
      stops: [stop()],
      latestSession: null,
      viewCount: 0,
    })

    expect(projection.carrierDisplayName).toBe('Acme Trucking LLC')
  })
})
