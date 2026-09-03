import { HD, type PrivateKey } from '@bsv/sdk'
import { hmac } from '@noble/hashes/hmac.js'
import { pbkdf2 } from '@noble/hashes/pbkdf2.js'
import { sha512 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import { mnemonicToSeedSync, validateMnemonic } from '@scure/bip39'
import { wordlist as chineseSimplified } from '@scure/bip39/wordlists/simplified-chinese.js'
import { wordlist as chineseTraditional } from '@scure/bip39/wordlists/traditional-chinese.js'
import { wordlist as czech } from '@scure/bip39/wordlists/czech.js'
import { wordlist as english } from '@scure/bip39/wordlists/english.js'
import { wordlist as french } from '@scure/bip39/wordlists/french.js'
import { wordlist as italian } from '@scure/bip39/wordlists/italian.js'
import { wordlist as japanese } from '@scure/bip39/wordlists/japanese.js'
import { wordlist as korean } from '@scure/bip39/wordlists/korean.js'
import { wordlist as portuguese } from '@scure/bip39/wordlists/portuguese.js'
import { wordlist as spanish } from '@scure/bip39/wordlists/spanish.js'
import type { SeedFormat } from './catalog'

const wordlists = [english, japanese, korean, spanish, chineseSimplified, chineseTraditional, french, italian, czech, portuguese]

export function normalizeWords(words: string): string {
  return words.normalize('NFKD').trim().toLowerCase().split(/\s+/u).join(' ')
}

export function detectBip39Language(words: string): string[] | undefined {
  const normalized = normalizeWords(words)
  return wordlists.find((list) => validateMnemonic(normalized, list))
}

export function electrumSeedVersion(words: string): string {
  return bytesToHex(hmac(sha512, utf8ToBytes('Seed version'), utf8ToBytes(normalizeWords(words))))
}

export function isSupportedElectrumSeed(words: string): boolean {
  const version = electrumSeedVersion(words)
  return version.startsWith('01') && !version.startsWith('100') && !version.startsWith('101')
}

export function createMasterKey(words: string, passphrase: string, format: SeedFormat): HD {
  const normalizedWords = normalizeWords(words)
  const normalizedPassphrase = passphrase.normalize('NFKD')
  let seed: Uint8Array

  if (format === 'bip39') {
    const list = detectBip39Language(normalizedWords)
    if (!list) throw new Error('The words do not pass a BIP-39 checksum in any supported language.')
    seed = mnemonicToSeedSync(normalizedWords, normalizedPassphrase)
  } else {
    if (!isSupportedElectrumSeed(normalizedWords)) {
      throw new Error('This is not a supported standard Electrum v2 seed. Legacy v1, SegWit and 2FA seeds need their original recovery flow.')
    }
    seed = pbkdf2(sha512, utf8ToBytes(normalizedWords), utf8ToBytes(`electrum${normalizedPassphrase}`), { c: 2048, dkLen: 64 })
  }

  return HD.fromSeed(Array.from(seed))
}

export interface DerivedAddress {
  address: string
  path: string
  privateKey: PrivateKey
}

export function deriveAddress(master: HD, path: string): DerivedAddress {
  const child = master.derive(path.replaceAll('’', "'"))
  const privateKey = child.privKey
  if (!privateKey) throw new Error(`No private key was available for ${path}.`)
  return { path, privateKey, address: privateKey.toAddress().toString() }
}

export function expandTemplate(template: string, account: number, change: number, index: number): string {
  return template
    .replaceAll('{account}', String(account))
    .replaceAll('{change}', String(change))
    .replaceAll('{index}', String(index))
}
