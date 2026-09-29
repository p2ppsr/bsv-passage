import { afterEach, describe, expect, it, vi } from 'vitest'
import { inspectAddress } from './providers'
import { assertMigrationSafe } from './migration'
import { migrationFixture } from '../../test-fixtures/migration'

afterEach(() => vi.unstubAllGlobals())

describe('independent confirmation heights', () => {
  it.each([[800000, 0], [800000, 550000], [800000, 800001], [0, 800000], [550000, 800000]])(
    'blocks matching outpoints/values when heights differ (%i vs %i)', async (wocHeight, bitailsHeight) => {
      const f = migrationFixture()
      const address = f.derived.address
      vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
        const url = String(input)
        let body: unknown
        if (url.includes('addresses/history/all')) body = [{ address, confirmed: { result: [{}] }, unconfirmed: { result: [] } }]
        else if (url.includes('balance/multi/separate')) body = [{ address, confirmed: 10000, unconfirmed: 0, summary: 10000, count: 1 }]
        else if (url.includes('whatsonchain') && url.includes('unspent/all')) body = { result: [{ tx_hash: f.source.id('hex'), tx_pos: 0, value: 10000, height: wocHeight }] }
        else if (url.includes('bitails') && url.includes('unspent/multi')) body = [{ address, unspent: [{ txid: f.source.id('hex'), vout: 0, satoshis: 10000, height: bitailsHeight }] }]
        else throw new Error('Unmocked network request blocked')
        return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })
      }))
      const result = await inspectAddress(address)
      expect(result).toMatchObject({ providersAgree: false, utxos: [], note: expect.stringContaining('confirmation heights differ') })
      f.report.providersAgree = result.providersAgree
      expect(() => assertMigrationSafe(f.report, f.sources)).toThrow(/indexers disagree/)
    },
  )
})
