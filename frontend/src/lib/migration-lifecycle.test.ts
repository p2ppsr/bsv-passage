import { afterEach, describe, expect, it, vi } from 'vitest'
import { MerklePath, P2PKH, PrivateKey, Transaction, UnlockingScript, type WalletClient } from '@bsv/sdk'
import { headerForRoot, migrationFixture, testReference } from '../../test-fixtures/migration'
import { abortPreparedMigration, commitMigration, prepareMigration, WalletActionReleaseError } from './migration'

afterEach(() => vi.unstubAllGlobals())

function fixture() {
  const f = migrationFixture()
  const wallet = {
    isAuthenticated: vi.fn(async () => ({ authenticated: true })),
    getNetwork: vi.fn(async () => ({ network: 'mainnet' })),
    listActions: vi.fn(async () => ({ actions: [] as { status: string }[] })),
    getHeaderForHeight: vi.fn(async () => ({ header: f.header })),
    createAction: vi.fn(async () => ({ signableTransaction: { reference: testReference, tx: f.tx.toAtomicBEEF() } })),
    abortAction: vi.fn(async () => ({ aborted: true })),
    signAction: vi.fn(async () => ({ txid: 'a'.repeat(64) })),
  }
  const fetch = vi.fn(async (url: string) => {
    if (url !== `https://api.whatsonchain.com/v1/bsv/main/tx/${f.source.id('hex')}/beef`) throw new Error('Unmocked network request blocked')
    return new Response(f.source.toHexBEEF())
  })
  vi.stubGlobal('fetch', fetch)
  const client = wallet as unknown as WalletClient
  return { ...f, wallet, client, fetch, prepare: () => prepareMigration(client, f.master, f.report, f.sources) }
}

describe('source confirmation and signing', () => {
  it('signs only after a matching wallet header; signatures commit to every receiving output', async () => {
    const f = fixture()
    const prepared = await f.prepare()
    expect(f.wallet.getHeaderForHeight).toHaveBeenCalledExactlyOnceWith({ height: 800000 })
    expect(prepared).toMatchObject({ sourceSatoshis: 10000, outputSatoshis: 9900, feeSatoshis: 100, inputCount: 1 })
    const signed = Transaction.fromHex(prepared.txHex)
    signed.inputs[0].sourceTransaction = f.source
    expect(await signed.verify('scripts only')).toBe(true)
    const changed = Transaction.fromHex(prepared.txHex)
    changed.inputs[0].sourceTransaction = f.source
    changed.outputs[0].lockingScript = new P2PKH().lock(PrivateKey.fromString('3', 10).toAddress())
    await expect(changed.verify('scripts only')).rejects.toThrow()
    expect(f.wallet.signAction).not.toHaveBeenCalled()
  })

  it.each([0, 550000, 556767, 800001])('rejects conflicting BEEF height %i and releases the proposed action', async (height) => {
    const f = fixture()
    f.source.merklePath = new MerklePath(height, [[{ offset: 0, hash: f.source.id('hex'), txid: true }]])
    await expect(f.prepare()).rejects.toThrow(/replay|height differs/)
    expect(f.wallet.abortAction).toHaveBeenCalledExactlyOnceWith({ reference: testReference })
    expect(f.wallet.signAction).not.toHaveBeenCalled()
  })

  it('rejects missing confirmation proof', async () => {
    const f = fixture()
    f.source.merklePath = undefined
    await expect(f.prepare()).rejects.toThrow(/missing its confirmation proof/)
    expect(f.wallet.abortAction).toHaveBeenCalledOnce()
  })

  it.each(['00', 'zz'.repeat(80), '00'.repeat(80)])('rejects malformed or nonmatching wallet block headers', async (header) => {
    const f = fixture()
    f.wallet.getHeaderForHeight.mockResolvedValue({ header })
    await expect(f.prepare()).rejects.toThrow(/block header/)
    expect(f.wallet.abortAction).toHaveBeenCalledOnce()
    expect(f.wallet.signAction).not.toHaveBeenCalled()
  })

  it('fails closed when wallet headers are unavailable', async () => {
    const f = fixture()
    f.wallet.getHeaderForHeight.mockRejectedValue(new Error('Headers unavailable'))
    await expect(f.prepare()).rejects.toThrow('Headers unavailable')
    expect(f.wallet.abortAction).toHaveBeenCalledOnce()
  })

  it('rejects a proof that does not include the selected transaction', async () => {
    const f = fixture()
    f.source.merklePath = new MerklePath(800000, [[{ offset: 0, hash: 'b'.repeat(64), txid: true }]])
    await expect(f.prepare()).rejects.toThrow()
    expect(f.wallet.signAction).not.toHaveBeenCalled()
  })

  it('rejects duplicate selected sources before any wallet call', async () => {
    const f = fixture()
    // Duplicate selection is rejected before any wallet call, including headers.
    f.sources.push(f.sources[0])
    await expect(f.prepare()).rejects.toThrow(/no longer match/)
    expect(f.wallet.createAction).not.toHaveBeenCalled()
    expect(f.wallet.getHeaderForHeight).not.toHaveBeenCalled()
  })

  it.each([800000, 800001])('checks each selected output height and caches the shared header (%i)', async (secondHeight) => {
    const f = fixture()
    f.source.addOutput({ satoshis: 10000, lockingScript: new P2PKH().lock(f.derived.address) })
    const txid = f.source.id('hex')
    f.source.merklePath = new MerklePath(800000, [[{ offset: 0, hash: txid, txid: true }]])
    f.sources[0].utxo.txid = txid
    const utxo = { txid, vout: 1, satoshis: 10000, height: secondHeight }
    f.sources.push({ address: f.derived.address, path: f.derived.path, utxo })
    f.report.funded[0].utxos.push(utxo)
    f.report.funded[0].satoshis = f.report.totalSatoshis = 20000
    f.tx.addInput({ sourceTransaction: f.source, sourceOutputIndex: 1, unlockingScript: new UnlockingScript() })
    f.tx.outputs[0].satoshis = 19800
    f.wallet.getHeaderForHeight.mockResolvedValue({ header: headerForRoot(txid) })
    if (secondHeight === 800000) {
      await expect(f.prepare()).resolves.toMatchObject({ inputCount: 2, sourceSatoshis: 20000 })
      expect(f.wallet.getHeaderForHeight).toHaveBeenCalledOnce()
    } else {
      await expect(f.prepare()).rejects.toThrow(/height differs/)
      expect(f.wallet.abortAction).toHaveBeenCalledOnce()
    }
    expect(f.wallet.signAction).not.toHaveBeenCalled()
  })

  it('retains exact source value, input set and fee guards', async () => {
    for (const change of ['source-value', 'duplicate', 'omitted', 'unexpected', 'zero-output', 'negative-fee', 'excessive-fee']) {
      const f = fixture()
      if (change === 'source-value') f.sources[0].utxo.satoshis++
      if (change === 'duplicate') f.tx.addInput({ sourceTransaction: f.source, sourceOutputIndex: 0, unlockingScript: new UnlockingScript() })
      if (change === 'omitted') f.tx.inputs = []
      if (change === 'unexpected') f.tx.addInput({ sourceTransaction: f.source, sourceOutputIndex: 1, unlockingScript: new UnlockingScript() })
      if (change === 'zero-output') f.tx.outputs[0].satoshis = 0
      if (change === 'negative-fee') f.tx.outputs[0].satoshis = 10001
      if (change === 'excessive-fee') f.tx.outputs[0].satoshis = 1
      await expect(f.prepare(), change).rejects.toThrow()
      expect(f.wallet.abortAction).toHaveBeenCalledOnce()
      expect(f.wallet.signAction).not.toHaveBeenCalled()
    }
  })
})

describe('cancellation and broadcast lifecycle', () => {
  it('clears only an explicitly released wallet action', async () => {
    const f = fixture()
    await expect(abortPreparedMigration(f.client, { reference: testReference })).resolves.toBeUndefined()
    f.wallet.abortAction.mockResolvedValue({ aborted: false })
    await expect(abortPreparedMigration(f.client, { reference: testReference })).rejects.toThrow(/did not release action/)
    f.wallet.abortAction.mockRejectedValue(new Error('Transport failed'))
    await expect(abortPreparedMigration(f.client, { reference: testReference })).rejects.toThrow('Transport failed')
  })

  it.each(['refused', 'offline'])('preserves a failed preparation reference when cleanup is %s', async (failure) => {
    const f = fixture()
    f.wallet.getHeaderForHeight.mockRejectedValue(new Error('Headers unavailable'))
    if (failure === 'refused') f.wallet.abortAction.mockResolvedValue({ aborted: false })
    else f.wallet.abortAction.mockRejectedValue(new Error('Transport failed'))
    await expect(f.prepare()).rejects.toMatchObject({ name: 'WalletActionReleaseError', reference: testReference, message: expect.stringContaining('Headers unavailable') })
    expect(f.wallet.signAction).not.toHaveBeenCalled()
  })

  it('preserves the expected signed TXID if cleanup fails after signing', async () => {
    const f = fixture()
    f.tx.outputs[0].satoshis = 1
    f.wallet.abortAction.mockResolvedValue({ aborted: false })
    const error = await f.prepare().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(WalletActionReleaseError)
    expect(error).toMatchObject({ reference: testReference, txid: expect.stringMatching(/^[a-f0-9]{64}$/), message: expect.stringContaining('Fee rate') })
  })

  it.each(['missing', 'wrong', 'timeout'])('does not retry a %s broadcast outcome', async (outcome) => {
    const f = fixture()
    const prepared = await f.prepare()
    if (outcome === 'missing') f.wallet.signAction.mockResolvedValue({ txid: '' })
    if (outcome === 'timeout') f.wallet.signAction.mockRejectedValue(new Error('Timeout'))
    await expect(commitMigration(f.client, prepared)).rejects.toThrow()
    expect(f.wallet.signAction).toHaveBeenCalledOnce()
    expect(f.wallet.abortAction).not.toHaveBeenCalled()
  })

  it('accepts only the exact prepared TXID from the wallet', async () => {
    const f = fixture()
    const prepared = await f.prepare()
    f.wallet.signAction.mockResolvedValue({ txid: prepared.txid })
    await expect(commitMigration(f.client, prepared)).resolves.toMatchObject({ txid: prepared.txid })
    expect(f.wallet.signAction).toHaveBeenCalledExactlyOnceWith({ reference: testReference, spends: prepared.spends, options: { acceptDelayedBroadcast: false, returnTXIDOnly: true } })
  })
})
