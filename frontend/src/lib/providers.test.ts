import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMasterKey } from './seed'
import { inspectAddress, scanProfile } from './providers'
import { getProfile } from './catalog'

const bip39 = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

afterEach(() => vi.unstubAllGlobals())

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

describe('independent discovery', () => {
  it('finishes each receiving/change branch only after the configured agreed gap', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.includes('addresses/history/all')) return json([{ confirmed: { result: [] }, unconfirmed: { result: [] } }])
      if (url.includes('whatsonchain')) return json({ result: [] })
      if (url.includes('/history')) return json([])
      return json({ unspent: [] })
    }))
    const report = await scanProfile(createMasterKey(bip39, '', 'bip39'), getProfile('rockwallet', 'rockwallet-primary'), { gapLimit: 5, accountCount: 1 })
    expect(report.addressesChecked).toBe(10)
    expect(report.totalSatoshis).toBe(0)
    expect(report.providersAgree).toBe(true)
  })

  it('fails closed when providers disagree about an outpoint', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.includes('addresses/history/all')) return json([{ confirmed: { result: [{ tx_hash: 'a'.repeat(64) }] }, unconfirmed: { result: [] } }])
      if (url.includes('whatsonchain')) return json({ result: [{ tx_hash: 'a'.repeat(64), tx_pos: 1, value: 900, height: 800000 }] })
      if (url.includes('/history')) return json([{ txid: 'a'.repeat(64) }])
      return json({ unspent: [] })
    }))
    const result = await inspectAddress('1PEha8dk5Me5J1rZWpgqSt5F4BroTBLS5y')
    expect(result.providersAgree).toBe(false)
    expect(result.utxos).toEqual([])
    expect(result.note).toMatch(/WhatsOnChain reported 1/)
  })
})
