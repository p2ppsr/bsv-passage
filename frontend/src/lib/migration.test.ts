import { describe, expect, it } from 'vitest'
import { assertMigrationSafe, flattenSources, smallestPilot } from './migration'
import type { ScanReport } from './providers'

function report(overrides: Partial<ScanReport> = {}): ScanReport {
  return {
    profileId: 'test', addressesChecked: 40, totalSatoshis: 3000, providersAgree: true,
    activityDisagreements: 0, completedAt: '2026-09-03T00:00:00.000Z',
    funded: [{ address: '1test', path: 'm/0/0', account: 0, change: 0, index: 0, satoshis: 3000, providersAgree: true, utxos: [
      { txid: 'a'.repeat(64), vout: 0, satoshis: 2000, height: 800000 },
      { txid: 'b'.repeat(64), vout: 1, satoshis: 1000, height: 800001 },
    ] }],
    ...overrides,
  }
}

describe('migration safety gate', () => {
  it('selects the smallest output for a pilot', () => {
    expect(smallestPilot(report())[0].utxo.satoshis).toBe(1000)
  })

  it('accepts only selected outputs from the verified map', () => {
    const value = report()
    expect(() => assertMigrationSafe(value, flattenSources(value))).not.toThrow()
    expect(() => assertMigrationSafe(value, [{ address: '1x', path: 'm/9/9', utxo: { txid: 'c'.repeat(64), vout: 0, satoshis: 1, height: 800000 } }])).toThrow(/no longer match/)
  })

  it('blocks provider disagreement, unconfirmed and pre-split outputs', () => {
    const mismatch = report({ providersAgree: false })
    expect(() => assertMigrationSafe(mismatch, flattenSources(mismatch))).toThrow(/indexers disagree/)
    const unconfirmed = report()
    unconfirmed.funded[0].utxos[0].height = 0
    expect(() => assertMigrationSafe(unconfirmed, flattenSources(unconfirmed))).toThrow(/unconfirmed/)
    const replay = report()
    replay.funded[0].utxos[0].height = 556767
    expect(() => assertMigrationSafe(replay, flattenSources(replay))).toThrow(/replay/)
  })

  it('caps reviewed actions at 100 inputs', () => {
    const many = report()
    many.funded[0].utxos = Array.from({ length: 101 }, (_, index) => ({ txid: index.toString(16).padStart(64, '0'), vout: 0, satoshis: 1000, height: 800000 }))
    expect(() => assertMigrationSafe(many, flattenSources(many))).toThrow(/limits each reviewed action/)
  })
})
