import type { HD } from '@bsv/sdk'
import type { DerivationProfile } from './catalog'
import { deriveAddress, expandTemplate } from './seed'

export interface Utxo {
  txid: string
  vout: number
  satoshis: number
  height: number
}

interface AddressSnapshot {
  provider: 'WhatsOnChain' | 'Bitails'
  used: boolean
  utxos: Utxo[]
}

export interface FundedAddress {
  address: string
  path: string
  account: number
  change: number
  index: number
  satoshis: number
  utxos: Utxo[]
  providersAgree: boolean
  providerNote?: string
}

export interface ScanReport {
  profileId: string
  funded: FundedAddress[]
  addressesChecked: number
  totalSatoshis: number
  providersAgree: boolean
  activityDisagreements: number
  completedAt: string
}

export interface ScanOptions {
  gapLimit: number
  accountCount: number
  signal?: AbortSignal
  onProgress?: (message: string, completed: number) => void
}

const SPLIT_HEIGHT = 556_767
const MAX_ADDRESSES = 1_200
const REQUEST_TIMEOUT_MS = 12_000

export const BSV_BCH_SPLIT_HEIGHT = SPLIT_HEIGHT

class ProviderError extends Error {
  constructor(provider: string, message: string) {
    super(`${provider} could not verify this address: ${message}`)
    this.name = 'ProviderError'
  }
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}

async function fetchWithRetry(url: string, signal?: AbortSignal, init: RequestInit = {}): Promise<Response> {
  let lastError: Error | undefined
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
    try {
      const response = await fetch(url, {
        method: init.method ?? 'GET',
        mode: 'cors',
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        signal: combined,
        headers: { Accept: 'application/json', ...init.headers },
        body: init.body,
      })
      if (response.ok) return response
      if (response.status < 500 && response.status !== 429) throw new Error(`HTTP ${response.status}`)
      lastError = new Error(`HTTP ${response.status}`)
    } catch (error) {
      if (signal?.aborted) throw new DOMException('Scan cancelled.', 'AbortError')
      lastError = asError(error)
    }
    if (attempt < 2) await new Promise((resolve) => window.setTimeout(resolve, 450 * (attempt + 1)))
  }
  throw lastError ?? new Error('request failed')
}

function normalizeUtxos(utxos: Utxo[]): Utxo[] {
  return [...utxos]
    .filter((utxo) => Number.isSafeInteger(utxo.satoshis) && utxo.satoshis > 0 && /^[0-9a-f]{64}$/i.test(utxo.txid) && Number.isInteger(utxo.vout) && utxo.vout >= 0)
    .sort((a, b) => `${a.txid}.${a.vout}`.localeCompare(`${b.txid}.${b.vout}`))
}

async function queryWhatsOnChain(address: string, signal?: AbortSignal): Promise<AddressSnapshot> {
  try {
    const [historyResponse, utxoResponse] = await Promise.all([
      fetchWithRetry('https://api.whatsonchain.com/v1/bsv/main/addresses/history/all', signal, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ addresses: [address] }),
      }),
      fetchWithRetry(`https://api.whatsonchain.com/v1/bsv/main/address/${encodeURIComponent(address)}/unspent/all`, signal),
    ])
    const historyBody: unknown = await historyResponse.json()
    const utxoBody: unknown = await utxoResponse.json()
    const rows = Array.isArray(utxoBody)
      ? utxoBody
      : typeof utxoBody === 'object' && utxoBody !== null && Array.isArray((utxoBody as { result?: unknown }).result)
        ? (utxoBody as { result: unknown[] }).result
        : []
    const utxos = normalizeUtxos(rows.map((row) => {
      const item = row as Record<string, unknown>
      return {
        txid: String(item.tx_hash ?? item.txid ?? ''),
        vout: Number(item.tx_pos ?? item.vout ?? -1),
        satoshis: Number(item.value ?? item.satoshis ?? 0),
        height: Number(item.height ?? item.blockheight ?? 0),
      }
    }))
    const firstHistory = Array.isArray(historyBody) && historyBody.length > 0 ? historyBody[0] as Record<string, unknown> : undefined
    const confirmed = firstHistory?.confirmed as { result?: unknown[] } | undefined
    const unconfirmed = firstHistory?.unconfirmed as { result?: unknown[] } | undefined
    const used = (confirmed?.result?.length ?? 0) > 0 || (unconfirmed?.result?.length ?? 0) > 0 || utxos.length > 0
    return { provider: 'WhatsOnChain', used, utxos }
  } catch (error) {
    if (signal?.aborted) throw new DOMException('Scan cancelled.', 'AbortError')
    throw new ProviderError('WhatsOnChain', asError(error).message)
  }
}

async function queryBitails(address: string, signal?: AbortSignal): Promise<AddressSnapshot> {
  try {
    const [historyResponse, utxoResponse] = await Promise.all([
      fetchWithRetry(`https://api.bitails.io/address/${encodeURIComponent(address)}/history?limit=1`, signal),
      fetchWithRetry(`https://api.bitails.io/address/${encodeURIComponent(address)}/unspent?limit=5000`, signal),
    ])
    const historyBody: unknown = await historyResponse.json()
    const utxoBody: unknown = await utxoResponse.json()
    const historyRows = Array.isArray(historyBody)
      ? historyBody
      : typeof historyBody === 'object' && historyBody !== null
        ? ((historyBody as { history?: unknown[]; transactions?: unknown[] }).history ?? (historyBody as { transactions?: unknown[] }).transactions ?? [])
        : []
    const rows = typeof utxoBody === 'object' && utxoBody !== null && Array.isArray((utxoBody as { unspent?: unknown }).unspent)
      ? (utxoBody as { unspent: unknown[] }).unspent
      : Array.isArray(utxoBody) ? utxoBody : []
    const utxos = normalizeUtxos(rows.map((row) => {
      const item = row as Record<string, unknown>
      return {
        txid: String(item.txid ?? item.tx_hash ?? ''),
        vout: Number(item.vout ?? item.tx_pos ?? -1),
        satoshis: Number(item.satoshis ?? item.value ?? 0),
        height: Number(item.blockheight ?? item.height ?? 0),
      }
    }))
    return { provider: 'Bitails', used: historyRows.length > 0 || utxos.length > 0, utxos }
  } catch (error) {
    if (signal?.aborted) throw new DOMException('Scan cancelled.', 'AbortError')
    throw new ProviderError('Bitails', asError(error).message)
  }
}

function utxoKey(utxo: Utxo): string {
  return `${utxo.txid}.${utxo.vout}:${utxo.satoshis}`
}

function compareUtxos(a: Utxo[], b: Utxo[]): boolean {
  return a.length === b.length && a.every((utxo, index) => utxoKey(utxo) === utxoKey(b[index]))
}

export async function inspectAddress(address: string, signal?: AbortSignal): Promise<{
  used: boolean
  activityAgrees: boolean
  providersAgree: boolean
  utxos: Utxo[]
  note?: string
}> {
  const [woc, bitails] = await Promise.all([queryWhatsOnChain(address, signal), queryBitails(address, signal)])
  const providersAgree = compareUtxos(woc.utxos, bitails.utxos)
  return {
    used: woc.used || bitails.used,
    activityAgrees: woc.used === bitails.used,
    providersAgree,
    utxos: providersAgree ? woc.utxos : [],
    note: providersAgree ? undefined : `${woc.provider} reported ${woc.utxos.length} UTXOs while ${bitails.provider} reported ${bitails.utxos.length}.`,
  }
}

export async function scanProfile(master: HD, profile: DerivationProfile, options: ScanOptions): Promise<ScanReport> {
  if (!Number.isInteger(options.gapLimit) || options.gapLimit < 5 || options.gapLimit > 100) throw new Error('Gap limit must be between 5 and 100.')
  if (!Number.isInteger(options.accountCount) || options.accountCount < 1 || options.accountCount > 20) throw new Error('Account count must be between 1 and 20.')

  const funded: FundedAddress[] = []
  let checked = 0
  let activityDisagreements = 0

  for (const template of profile.templates) {
    const accounts = template.includes('{account}') ? options.accountCount : 1
    for (let account = 0; account < accounts; account += 1) {
      for (const change of [0, 1]) {
        let gap = 0
        let index = 0
        while (gap < options.gapLimit) {
          if (checked >= MAX_ADDRESSES) throw new Error(`The ${MAX_ADDRESSES}-address safety ceiling was reached. Narrow the profile or recover with a reviewed offline specialist workflow.`)
          if (options.signal?.aborted) throw new DOMException('Scan cancelled.', 'AbortError')
          const path = expandTemplate(template, account, change, index)
          const derived = deriveAddress(master, path)
          options.onProgress?.(`Checking ${profile.label} · account ${account + 1} · ${change === 0 ? 'receiving' : 'change'} ${index}`, checked)
          const snapshot = await inspectAddress(derived.address, options.signal)
          checked += 1
          if (!snapshot.activityAgrees) activityDisagreements += 1
          if (snapshot.used) gap = 0
          else gap += 1
          if (snapshot.providersAgree && snapshot.utxos.length > 0) {
            funded.push({
              address: derived.address, path, account, change, index,
              satoshis: snapshot.utxos.reduce((sum, utxo) => sum + utxo.satoshis, 0),
              utxos: snapshot.utxos,
              providersAgree: true,
            })
          } else if (!snapshot.providersAgree) {
            funded.push({
              address: derived.address, path, account, change, index,
              satoshis: 0, utxos: [], providersAgree: false, providerNote: snapshot.note,
            })
          }
          index += 1
        }
      }
    }
  }

  const unique = new Map<string, FundedAddress>()
  for (const result of funded) unique.set(`${result.address}:${result.path}`, result)
  const results = [...unique.values()]
  return {
    profileId: profile.id,
    funded: results,
    addressesChecked: checked,
    totalSatoshis: results.reduce((sum, result) => sum + result.satoshis, 0),
    providersAgree: results.every((result) => result.providersAgree),
    activityDisagreements,
    completedAt: new Date().toISOString(),
  }
}

export function hasReplayAmbiguity(report: ScanReport): boolean {
  return report.funded.some((result) => result.utxos.some((utxo) => utxo.height > 0 && utxo.height <= SPLIT_HEIGHT))
}

export function hasUnconfirmed(report: ScanReport): boolean {
  return report.funded.some((result) => result.utxos.some((utxo) => utxo.height <= 0))
}
