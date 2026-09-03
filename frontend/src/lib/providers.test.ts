import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMasterKey, deriveAddress } from './seed'
import { fetchProviderResource, inspectAddress, inspectAddresses, scanProfile } from './providers'
import { getProfile } from './catalog'

const bip39 = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

afterEach(() => vi.unstubAllGlobals())

function json(value: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json', ...headers } })
}

function addressesFrom(init?: RequestInit): string[] {
  if (typeof init?.body !== 'string') return []
  return (JSON.parse(init.body) as { addresses?: string[] }).addresses ?? []
}

function emptyProviderFetch(onBatch?: (provider: 'woc' | 'bitails', addresses: string[]) => Set<string>) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    const addresses = addressesFrom(init)
    if (url.includes('addresses/history/all')) {
      const used = onBatch?.('woc', addresses) ?? new Set<string>()
      return json(addresses.map((address) => ({
        address,
        confirmed: { result: used.has(address) ? [{ tx_hash: 'a'.repeat(64) }] : [] },
        unconfirmed: { result: [] },
      })))
    }
    if (url.includes('balance/multi/separate')) {
      const used = onBatch?.('bitails', addresses) ?? new Set<string>()
      return json(addresses.map((address) => ({ address, confirmed: 0, unconfirmed: 0, summary: 0, count: used.has(address) ? 1 : 0 })))
    }
    if (url.includes('unspent/multi')) return json([])
    if (url.includes('whatsonchain')) return json({ result: [] })
    throw new Error(`Unexpected request: ${url}`)
  })
}

describe('independent discovery', () => {
  it('uses one request per provider for each empty discovery window', async () => {
    const fetch = emptyProviderFetch()
    vi.stubGlobal('fetch', fetch)
    const report = await scanProfile(createMasterKey(bip39, '', 'bip39'), getProfile('rockwallet', 'rockwallet-primary'), { gapLimit: 5, accountCount: 1 })
    expect(report.addressesChecked).toBe(10)
    expect(report.totalSatoshis).toBe(0)
    expect(report.providersAgree).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(4)
  })

  it('resets the gap after an address with history inside a batch', async () => {
    let firstBatch: string[] | undefined
    const fetch = emptyProviderFetch((_provider, addresses) => {
      if (!firstBatch) firstBatch = addresses
      return new Set(firstBatch?.length === 5 ? [firstBatch[4]] : [])
    })
    vi.stubGlobal('fetch', fetch)
    const report = await scanProfile(createMasterKey(bip39, '', 'bip39'), getProfile('rockwallet', 'rockwallet-primary'), { gapLimit: 5, accountCount: 1 })
    expect(report.addressesChecked).toBe(15)
    expect(report.activityDisagreements).toBe(0)
    expect(fetch.mock.calls.filter(([input]) => String(input).includes('unspent')).length).toBe(2)
  })

  it('finds a high-index address only when the configured gap can reach it', async () => {
    const master = createMasterKey(bip39, '', 'bip39')
    const highAddress = deriveAddress(master, "m/0'/0/25").address
    const utxo = { txid: 'a'.repeat(64), vout: 0, satoshis: 20, height: 800000 }
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      const addresses = addressesFrom(init)
      if (url.includes('addresses/history/all')) return json(addresses.map((address) => ({ address, confirmed: { result: address === highAddress ? [{}] : [] }, unconfirmed: { result: [] } })))
      if (url.includes('balance/multi/separate')) return json(addresses.map((address) => ({ address, confirmed: address === highAddress ? 20 : 0, unconfirmed: 0, summary: address === highAddress ? 20 : 0, count: address === highAddress ? 1 : 0 })))
      if (url.includes('whatsonchain')) return json({ result: [{ tx_hash: utxo.txid, tx_pos: utxo.vout, value: utxo.satoshis, height: utxo.height }] })
      if (url.includes('unspent/multi')) return json([{ address: highAddress, unspent: [utxo] }])
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetch)
    const profile = getProfile('rockwallet', 'rockwallet-primary')
    await expect(scanProfile(master, profile, { gapLimit: 20, accountCount: 1 })).resolves.toMatchObject({ funded: [] })
    const sufficient = await scanProfile(master, profile, { gapLimit: 30, accountCount: 1 })
    expect(sufficient.funded.map((entry) => entry.index)).toContain(25)
  })

  it('fails closed when providers disagree about an outpoint', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      const addresses = addressesFrom(init)
      if (url.includes('addresses/history/all')) return json(addresses.map((address) => ({ address, confirmed: { result: [{ tx_hash: 'a'.repeat(64) }] }, unconfirmed: { result: [] } })))
      if (url.includes('balance/multi/separate')) return json(addresses.map((address) => ({ address, confirmed: 900, unconfirmed: 0, summary: 900, count: 1 })))
      if (url.includes('whatsonchain')) return json({ result: [{ tx_hash: 'a'.repeat(64), tx_pos: 1, value: 900, height: 800000 }] })
      if (url.includes('unspent/multi')) return json([])
      throw new Error(`Unexpected request: ${url}`)
    }))
    const result = await inspectAddress('1PEha8dk5Me5J1rZWpgqSt5F4BroTBLS5y')
    expect(result.providersAgree).toBe(false)
    expect(result.utxos).toEqual([])
    expect(result.note).toMatch(/WhatsOnChain reported 1/)
  })

  it('records activity disagreement even when both providers agree there are no UTXOs', async () => {
    const fetch = emptyProviderFetch((provider, addresses) => provider === 'woc' ? new Set(addresses) : new Set())
    vi.stubGlobal('fetch', fetch)
    const result = await inspectAddress('1PEha8dk5Me5J1rZWpgqSt5F4BroTBLS5y')
    expect(result).toMatchObject({ used: true, activityAgrees: false, providersAgree: true, utxos: [] })
  })

  it('matches batch rows by address rather than response order', async () => {
    const wanted = ['1PEha8dk5Me5J1rZWpgqSt5F4BroTBLS5y', '1BoatSLRHtKNngkdXEeobR76b53LETtpyT']
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      const addresses = addressesFrom(init)
      if (url.includes('addresses/history/all')) return json([...addresses].reverse().map((address) => ({ address, confirmed: { result: [] }, unconfirmed: { result: [] } })))
      if (url.includes('balance/multi/separate')) return json([...addresses].reverse().map((address) => ({ address, confirmed: 0, unconfirmed: 0, summary: 0, count: 0 })))
      throw new Error(`Unexpected request: ${url}`)
    }))
    expect([...await inspectAddresses(wanted).then((result) => result.keys())]).toEqual(wanted)
  })

  it('rejects omitted rows, duplicate inputs and oversized batches', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      const addresses = addressesFrom(init)
      if (url.includes('addresses/history/all')) return json([])
      return json(addresses.map((address) => ({ address, confirmed: 0, unconfirmed: 0, summary: 0, count: 0 })))
    }))
    await expect(inspectAddress('1PEha8dk5Me5J1rZWpgqSt5F4BroTBLS5y')).rejects.toThrow(/omitted 1 requested address/)
    await expect(inspectAddresses(['x', 'x'])).rejects.toThrow(/unique addresses/)
    await expect(inspectAddresses(Array.from({ length: 21 }, (_, index) => `x${index}`))).rejects.toThrow(/1–20/)
  })

  it('rejects duplicate, unexpected and malformed provider rows', async () => {
    const address = '1PEha8dk5Me5J1rZWpgqSt5F4BroTBLS5y'
    for (const body of [
      [{ address, confirmed: { result: [] }, unconfirmed: { result: [] } }, { address, confirmed: { result: [] }, unconfirmed: { result: [] } }],
      [{ address: 'unexpected', confirmed: { result: [] }, unconfirmed: { result: [] } }],
      [null],
    ]) {
      vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        if (String(input).includes('addresses/history/all')) return json(body)
        return emptyProviderFetch()(input, init)
      }))
      await expect(inspectAddress(address)).rejects.toThrow(/duplicate|unexpected|malformed/)
    }
  })

  it('rejects invalid and duplicate UTXO outpoints rather than filtering them', async () => {
    const address = '1PEha8dk5Me5J1rZWpgqSt5F4BroTBLS5y'
    const invalidRows = [
      [{ tx_hash: 'not-a-txid', tx_pos: 0, value: 1, height: 800000 }],
      [{ tx_hash: 'a'.repeat(64), tx_pos: 0, value: 1, height: 800000 }, { tx_hash: 'a'.repeat(64), tx_pos: 0, value: 1, height: 800000 }],
    ]
    for (const rows of invalidRows) {
      vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input)
        const addresses = addressesFrom(init)
        if (url.includes('addresses/history/all')) return json(addresses.map((value) => ({ address: value, confirmed: { result: [{}] }, unconfirmed: { result: [] } })))
        if (url.includes('balance/multi/separate')) return json(addresses.map((value) => ({ address: value, confirmed: 1, unconfirmed: 0, summary: 1, count: 1 })))
        if (url.includes('whatsonchain')) return json({ result: rows })
        if (url.includes('unspent/multi')) return json([])
        throw new Error(`Unexpected request: ${url}`)
      }))
      await expect(inspectAddress(address)).rejects.toThrow(/invalid UTXO|duplicate UTXO/)
    }
  })

  it('retries a transient rate limit but does not retry a permanent client error', async () => {
    let wocCalls = 0
    const fetch = emptyProviderFetch()
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).includes('addresses/history/all') && wocCalls++ === 0) return json({ error: 'slow down' }, 429, { 'Retry-After': '0' })
      return fetch(input, init)
    }))
    await expect(inspectAddress('1PEha8dk5Me5J1rZWpgqSt5F4BroTBLS5y')).resolves.toMatchObject({ used: false })
    expect(wocCalls).toBe(2)

    const permanent = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).includes('addresses/history/all')) return json({ error: 'denied' }, 401)
      return fetch(input, init)
    })
    vi.stubGlobal('fetch', permanent)
    await expect(inspectAddress('1PEha8dk5Me5J1rZWpgqSt5F4BroTBLS5y')).rejects.toThrow(/HTTP 401/)
    expect(permanent.mock.calls.filter(([input]) => String(input).includes('addresses/history/all'))).toHaveLength(1)
  })

  it('retries transient server and network failures through the bounded attempt budget', async () => {
    const responses = [json({ error: 'upstream' }, 503), Promise.reject(new TypeError('network unavailable')), json({ ok: true })]
    const fetch = vi.fn(() => Promise.resolve(responses.shift() as Response | Promise<Response>))
    vi.stubGlobal('fetch', fetch)
    await expect(fetchProviderResource('WhatsOnChain', 'https://example.test/transient')).resolves.toMatchObject({ status: 200 })
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('stops safely on a provider cooldown beyond the automatic retry window', async () => {
    const fetch = vi.fn(async () => json({ error: 'cooldown' }, 429, { 'Retry-After': '31' }))
    vi.stubGlobal('fetch', fetch)
    await expect(fetchProviderResource('WhatsOnChain', 'https://example.test/cooldown')).rejects.toThrow(/stopped safely/)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('cancels before starting an external provider request', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const controller = new AbortController()
    controller.abort()
    await expect(fetchProviderResource('Bitails', 'https://example.test/cancelled', controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetch).not.toHaveBeenCalled()
  })
})
