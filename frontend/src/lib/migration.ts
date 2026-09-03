import {
  Beef,
  P2PKH,
  Transaction,
  Utils,
  WalletClient,
  type CreateActionInput,
  type HD,
  type PositiveIntegerOrZero,
  type SignActionSpend,
} from '@bsv/sdk'
import type { FundedAddress, ScanReport, Utxo } from './providers'
import { hasReplayAmbiguity, hasUnconfirmed } from './providers'
import { deriveAddress } from './seed'

const MAX_INPUTS_PER_ACTION = 100
const MAX_FEE_RATE = 1_000
const MIN_FEE_RATE = 1

export interface SelectedSource {
  address: string
  path: string
  utxo: Utxo
}

export interface PreparedMigration {
  reference: string
  txid: string
  txHex: string
  sourceSatoshis: number
  outputSatoshis: number
  feeSatoshis: number
  feeRate: number
  inputCount: number
  outputCount: number
  spends: Record<PositiveIntegerOrZero, SignActionSpend>
}

export interface MigrationReceipt {
  txid: string
  sourceSatoshis: number
  feeSatoshis: number
  inputCount: number
  completedAt: string
}

function sourceKey(source: Pick<SelectedSource, 'utxo'>): string {
  return `${source.utxo.txid}.${source.utxo.vout}`
}

export function flattenSources(report: ScanReport): SelectedSource[] {
  return report.funded.flatMap((entry) => entry.utxos.map((utxo) => ({ address: entry.address, path: entry.path, utxo })))
}

export function smallestPilot(report: ScanReport): SelectedSource[] {
  const sources = flattenSources(report).sort((a, b) => a.utxo.satoshis - b.utxo.satoshis)
  return sources.length > 0 ? [sources[0]] : []
}

export function assertMigrationSafe(report: ScanReport, sources: SelectedSource[]): void {
  if (!report.providersAgree) throw new Error('The indexers disagree. Migration remains locked until independent UTXO results match.')
  if (hasReplayAmbiguity(report)) throw new Error('At least one output predates the BSV/BCH split. Automatic migration is blocked to prevent cross-chain replay.')
  if (hasUnconfirmed(report)) throw new Error('At least one output is unconfirmed. Wait for confirmation and scan again.')
  if (sources.length === 0) throw new Error('No verified spendable outputs were selected.')
  if (sources.length > MAX_INPUTS_PER_ACTION) throw new Error(`This migration has ${sources.length} inputs. Passage limits each reviewed action to ${MAX_INPUTS_PER_ACTION}; migrate a smaller batch.`)
  const reportKeys = new Set(flattenSources(report).map(sourceKey))
  const selectedKeys = sources.map(sourceKey)
  if (new Set(selectedKeys).size !== selectedKeys.length || selectedKeys.some((key) => !reportKeys.has(key))) {
    throw new Error('The selected outputs no longer match the verified scan.')
  }
}

async function fetchBeef(txid: string): Promise<number[]> {
  let lastError: Error | undefined
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(`https://api.whatsonchain.com/v1/bsv/main/tx/${encodeURIComponent(txid)}/beef`, {
        credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(15_000),
        headers: { Accept: 'text/plain' },
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const hex = (await response.text()).trim()
      if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) throw new Error('invalid BEEF response')
      return Utils.toArray(hex, 'hex')
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      if (attempt < 2) await new Promise((resolve) => window.setTimeout(resolve, 500 * (attempt + 1)))
    }
  }
  throw new Error(`Could not obtain a merkle-proven source transaction: ${lastError?.message ?? 'unknown error'}`)
}

export async function connectBrc100(wallet: WalletClient): Promise<void> {
  const { authenticated } = await wallet.isAuthenticated({})
  if (!authenticated) throw new Error('The BRC-100 wallet did not authenticate this app.')
  const { network } = await wallet.getNetwork({})
  if (network !== 'mainnet') throw new Error(`Passage only migrates mainnet BSV. The connected wallet reports ${network}.`)
}

export async function prepareMigration(
  wallet: WalletClient,
  master: HD,
  report: ScanReport,
  sources: SelectedSource[],
  onProgress?: (message: string) => void,
): Promise<PreparedMigration> {
  assertMigrationSafe(report, sources)
  await connectBrc100(wallet)

  const beef = new Beef()
  const inputs: CreateActionInput[] = []
  const keys = new Map<string, ReturnType<typeof deriveAddress>>()
  const uniqueTxids = [...new Set(sources.map((source) => source.utxo.txid))]
  let reference: string | undefined

  try {
    for (const [index, txid] of uniqueTxids.entries()) {
      onProgress?.(`Verifying source proof ${index + 1} of ${uniqueTxids.length}`)
      beef.mergeBeef(await fetchBeef(txid))
    }

    for (const source of sources) {
      const derived = deriveAddress(master, source.path)
      if (derived.address !== source.address) throw new Error(`Derived key no longer matches the verified address at ${source.path}.`)
      keys.set(sourceKey(source), derived)
      inputs.push({
        inputDescription: `Verified legacy P2PKH output at ${source.path}`,
        unlockingScriptLength: 108,
        outpoint: sourceKey(source),
      })
    }

    onProgress?.('Asking your BRC-100 wallet to create its receiving output')
    const action = await wallet.createAction({
      inputBEEF: beef.toBinary(),
      description: 'Receive verified legacy BSV through BSV Passage',
      labels: ['bsv-passage', 'legacy-wallet-migration'],
      inputs,
      options: { randomizeOutputs: true, acceptDelayedBroadcast: false },
    })
    if (!action.signableTransaction) throw new Error('The wallet did not return a reviewable signable transaction.')
    reference = action.signableTransaction.reference
    const tx = Transaction.fromAtomicBEEF(action.signableTransaction.tx)

    const sourceTotal = sources.reduce((sum, source) => sum + source.utxo.satoshis, 0)
    const spends: Record<PositiveIntegerOrZero, SignActionSpend> = {}
    const seen = new Set<string>()

    for (const [index, input] of tx.inputs.entries()) {
      if (!input.sourceTransaction) throw new Error(`Input ${index} is missing its proven source transaction.`)
      const key = `${input.sourceTransaction.id('hex')}.${input.sourceOutputIndex}`
      const derived = keys.get(key)
      if (!derived) throw new Error('The wallet added an unexpected input. Passage refuses transactions it cannot account for.')
      if (seen.has(key)) throw new Error(`The transaction duplicates source output ${key}.`)
      seen.add(key)
      const expectedScript = new P2PKH().lock(derived.address).toHex()
      const actualScript = input.sourceTransaction.outputs[input.sourceOutputIndex].lockingScript.toHex()
      if (actualScript !== expectedScript) throw new Error(`Output ${key} is not the expected standard P2PKH script.`)
      const expectedValue = sources.find((source) => sourceKey(source) === key)?.utxo.satoshis
      if (input.sourceTransaction.outputs[input.sourceOutputIndex].satoshis !== expectedValue) {
        throw new Error(`Output ${key} value differs from the independently verified scan.`)
      }
      input.unlockingScriptTemplate = new P2PKH().unlock(derived.privateKey, 'all', false)
    }
    if (seen.size !== sources.length) throw new Error('The wallet omitted one or more verified source outputs.')

    if (tx.outputs.some((output) => !Number.isSafeInteger(output.satoshis) || (output.satoshis ?? 0) <= 0)) {
      throw new Error('The wallet proposed an invalid receiving output.')
    }
    const outputTotal = tx.outputs.reduce((sum, output) => sum + (output.satoshis ?? 0), 0)
    const fee = sourceTotal - outputTotal
    if (!Number.isSafeInteger(fee) || fee <= 0) throw new Error('The proposed transaction fee is invalid.')
    if (tx.outputs.length < 1) throw new Error('The wallet proposed no receiving output.')

    await tx.sign()
    for (const [index, input] of tx.inputs.entries()) {
      if (!input.unlockingScript) throw new Error(`Input ${index} was not signed.`)
      spends[index as PositiveIntegerOrZero] = { unlockingScript: input.unlockingScript.toHex() }
    }
    const size = tx.toBinary().length
    const feeRate = fee / (size / 1_000)
    if (feeRate < MIN_FEE_RATE || feeRate > MAX_FEE_RATE) {
      throw new Error(`Fee rate ${feeRate.toFixed(2)} sat/kB is outside Passage’s ${MIN_FEE_RATE}–${MAX_FEE_RATE} sat/kB safety bounds.`)
    }

    return {
      reference,
      txid: tx.id('hex'),
      txHex: tx.toHex(),
      sourceSatoshis: sourceTotal,
      outputSatoshis: outputTotal,
      feeSatoshis: fee,
      feeRate,
      inputCount: tx.inputs.length,
      outputCount: tx.outputs.length,
      spends,
    }
  } catch (error) {
    if (reference) {
      try { await wallet.abortAction({ reference }) } catch { /* best-effort release; the original error is more useful */ }
    }
    throw error
  }
}

export async function abortPreparedMigration(wallet: WalletClient, prepared: PreparedMigration): Promise<void> {
  await wallet.abortAction({ reference: prepared.reference })
}

export async function commitMigration(wallet: WalletClient, prepared: PreparedMigration): Promise<MigrationReceipt> {
  const result = await wallet.signAction({
    reference: prepared.reference,
    spends: prepared.spends,
    options: { acceptDelayedBroadcast: false, returnTXIDOnly: true },
  })
  if (!result.txid) throw new Error(`Broadcast outcome is unknown. Do not retry. Check transaction ${prepared.txid} and your wallet action history first.`)
  if (result.txid !== prepared.txid) throw new Error(`The wallet returned an unexpected transaction ID. Do not retry; inspect both ${prepared.txid} and ${result.txid}.`)
  return {
    txid: result.txid,
    sourceSatoshis: prepared.sourceSatoshis,
    feeSatoshis: prepared.feeSatoshis,
    inputCount: prepared.inputCount,
    completedAt: new Date().toISOString(),
  }
}

export function fundedOnly(entries: FundedAddress[]): FundedAddress[] {
  return entries.filter((entry) => entry.satoshis > 0)
}
