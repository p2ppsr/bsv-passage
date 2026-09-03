import {
  chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync,
} from 'node:fs'
import { createHmac } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import {
  Mnemonic, P2PKH, SatoshisPerKilobyte, Transaction, WalletClient,
} from '@bsv/sdk'
import { getProfile } from '../src/lib/catalog'
import { commitMigration, flattenSources, prepareMigration, type PreparedMigration } from '../src/lib/migration'
import { inspectAddresses, scanProfile } from '../src/lib/providers'
import { createMasterKey, deriveAddress } from '../src/lib/seed'

const ACK = 'I_AUTHORIZE_BSV_PASSAGE_MAINNET_CAMPAIGN'
const ORIGIN = 'https://passage.metanet.app'
const ARCADE = 'https://arcade-v2-us-1.bsvblockchain.tech'
const FEE_RATE = 100
const MUTATING = new Set(['init', 'wallet-fund', 'broadcast-chain', 'scan-matrix', 'sweep'])
const ACCEPTED = new Set(['ACCEPTED_BY_NETWORK', 'SEEN_ON_NETWORK', 'MINED'])
const TERMINAL_FAILURE = new Set(['REJECTED', 'DOUBLE_SPEND_ATTEMPTED'])

type SeedKind = 'bip39' | 'centbee' | 'electrum'

interface Target {
  sequence: number
  seedKind: SeedKind
  path: string
  address: string
  satoshis: number | null
  profiles: string[]
  note: string
}

interface ChainTransaction {
  sequence: number
  txid: string
  rawHex: string
  sourceTxid: string
  sourceVout: number
  sourceSatoshis: number
  outputSatoshis: number
  feeSatoshis: number
  carrierVout: number | null
  carrierSatoshis: number | null
  carrierPath: string | null
  target: Target
  txStatus: string
  acceptedAt: string
}

interface CampaignState {
  version: 1
  network: 'mainnet'
  createdAt: string
  price: { usdPerBsv: number; capturedAt: string; source: string }
  budget: {
    maxExposureSats: number
    fundingSats: number
    maxNominalSats: number
    maxUsd: number
    transactionCount: number
  }
  secrets: { bip39Mnemonic: string; centbeePin: string; electrumMnemonic: string }
  targets: Target[]
  funding?: {
    txid: string
    rawHex: string
    vout: number
    satoshis: number
    carrierPath: string
    txStatus: string
    createdAt: string
  }
  pendingChain?: {
    transaction: Omit<ChainTransaction, 'txStatus' | 'acceptedAt'>
    preparedAt: string
  }
  chain: ChainTransaction[]
  scans: Array<{
    scenario: string
    profileId: string
    expectedOutputs: number
    foundOutputs: number
    addressesChecked: number
    totalSatoshis: number
    providersAgree: boolean
    activityDisagreements: number
    elapsedMs: number
    completedAt: string
  }>
  pendingSweep?: { route: string; prepared: PreparedMigration; preparedAt: string }
  sweeps: Array<{
    route: string
    txid: string
    inputCount: number
    sourceSatoshis: number
    feeSatoshis: number
    completedAt: string
  }>
  reconciliation?: {
    statusCounts: Record<string, number>
    transactionCount: number
    targetCount: number
    outputCount: number
    feeSatoshis: number
    nominalSatoshis: number
    nominalUsd: number
    allTargetsMatched: boolean
    completedAt: string
  }
}

function usage(): never {
  console.log(`BSV Passage mainnet campaign\n\nCommands:\n  init --state <secrets/local/...json> --execute\n  wallet-fund --state <path> --execute\n  wait-confirmed --state <path> [--timeout-minutes 90]\n  broadcast-chain --state <path> [--limit <count>] --execute\n  reconcile-chain --state <path>\n  scan-matrix --state <path> --execute\n  sweep --state <path> --execute\n  status --state <path>\n\nMutating commands additionally require PASSAGE_MAINNET_CAMPAIGN_ACK=${ACK}.`)
  process.exit(2)
}

function option(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function command(): string {
  return process.argv[2] ?? usage()
}

function statePath(): string {
  const value = option('state')
  if (!value) usage()
  const path = resolve(value)
  if (!path.includes('/secrets/local/')) throw new Error('The state file must remain under a secrets/local directory.')
  return path
}

function assertExecution(commandName: string): void {
  if (!MUTATING.has(commandName)) return
  if (!process.argv.includes('--execute')) throw new Error(`${commandName} requires --execute.`)
  if (process.env.PASSAGE_MAINNET_CAMPAIGN_ACK !== ACK) throw new Error(`${commandName} requires the exact scoped authorization environment variable.`)
}

function loadState(path: string): CampaignState {
  const state = JSON.parse(readFileSync(path, 'utf8')) as CampaignState
  if (state.version !== 1 || state.network !== 'mainnet') throw new Error('Unsupported or non-mainnet campaign state.')
  if (state.budget.fundingSats > state.budget.maxExposureSats || state.budget.maxUsd > 2) throw new Error('Campaign state violates its hard budget.')
  return state
}

function writeState(path: string, state: CampaignState): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  chmodSync(dirname(path), 0o700)
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
  renameSync(temporary, path)
  chmodSync(path, 0o600)
}

async function withLock<T>(path: string, operation: () => Promise<T>): Promise<T> {
  const lockPath = `${path}.lock`
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  chmodSync(dirname(path), 0o700)
  const descriptor = openSync(lockPath, 'wx', 0o600)
  try { return await operation() }
  finally { closeSync(descriptor); rmSync(lockPath, { force: true }) }
}

function iso(): string { return new Date().toISOString() }
function sleep(milliseconds: number): Promise<void> { return new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds)) }

function master(state: Pick<CampaignState, 'secrets'>, kind: SeedKind) {
  if (kind === 'electrum') return createMasterKey(state.secrets.electrumMnemonic, '', 'electrum-v2')
  return createMasterKey(state.secrets.bip39Mnemonic, kind === 'centbee' ? state.secrets.centbeePin : '', 'bip39')
}

function keyAt(state: Pick<CampaignState, 'secrets'>, kind: SeedKind, path: string) {
  return deriveAddress(master(state, kind), path)
}

function carrierPath(index: number): string { return `m/777'/0/${index}` }

function electrumMnemonic(): string {
  for (let attempt = 0; attempt < 20_000; attempt += 1) {
    const words = Mnemonic.fromRandom().toString().normalize('NFKD').trim().toLowerCase().replace(/\s+/gu, ' ')
    const version = createHmac('sha512', 'Seed version').update(words).digest('hex')
    if (version.startsWith('01') && !version.startsWith('100') && !version.startsWith('101')) return words
  }
  throw new Error('Could not generate a standard Electrum v2 fixture seed.')
}

function buildTargets(state: Pick<CampaignState, 'secrets'>): Target[] {
  const targets: Array<Omit<Target, 'sequence' | 'address'>> = []
  for (let index = 0; index < 220; index += 1) {
    targets.push({ seedKind: 'bip39', path: `m/0'/0/${index}`, satoshis: 20, profiles: ['rockwallet-primary'], note: 'RockWallet receiving-chain volume fixture' })
  }
  const extras: Array<[SeedKind, string, string[], string]> = [
    ['centbee', "m/44'/0/0/0", ['centbee-primary'], 'Centbee PIN receiving'],
    ['centbee', "m/44'/0/0/1", ['centbee-primary'], 'Centbee PIN receiving'],
    ['centbee', "m/44'/0/0/2", ['centbee-primary'], 'Centbee PIN receiving'],
    ['centbee', "m/44'/0/0/25", ['centbee-primary'], 'Centbee high-gap receiving'],
    ['centbee', "m/44'/0/1/0", ['centbee-primary'], 'Centbee PIN change'],
    ['centbee', "m/44'/0/1/1", ['centbee-primary'], 'Centbee PIN change'],
    ['electrum', 'm/0/0', ['electrum-native'], 'Electrum native receiving'],
    ['electrum', 'm/0/1', ['electrum-native'], 'Electrum native receiving'],
    ['electrum', 'm/0/2', ['electrum-native'], 'Electrum native receiving'],
    ['electrum', 'm/0/25', ['electrum-native'], 'Electrum native high-gap receiving'],
    ['electrum', 'm/1/0', ['electrum-native'], 'Electrum native change'],
    ['electrum', 'm/1/1', ['electrum-native'], 'Electrum native change'],
    ['bip39', "m/44'/0'/0'/0/0", ['electrum-bip39'], 'Electrum imported coin type 0 receiving'],
    ['bip39', "m/44'/0'/0'/0/1", ['electrum-bip39'], 'Electrum imported coin type 0 receiving'],
    ['bip39', "m/44'/0'/0'/1/0", ['electrum-bip39'], 'Electrum imported coin type 0 change'],
    ['bip39', "m/44'/145'/0'/0/0", ['electrum-bip39', 'coinomi-fork', 'atomic-bsv', 'simplycash-standard'], 'BCH-style account 0 receiving'],
    ['bip39', "m/44'/145'/0'/0/1", ['electrum-bip39', 'coinomi-fork', 'atomic-bsv', 'simplycash-standard'], 'BCH-style account 0 receiving'],
    ['bip39', "m/44'/145'/0'/1/0", ['electrum-bip39', 'coinomi-fork', 'atomic-bsv', 'simplycash-standard'], 'BCH-style account 0 change'],
    ['bip39', "m/44'/145'/1'/0/0", ['coinomi-fork'], 'BCH-style account 1 receiving'],
    ['bip39', "m/44'/145'/1'/1/0", ['coinomi-fork'], 'BCH-style account 1 change'],
    ['bip39', "m/44'/145'/2'/0/0", ['coinomi-fork'], 'BCH-style account 2 receiving'],
    ['bip39', "m/44'/145'/2'/1/0", ['coinomi-fork'], 'BCH-style account 2 change'],
    ['bip39', "m/44'/236'/0'/0/0", ['electrum-bip39', 'coinomi-native', 'exodus-bsv'], 'BSV coin type account 0 receiving'],
    ['bip39', "m/44'/236'/0'/0/1", ['electrum-bip39', 'coinomi-native', 'exodus-bsv'], 'BSV coin type account 0 receiving'],
    ['bip39', "m/44'/236'/0'/1/0", ['electrum-bip39', 'coinomi-native', 'exodus-bsv'], 'BSV coin type account 0 change'],
    ['bip39', "m/44'/236'/1'/0/0", ['coinomi-native', 'exodus-bsv'], 'BSV coin type account 1 receiving'],
    ['bip39', "m/44'/236'/1'/1/0", ['coinomi-native', 'exodus-bsv'], 'BSV coin type account 1 change'],
    ['bip39', "m/44'/236'/2'/0/0", ['coinomi-native', 'exodus-bsv'], 'BSV coin type account 2 receiving'],
    ['bip39', "m/44'/236'/2'/1/0", ['coinomi-native', 'exodus-bsv'], 'BSV coin type account 2 change'],
  ]
  for (const [seedKind, path, profiles, note] of extras) targets.push({ seedKind, path, satoshis: 200, profiles, note })
  targets.push({ seedKind: 'bip39', path: "m/0'/0/220", satoshis: null, profiles: ['rockwallet-primary'], note: 'RockWallet final carrier recovery' })
  return targets.map((target, sequence) => ({ ...target, sequence, address: deriveAddress(master(state, target.seedKind), target.path).address }))
}

async function arcadeStatus(txid: string): Promise<{ found: boolean; txStatus?: string; body?: Record<string, unknown> }> {
  const response = await fetch(`${ARCADE}/tx/${txid}`, { signal: AbortSignal.timeout(12_000), headers: { Accept: 'application/json' } })
  if (response.status === 404) return { found: false }
  const text = await response.text()
  if (!response.ok) throw new Error(`Arcade status HTTP ${response.status}: ${text.slice(0, 240)}`)
  const body = JSON.parse(text) as Record<string, unknown>
  return { found: true, txStatus: String(body.txStatus ?? ''), body }
}

function retryAfter(response: Response): number {
  const value = response.headers.get('Retry-After')
  if (!value) return 0
  if (/^\d+(?:\.\d+)?$/.test(value.trim())) return Math.ceil(Number(value) * 1_000)
  const date = Date.parse(value)
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 0
}

async function awaitArcadeAcceptance(txid: string, initial?: Record<string, unknown>): Promise<string> {
  let body = initial
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const status = String(body?.txStatus ?? '')
    if (ACCEPTED.has(status)) return status
    if (TERMINAL_FAILURE.has(status)) throw new Error(`Arcade rejected ${txid}: ${status} ${String(body?.extraInfo ?? '')}`)
    await sleep(500)
    const current = await arcadeStatus(txid)
    if (current.found) body = current.body
  }
  throw new Error(`Arcade did not reach network acceptance for ${txid}; stop and reconcile before retrying.`)
}

async function broadcastRaw(txid: string, rawHex: string): Promise<string> {
  const existing = await arcadeStatus(txid)
  if (existing.found) return await awaitArcadeAcceptance(txid, existing.body)
  let last = ''
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(`${ARCADE}/tx`, {
      method: 'POST', body: rawHex, signal: AbortSignal.timeout(30_000),
      headers: { Accept: 'application/json', 'Content-Type': 'text/plain', 'X-Deployment-ID': 'bsv-passage-mainnet-validation' },
    })
    last = await response.text()
    if (response.ok) {
      const body = JSON.parse(last) as Record<string, unknown>
      if (String(body.txid ?? '') !== txid) throw new Error(`Arcade returned an unexpected txid for ${txid}.`)
      return await awaitArcadeAcceptance(txid, body)
    }
    if (response.status !== 429 && response.status < 500) throw new Error(`Arcade rejected ${txid} with HTTP ${response.status}: ${last.slice(0, 300)}`)
    const delay = Math.max(retryAfter(response), 1_000 * (2 ** attempt))
    if (delay > 30_000) throw new Error(`Arcade requested a ${Math.ceil(delay / 1_000)}-second cooldown; campaign stopped.`)
    await sleep(delay)
  }
  throw new Error(`Arcade could not accept ${txid}: ${last.slice(0, 300)}`)
}

async function prepareNextTransaction(state: CampaignState, sequence: number): Promise<Omit<ChainTransaction, 'txStatus' | 'acceptedAt'>> {
  const source = sequence === 0
    ? state.funding!
    : {
        txid: state.chain.at(-1)!.txid,
        rawHex: state.chain.at(-1)!.rawHex,
        vout: state.chain.at(-1)!.carrierVout!,
        satoshis: state.chain.at(-1)!.carrierSatoshis!,
        carrierPath: state.chain.at(-1)!.carrierPath!,
      }
  const sourceTx = Transaction.fromHex(source.rawHex)
  const sourceKey = keyAt(state, 'bip39', source.carrierPath)
  const transaction = new Transaction()
  transaction.addInput({
    sourceTransaction: sourceTx,
    sourceTXID: source.txid,
    sourceOutputIndex: source.vout,
    unlockingScriptTemplate: new P2PKH().unlock(sourceKey.privateKey, 'all', false),
  })
  const target = state.targets[sequence]
  const final = sequence === state.targets.length - 1
  if (!final) {
    transaction.addOutput({ lockingScript: new P2PKH().lock(target.address), satoshis: target.satoshis! })
    transaction.addOutput({ lockingScript: new P2PKH().lock(keyAt(state, 'bip39', carrierPath(sequence + 1)).address), change: true })
  } else {
    transaction.addOutput({ lockingScript: new P2PKH().lock(target.address), change: true })
  }
  await transaction.fee(new SatoshisPerKilobyte(FEE_RATE))
  await transaction.sign()
  const outputs = transaction.outputs.map((output) => output.satoshis ?? 0)
  const outputSatoshis = outputs.reduce((sum, value) => sum + value, 0)
  const feeSatoshis = source.satoshis - outputSatoshis
  if (feeSatoshis <= 0 || feeSatoshis > 100 || outputSatoshis <= 0) throw new Error(`Unsafe fee/value at chain sequence ${sequence}.`)
  const carrierVout = final ? null : 1
  const carrierSatoshis = final ? null : outputs[1]
  const nextCarrierPath = final ? null : carrierPath(sequence + 1)
  return {
    sequence,
    txid: transaction.id('hex'),
    rawHex: transaction.toHex(),
    sourceTxid: source.txid,
    sourceVout: source.vout,
    sourceSatoshis: source.satoshis,
    outputSatoshis,
    feeSatoshis,
    carrierVout,
    carrierSatoshis,
    carrierPath: nextCarrierPath,
    target,
  }
}

function nominal(state: CampaignState, extra = 0): number {
  return state.budget.fundingSats + state.chain.reduce((sum, tx) => sum + tx.outputSatoshis, 0) + extra
}

async function init(path: string): Promise<void> {
  if (existsSync(path)) throw new Error('Refusing to overwrite an existing campaign state.')
  const usdPerBsv = Number(option('usd-per-bsv') ?? '15.73')
  const fundingSats = Number(option('funding-sats') ?? '20000')
  const transactionCount = Number(option('transactions') ?? '250')
  if (!Number.isFinite(usdPerBsv) || usdPerBsv <= 0 || fundingSats < 12_000 || fundingSats > 100_000 || transactionCount !== 250) {
    throw new Error('This reviewed campaign requires a positive USD price, 12,000–100,000 sats, and exactly 250 transactions.')
  }
  const bip39Mnemonic = Mnemonic.fromRandom().toString()
  const state: CampaignState = {
    version: 1,
    network: 'mainnet',
    createdAt: iso(),
    price: { usdPerBsv, capturedAt: iso(), source: 'CoinGecko operator snapshot' },
    budget: {
      maxExposureSats: 200_000,
      fundingSats,
      maxNominalSats: Math.floor((2 / usdPerBsv) * 100_000_000),
      maxUsd: 2,
      transactionCount,
    },
    secrets: { bip39Mnemonic, centbeePin: '2468', electrumMnemonic: electrumMnemonic() },
    targets: [], funding: undefined, pendingChain: undefined, chain: [], scans: [], pendingSweep: undefined, sweeps: [], reconciliation: undefined,
  }
  state.targets = buildTargets(state)
  if (state.targets.length !== transactionCount || new Set(state.targets.map((target) => target.address)).size !== transactionCount) {
    throw new Error('Target plan is not exactly 250 unique keys.')
  }
  writeState(path, state)
  console.log(JSON.stringify({ initialized: true, state: path, mode: '0600', targetKeys: state.targets.length, fundingSats, maxExposureSats: state.budget.maxExposureSats, maxNominalSats: state.budget.maxNominalSats }))
}

async function walletFund(path: string): Promise<void> {
  const state = loadState(path)
  if (state.funding) {
    console.log(JSON.stringify({ alreadyFunded: true, txid: state.funding.txid, satoshis: state.funding.satoshis }))
    return
  }
  const destination = keyAt(state, 'bip39', carrierPath(0))
  const wallet = new WalletClient('Cicada', ORIGIN)
  const { network } = await wallet.getNetwork({})
  if (network !== 'mainnet') throw new Error(`Wallet reported ${network}; mainnet required.`)
  const result = await wallet.createAction({
    description: 'BSV Passage volume campaign funding',
    labels: ['bsv-passage', 'mainnet-acceptance', 'volume-campaign'],
    outputs: [{ lockingScript: new P2PKH().lock(destination.address).toHex(), satoshis: state.budget.fundingSats, outputDescription: 'Recoverable mainnet volume fixture' }],
    options: { randomizeOutputs: false, acceptDelayedBroadcast: false },
  })
  if (!result.txid || !result.tx) throw new Error('Wallet did not return a broadcast transaction and txid.')
  const transaction = Transaction.fromAtomicBEEF(result.tx)
  if (transaction.id('hex') !== result.txid) throw new Error('Wallet funding txid does not match returned transaction bytes.')
  const lockingScript = new P2PKH().lock(destination.address).toHex()
  const matches = transaction.outputs.map((output, vout) => ({ output, vout })).filter(({ output }) => output.lockingScript.toHex() === lockingScript && output.satoshis === state.budget.fundingSats)
  if (matches.length !== 1) throw new Error('Wallet funding transaction does not contain exactly one requested fixture output.')
  const status = await awaitArcadeAcceptance(result.txid)
  state.funding = { txid: result.txid, rawHex: transaction.toHex(), vout: matches[0].vout, satoshis: state.budget.fundingSats, carrierPath: carrierPath(0), txStatus: status, createdAt: iso() }
  writeState(path, state)
  console.log(JSON.stringify({ funded: true, txid: result.txid, vout: matches[0].vout, satoshis: state.budget.fundingSats, txStatus: status }))
}

async function waitConfirmed(path: string): Promise<void> {
  const state = loadState(path)
  const txid = state.chain.length > 0 ? state.chain.at(-1)!.txid : state.funding?.txid
  if (!txid) throw new Error('Nothing has been funded or broadcast.')
  const deadline = Date.now() + Number(option('timeout-minutes') ?? '90') * 60_000
  let attempt = 0
  while (Date.now() < deadline) {
    attempt += 1
    const status = await arcadeStatus(txid)
    console.log(JSON.stringify({ txid, attempt, txStatus: status.txStatus ?? 'NOT_FOUND', checkedAt: iso() }))
    if (status.txStatus === 'MINED') return
    if (status.txStatus && TERMINAL_FAILURE.has(status.txStatus)) throw new Error(`Terminal status ${status.txStatus} for ${txid}.`)
    await sleep(30_000)
  }
  throw new Error(`Timed out waiting for ${txid} to mine.`)
}

async function broadcastChain(path: string): Promise<void> {
  const state = loadState(path)
  if (!state.funding) throw new Error('Fund and confirm the campaign first.')
  const fundingStatus = await arcadeStatus(state.funding.txid)
  if (fundingStatus.txStatus !== 'MINED') throw new Error('Funding transaction is not mined; run wait-confirmed first.')
  const requestedLimit = option('limit') === undefined ? state.targets.length : Number(option('limit'))
  if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > state.targets.length) {
    throw new Error(`--limit must be an integer from 1 through ${state.targets.length}.`)
  }
  const stopAt = Math.min(state.targets.length, state.chain.length + requestedLimit)
  while (state.chain.length < stopAt) {
    const sequence = state.chain.length
    let transaction: Omit<ChainTransaction, 'txStatus' | 'acceptedAt'>
    if (state.pendingChain) {
      if (state.pendingChain.transaction.sequence !== sequence) throw new Error('Pending chain checkpoint sequence is inconsistent.')
      transaction = state.pendingChain.transaction
    } else {
      transaction = await prepareNextTransaction(state, sequence)
      const projectedNominal = nominal(state, transaction.outputSatoshis)
      if (projectedNominal > state.budget.maxNominalSats) throw new Error(`USD-denominated nominal-flow ceiling would be exceeded at sequence ${sequence}.`)
      state.pendingChain = { transaction, preparedAt: iso() }
      writeState(path, state)
    }
    const txStatus = await broadcastRaw(transaction.txid, transaction.rawHex)
    state.chain.push({ ...transaction, txStatus, acceptedAt: iso() })
    state.pendingChain = undefined
    writeState(path, state)
    if ((sequence + 1) % 10 === 0 || sequence === state.targets.length - 1) {
      console.log(JSON.stringify({ accepted: sequence + 1, total: state.targets.length, txid: transaction.txid, txStatus, remainingCarrierSats: transaction.carrierSatoshis, fees: state.chain.reduce((sum, tx) => sum + tx.feeSatoshis, 0), nominalSats: nominal(state) }))
    }
    await sleep(500)
  }
}

const scanScenarios = [
  { scenario: 'Centbee PIN full gap', walletId: 'centbee', profileId: 'centbee-primary', seedKind: 'centbee' as SeedKind, gapLimit: 30, accountCount: 1 },
  { scenario: 'RockWallet 221-output volume', walletId: 'rockwallet', profileId: 'rockwallet-primary', seedKind: 'bip39' as SeedKind, gapLimit: 20, accountCount: 1 },
  { scenario: 'Electrum native full gap', walletId: 'electrumsv', profileId: 'electrum-native', seedKind: 'electrum' as SeedKind, gapLimit: 30, accountCount: 1 },
  { scenario: 'Electrum imported BIP39 all coin types', walletId: 'electrumsv', profileId: 'electrum-bip39', seedKind: 'bip39' as SeedKind, gapLimit: 20, accountCount: 1 },
  { scenario: 'Exodus three accounts', walletId: 'exodus', profileId: 'exodus-bsv', seedKind: 'bip39' as SeedKind, gapLimit: 20, accountCount: 3 },
  { scenario: 'Coinomi native three accounts', walletId: 'coinomi', profileId: 'coinomi-native', seedKind: 'bip39' as SeedKind, gapLimit: 20, accountCount: 3 },
  { scenario: 'Coinomi fork three accounts', walletId: 'coinomi', profileId: 'coinomi-fork', seedKind: 'bip39' as SeedKind, gapLimit: 20, accountCount: 3 },
  { scenario: 'Atomic account zero', walletId: 'atomic', profileId: 'atomic-bsv', seedKind: 'bip39' as SeedKind, gapLimit: 20, accountCount: 1 },
  { scenario: 'Simply Cash account zero', walletId: 'simplycash', profileId: 'simplycash-standard', seedKind: 'bip39' as SeedKind, gapLimit: 20, accountCount: 1 },
]

async function scanMatrix(path: string): Promise<void> {
  const state = loadState(path)
  if (state.chain.length !== state.targets.length) throw new Error('The complete chain must be broadcast first.')
  const last = await arcadeStatus(state.chain.at(-1)!.txid)
  if (last.txStatus !== 'MINED') throw new Error('The final chain transaction is not mined; run wait-confirmed first.')
  state.scans = []
  for (const scenario of scanScenarios) {
    const started = Date.now()
    const report = await scanProfile(master(state, scenario.seedKind), getProfile(scenario.walletId, scenario.profileId), {
      gapLimit: scenario.gapLimit,
      accountCount: scenario.accountCount,
      onProgress: (message, completed) => {
        if (completed > 0 && completed % 100 === 0) console.log(JSON.stringify({ scenario: scenario.scenario, completed, message }))
      },
    })
    const expected = state.targets.filter((target) => target.profiles.includes(scenario.profileId)).length
    const found = flattenSources(report).length
    const record = {
      scenario: scenario.scenario, profileId: scenario.profileId, expectedOutputs: expected, foundOutputs: found,
      addressesChecked: report.addressesChecked, totalSatoshis: report.totalSatoshis,
      providersAgree: report.providersAgree, activityDisagreements: report.activityDisagreements,
      elapsedMs: Date.now() - started, completedAt: iso(),
    }
    state.scans.push(record)
    writeState(path, state)
    console.log(JSON.stringify(record))
    if (!report.providersAgree || found !== expected) throw new Error(`${scenario.scenario} found ${found}/${expected} expected outputs.`)
  }
}

async function reconcileChain(path: string): Promise<void> {
  const state = loadState(path)
  if (!state.funding || state.chain.length !== state.targets.length || state.pendingChain) throw new Error('Campaign chain is incomplete or pending.')
  let previousTxid = state.funding.txid
  let previousVout = state.funding.vout
  let outputCount = 0
  let feeSatoshis = 0
  let nominalSatoshis = state.budget.fundingSats
  const statusCounts: Record<string, number> = {}
  for (const [index, transaction] of state.chain.entries()) {
    if (transaction.sequence !== index || transaction.sourceTxid !== previousTxid || transaction.sourceVout !== previousVout || transaction.txid !== Transaction.fromHex(transaction.rawHex).id('hex')) {
      throw new Error(`Broken local transaction link at sequence ${index}.`)
    }
    const status = await arcadeStatus(transaction.txid)
    if (!status.found || !status.txStatus || (!ACCEPTED.has(status.txStatus) && !TERMINAL_FAILURE.has(status.txStatus))) throw new Error(`Unknown Arcade status for sequence ${index}.`)
    statusCounts[status.txStatus] = (statusCounts[status.txStatus] ?? 0) + 1
    previousTxid = transaction.txid
    previousVout = transaction.carrierVout ?? 0
    outputCount += transaction.carrierVout === null ? 1 : 2
    feeSatoshis += transaction.feeSatoshis
    nominalSatoshis += transaction.outputSatoshis
    if ((index + 1) % 25 === 0) console.log(JSON.stringify({ reconciled: index + 1, total: state.chain.length, statusCounts }))
    await sleep(100)
  }
  let allTargetsMatched = true
  for (let start = 0; start < state.targets.length; start += 20) {
    const batch = state.targets.slice(start, start + 20)
    const inspections = await inspectAddresses(batch.map((target) => target.address))
    for (const target of batch) {
      const inspection = inspections.get(target.address)!
      const expected = target.satoshis ?? state.chain.at(-1)!.outputSatoshis
      if (!inspection.providersAgree || inspection.utxos.length !== 1 || inspection.utxos[0].satoshis !== expected || inspection.utxos[0].txid !== state.chain[target.sequence].txid) allTargetsMatched = false
    }
    console.log(JSON.stringify({ targetAddressesReconciled: Math.min(start + 20, state.targets.length), total: state.targets.length }))
  }
  const nominalUsd = nominalSatoshis / 100_000_000 * state.price.usdPerBsv
  if (!allTargetsMatched || nominalSatoshis > state.budget.maxNominalSats || nominalUsd >= state.budget.maxUsd) throw new Error('Chain reconciliation or USD budget failed.')
  state.reconciliation = { statusCounts, transactionCount: state.chain.length, targetCount: state.targets.length, outputCount, feeSatoshis, nominalSatoshis, nominalUsd, allTargetsMatched, completedAt: iso() }
  writeState(path, state)
  console.log(JSON.stringify(state.reconciliation))
}

const sweepRoutes = [
  { route: 'RockWallet volume', walletId: 'rockwallet', profileId: 'rockwallet-primary', seedKind: 'bip39' as SeedKind, gapLimit: 20, accountCount: 1 },
  { route: 'Centbee PIN', walletId: 'centbee', profileId: 'centbee-primary', seedKind: 'centbee' as SeedKind, gapLimit: 30, accountCount: 1 },
  { route: 'Electrum native', walletId: 'electrumsv', profileId: 'electrum-native', seedKind: 'electrum' as SeedKind, gapLimit: 30, accountCount: 1 },
  { route: 'Electrum imported account zero', walletId: 'electrumsv', profileId: 'electrum-bip39', seedKind: 'bip39' as SeedKind, gapLimit: 20, accountCount: 1 },
  { route: 'Coinomi fork remaining accounts', walletId: 'coinomi', profileId: 'coinomi-fork', seedKind: 'bip39' as SeedKind, gapLimit: 20, accountCount: 3 },
  { route: 'Coinomi native remaining accounts', walletId: 'coinomi', profileId: 'coinomi-native', seedKind: 'bip39' as SeedKind, gapLimit: 20, accountCount: 3 },
]

async function resolvePendingSweep(state: CampaignState, path: string): Promise<void> {
  if (!state.pendingSweep) return
  const status = await arcadeStatus(state.pendingSweep.prepared.txid)
  if (!status.found || !status.txStatus || !ACCEPTED.has(status.txStatus)) {
    throw new Error(`Prepared sweep ${state.pendingSweep.prepared.txid} has an ambiguous outcome. Do not retry; inspect the wallet action and source outpoints.`)
  }
  const prepared = state.pendingSweep.prepared
  state.sweeps.push({ route: state.pendingSweep.route, txid: prepared.txid, inputCount: prepared.inputCount, sourceSatoshis: prepared.sourceSatoshis, feeSatoshis: prepared.feeSatoshis, completedAt: iso() })
  state.pendingSweep = undefined
  writeState(path, state)
}

async function sweep(path: string): Promise<void> {
  const state = loadState(path)
  if (!state.reconciliation?.allTargetsMatched || state.scans.length !== scanScenarios.length) throw new Error('Reconcile the chain and complete the scan matrix before sweeping.')
  await resolvePendingSweep(state, path)
  const wallet = new WalletClient('Cicada', ORIGIN)
  const { network } = await wallet.getNetwork({})
  if (network !== 'mainnet') throw new Error(`Wallet reported ${network}; mainnet required.`)
  for (const route of sweepRoutes) {
    for (;;) {
      const report = await scanProfile(master(state, route.seedKind), getProfile(route.walletId, route.profileId), { gapLimit: route.gapLimit, accountCount: route.accountCount })
      if (!report.providersAgree) throw new Error(`${route.route} providers disagree.`)
      const sources = flattenSources(report).slice(0, 100)
      if (sources.length === 0) break
      const prepared = await prepareMigration(wallet, master(state, route.seedKind), report, sources, (message) => console.log(JSON.stringify({ route: route.route, preparing: message })))
      state.pendingSweep = { route: route.route, prepared, preparedAt: iso() }
      writeState(path, state)
      const receipt = await commitMigration(wallet, prepared)
      state.sweeps.push({ route: route.route, txid: receipt.txid, inputCount: receipt.inputCount, sourceSatoshis: receipt.sourceSatoshis, feeSatoshis: receipt.feeSatoshis, completedAt: receipt.completedAt })
      state.pendingSweep = undefined
      writeState(path, state)
      console.log(JSON.stringify({ route: route.route, swept: true, txid: receipt.txid, inputCount: receipt.inputCount, sourceSatoshis: receipt.sourceSatoshis, feeSatoshis: receipt.feeSatoshis }))
      await sleep(10_000)
    }
  }
}

function status(path: string): void {
  const state = loadState(path)
  const summary = {
    state: path, createdAt: state.createdAt, funding: state.funding ? { txid: state.funding.txid, satoshis: state.funding.satoshis, txStatus: state.funding.txStatus } : null,
    chain: { accepted: state.chain.length, planned: state.targets.length, pending: state.pendingChain?.transaction.txid ?? null },
    scans: state.scans.length, sweeps: state.sweeps.length, pendingSweep: state.pendingSweep?.prepared.txid ?? null,
    feesSats: state.chain.reduce((sum, tx) => sum + tx.feeSatoshis, 0) + state.sweeps.reduce((sum, tx) => sum + tx.feeSatoshis, 0),
    nominalSats: nominal(state), reconciliation: state.reconciliation ?? null,
  }
  console.log(JSON.stringify(summary, null, 2))
}

async function main(): Promise<void> {
  const name = command()
  if (!['init', 'wallet-fund', 'wait-confirmed', 'broadcast-chain', 'reconcile-chain', 'scan-matrix', 'sweep', 'status'].includes(name)) usage()
  assertExecution(name)
  const path = statePath()
  if (name === 'init') return await withLock(path, () => init(path))
  if (!existsSync(path)) throw new Error('Campaign state does not exist; run init first.')
  if (name === 'status') return status(path)
  if (name === 'wait-confirmed') return await waitConfirmed(path)
  if (name === 'reconcile-chain') return await reconcileChain(path)
  await withLock(path, async () => {
    if (name === 'wallet-fund') await walletFund(path)
    else if (name === 'broadcast-chain') await broadcastChain(path)
    else if (name === 'scan-matrix') await scanMatrix(path)
    else if (name === 'sweep') await sweep(path)
  })
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
