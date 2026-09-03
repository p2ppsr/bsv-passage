import type { HD } from '@bsv/sdk'
import type { DerivationProfile } from './catalog'
import {
  abortableDelay, parseRetryAfter, PROVIDER_REQUEST_POLICIES, RequestStartGate, retryDelay,
  type RequestPolicy,
} from './rate-limit'
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
const DISCOVERY_BATCH_SIZE = 20
const IS_TEST = import.meta.env.MODE === 'test'

type Provider = keyof typeof PROVIDER_REQUEST_POLICIES

const requestGates: Record<Provider, RequestStartGate> = {
  WhatsOnChain: new RequestStartGate(IS_TEST ? 0 : PROVIDER_REQUEST_POLICIES.WhatsOnChain.minSpacingMs),
  Bitails: new RequestStartGate(IS_TEST ? 0 : PROVIDER_REQUEST_POLICIES.Bitails.minSpacingMs),
}

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

async function fetchWithRetry(provider: Provider, url: string, signal?: AbortSignal, init: RequestInit = {}): Promise<Response> {
  const policy: RequestPolicy = PROVIDER_REQUEST_POLICIES[provider]
  let lastError: Error | undefined
  for (let attempt = 0; attempt < policy.maxAttempts; attempt += 1) {
    await requestGates[provider].wait(signal)
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
      const retryAfterMs = parseRetryAfter(response.headers.get('Retry-After'))
      if (response.status === 429 && retryAfterMs !== undefined && retryAfterMs > policy.maxRetryAfterMs) {
        throw new Error(`HTTP 429; the provider requested a ${Math.ceil(retryAfterMs / 1_000)}-second cooldown. Passage stopped safely—wait, then scan again.`)
      }
      lastError = new Error(response.status === 429 ? 'HTTP 429 rate limit' : `HTTP ${response.status}`)
      if (attempt < policy.maxAttempts - 1) {
        await abortableDelay(IS_TEST ? 0 : retryDelay(policy, url, attempt, retryAfterMs), signal)
      }
    } catch (error) {
      if (signal?.aborted) throw new DOMException('Scan cancelled.', 'AbortError')
      lastError = asError(error)
      if (/cooldown/.test(lastError.message) || /^HTTP 4\d\d/.test(lastError.message) && !/^HTTP 429/.test(lastError.message)) throw lastError
      if (attempt < policy.maxAttempts - 1) {
        await abortableDelay(IS_TEST ? 0 : retryDelay(policy, url, attempt), signal)
      }
    }
  }
  throw lastError ?? new Error('request failed')
}

function normalizeUtxos(utxos: Utxo[]): Utxo[] {
  return [...utxos]
    .filter((utxo) => Number.isSafeInteger(utxo.satoshis) && utxo.satoshis > 0 && /^[0-9a-f]{64}$/i.test(utxo.txid) && Number.isInteger(utxo.vout) && utxo.vout >= 0)
    .sort((a, b) => `${a.txid}.${a.vout}`.localeCompare(`${b.txid}.${b.vout}`))
}

function rowsByAddress(body: unknown, provider: Provider, addresses: string[]): Map<string, Record<string, unknown>> {
  if (!Array.isArray(body)) throw new Error(`${provider} returned a malformed batch response.`)
  const rows = new Map<string, Record<string, unknown>>()
  for (const value of body) {
    if (typeof value !== 'object' || value === null) continue
    const row = value as Record<string, unknown>
    const address = String(row.address ?? '')
    if (addresses.includes(address) && !rows.has(address)) rows.set(address, row)
  }
  const missing = addresses.filter((address) => !rows.has(address))
  if (missing.length > 0) throw new Error(`${provider} omitted ${missing.length} requested address${missing.length === 1 ? '' : 'es'}.`)
  return rows
}

async function queryWhatsOnChainActivity(addresses: string[], signal?: AbortSignal): Promise<Map<string, boolean>> {
  try {
    const historyResponse = await fetchWithRetry('WhatsOnChain', 'https://api.whatsonchain.com/v1/bsv/main/addresses/history/all', signal, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ addresses }),
    })
    const historyBody: unknown = await historyResponse.json()
    const rows = rowsByAddress(historyBody, 'WhatsOnChain', addresses)
    return new Map(addresses.map((address) => {
      const row = rows.get(address)!
      const confirmed = row.confirmed as { result?: unknown[] } | undefined
      const unconfirmed = row.unconfirmed as { result?: unknown[] } | undefined
      if (!Array.isArray(confirmed?.result) || !Array.isArray(unconfirmed?.result)) throw new Error('WhatsOnChain returned malformed history data.')
      return [address, confirmed.result.length > 0 || unconfirmed.result.length > 0]
    }))
  } catch (error) {
    if (signal?.aborted) throw new DOMException('Scan cancelled.', 'AbortError')
    throw new ProviderError('WhatsOnChain', asError(error).message)
  }
}

async function queryWhatsOnChainUtxos(address: string, signal?: AbortSignal): Promise<Utxo[]> {
  try {
    const response = await fetchWithRetry('WhatsOnChain', `https://api.whatsonchain.com/v1/bsv/main/address/${encodeURIComponent(address)}/unspent/all`, signal)
    const utxoBody: unknown = await response.json()
    const rows = Array.isArray(utxoBody)
      ? utxoBody
      : typeof utxoBody === 'object' && utxoBody !== null && Array.isArray((utxoBody as { result?: unknown }).result)
        ? (utxoBody as { result: unknown[] }).result
        : undefined
    if (!rows) throw new Error('WhatsOnChain returned malformed UTXO data.')
    return normalizeUtxos(rows.map((row) => {
      const item = row as Record<string, unknown>
      return {
        txid: String(item.tx_hash ?? item.txid ?? ''),
        vout: Number(item.tx_pos ?? item.vout ?? -1),
        satoshis: Number(item.value ?? item.satoshis ?? 0),
        height: Number(item.height ?? item.blockheight ?? 0),
      }
    }))
  } catch (error) {
    if (signal?.aborted) throw new DOMException('Scan cancelled.', 'AbortError')
    throw new ProviderError('WhatsOnChain', asError(error).message)
  }
}

async function queryBitailsActivity(addresses: string[], signal?: AbortSignal): Promise<Map<string, boolean>> {
  try {
    const response = await fetchWithRetry('Bitails', 'https://api.bitails.io/address/balance/multi/separate', signal, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ addresses }),
    })
    const rows = rowsByAddress(await response.json(), 'Bitails', addresses)
    return new Map(addresses.map((address) => {
      const row = rows.get(address)!
      const values = [row.confirmed, row.unconfirmed, row.summary, row.count]
      if (values.some((value) => !Number.isFinite(Number(value)))) throw new Error('Bitails returned malformed balance data.')
      return [address, values.some((value) => Number(value) !== 0)]
    }))
  } catch (error) {
    if (signal?.aborted) throw new DOMException('Scan cancelled.', 'AbortError')
    throw new ProviderError('Bitails', asError(error).message)
  }
}

async function queryBitailsUtxos(addresses: string[], signal?: AbortSignal): Promise<Map<string, Utxo[]>> {
  if (addresses.length === 0) return new Map()
  try {
    const response = await fetchWithRetry('Bitails', 'https://api.bitails.io/address/unspent/multi?limit=5000', signal, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ addresses }),
    })
    const body: unknown = await response.json()
    if (!Array.isArray(body)) throw new Error('Bitails returned a malformed batch response.')
    // Bitails' bulk UTXO endpoint omits addresses with no unspent outputs. This
    // differs from its balance endpoint; an omitted row is therefore an empty
    // set, not enough evidence to fail a scan by itself. Any funded omission is
    // still caught by the independent WhatsOnChain outpoint comparison.
    const rows = new Map<string, Record<string, unknown>>()
    for (const value of body) {
      if (typeof value !== 'object' || value === null) throw new Error('Bitails returned malformed UTXO data.')
      const row = value as Record<string, unknown>
      const address = String(row.address ?? '')
      if (!addresses.includes(address) || rows.has(address)) throw new Error('Bitails returned an unexpected or duplicate UTXO row.')
      rows.set(address, row)
    }
    return new Map(addresses.map((address) => {
      const row = rows.get(address)
      if (row !== undefined && !Array.isArray(row.unspent)) throw new Error('Bitails returned malformed UTXO data.')
      const utxos = normalizeUtxos((row?.unspent as unknown[] | undefined ?? []).map((value) => {
        const item = value as Record<string, unknown>
        return {
          txid: String(item.txid ?? item.tx_hash ?? ''),
          vout: Number(item.vout ?? item.tx_pos ?? -1),
          satoshis: Number(item.satoshis ?? item.value ?? 0),
          height: Number(item.blockheight ?? item.height ?? 0),
        }
      }))
      return [address, utxos]
    }))
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

export interface AddressInspection {
  used: boolean
  activityAgrees: boolean
  providersAgree: boolean
  utxos: Utxo[]
  note?: string
}

export async function inspectAddresses(addresses: string[], signal?: AbortSignal): Promise<Map<string, AddressInspection>> {
  if (addresses.length < 1 || addresses.length > DISCOVERY_BATCH_SIZE || new Set(addresses).size !== addresses.length) {
    throw new Error(`Address inspection requires 1–${DISCOVERY_BATCH_SIZE} unique addresses.`)
  }
  const [wocActivity, bitailsActivity] = await Promise.all([
    queryWhatsOnChainActivity(addresses, signal), queryBitailsActivity(addresses, signal),
  ])
  const active = addresses.filter((address) => wocActivity.get(address) || bitailsActivity.get(address))
  const [wocPairs, bitailsUtxos] = await Promise.all([
    Promise.all(active.map(async (address) => [address, await queryWhatsOnChainUtxos(address, signal)] as const)),
    queryBitailsUtxos(active, signal),
  ])
  const wocUtxos = new Map(wocPairs)
  return new Map(addresses.map((address) => {
    const woc: AddressSnapshot = { provider: 'WhatsOnChain', used: wocActivity.get(address) ?? false, utxos: wocUtxos.get(address) ?? [] }
    const bitails: AddressSnapshot = { provider: 'Bitails', used: bitailsActivity.get(address) ?? false, utxos: bitailsUtxos.get(address) ?? [] }
    const providersAgree = compareUtxos(woc.utxos, bitails.utxos)
    return [address, {
      used: woc.used || bitails.used,
      activityAgrees: woc.used === bitails.used,
      providersAgree,
      utxos: providersAgree ? woc.utxos : [],
      note: providersAgree ? undefined : `${woc.provider} reported ${woc.utxos.length} UTXOs while ${bitails.provider} reported ${bitails.utxos.length}.`,
    }]
  }))
}

export async function inspectAddress(address: string, signal?: AbortSignal): Promise<AddressInspection> {
  return (await inspectAddresses([address], signal)).get(address)!
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
          const count = Math.min(DISCOVERY_BATCH_SIZE, options.gapLimit - gap, MAX_ADDRESSES - checked)
          const candidates = Array.from({ length: count }, (_, offset) => {
            const candidateIndex = index + offset
            const path = expandTemplate(template, account, change, candidateIndex)
            return { ...deriveAddress(master, path), path, index: candidateIndex }
          })
          const last = candidates.at(-1)!.index
          options.onProgress?.(`Checking ${profile.label} · account ${account + 1} · ${change === 0 ? 'receiving' : 'change'} ${index}${last === index ? '' : `–${last}`}`, checked)
          const snapshots = await inspectAddresses(candidates.map((candidate) => candidate.address), options.signal)
          for (const candidate of candidates) {
            if (gap >= options.gapLimit) break
            const snapshot = snapshots.get(candidate.address)!
            checked += 1
            index = candidate.index + 1
            if (!snapshot.activityAgrees) activityDisagreements += 1
            if (snapshot.used) gap = 0
            else gap += 1
            if (snapshot.providersAgree && snapshot.utxos.length > 0) {
              funded.push({
                address: candidate.address, path: candidate.path, account, change, index: candidate.index,
                satoshis: snapshot.utxos.reduce((sum, utxo) => sum + utxo.satoshis, 0),
                utxos: snapshot.utxos,
                providersAgree: true,
              })
            } else if (!snapshot.providersAgree) {
              funded.push({
                address: candidate.address, path: candidate.path, account, change, index: candidate.index,
                satoshis: 0, utxos: [], providersAgree: false, providerNote: snapshot.note,
              })
            }
          }
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
