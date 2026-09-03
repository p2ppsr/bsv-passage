import { describe, expect, it } from 'vitest'
import { entropyToMnemonic } from '@scure/bip39'
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
import { createMasterKey, deriveAddress, detectBip39Language, electrumSeedVersion, expandTemplate, isSupportedElectrumSeed, normalizeWords } from './seed'

const bip39 = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const electrum = 'cycle rocket west magnet parrot shuffle foot correct salt library feed song'
const electrumSegwit = 'frost pig brisk excite novel report camera enlist axis nation novel desert'
const wordlists = [english, japanese, korean, spanish, chineseSimplified, chineseTraditional, french, italian, czech, portuguese]

describe('seed derivation', () => {
  it('normalizes user whitespace without weakening checksum validation', () => {
    expect(normalizeWords(`  ABANDON\n${'abandon '.repeat(10)}about `)).toBe(bip39)
    expect(detectBip39Language(bip39)).toBeDefined()
  })

  it('matches the published BIP-39 TREZOR vector at common historical paths', () => {
    const master = createMasterKey(bip39, 'TREZOR', 'bip39')
    expect(deriveAddress(master, "m/44'/0'/0'/0/0").address).toBe('1PEha8dk5Me5J1rZWpgqSt5F4BroTBLS5y')
    expect(deriveAddress(master, "m/44'/145'/0'/0/0").address).toBe('1BpiPFc567BR2H9Aa5po1YZXJ26kPcPbSj')
    expect(deriveAddress(master, "m/44'/236'/0'/0/0").address).toBe('12GPKCteB47VJd68ACWLghHpCexqs7aN2m')
  })

  it('rejects a BIP-39 phrase with a bad checksum', () => {
    expect(() => createMasterKey(`${bip39.slice(0, bip39.lastIndexOf(' '))} abandon`, '', 'bip39')).toThrow(/checksum/)
  })

  it.each([16, 20, 24, 28, 32])('accepts the BIP-39 entropy size represented by %i bytes', (byteLength) => {
    const words = entropyToMnemonic(new Uint8Array(byteLength), english)
    expect(words.split(' ')).toHaveLength((byteLength * 3) / 4)
    expect(() => createMasterKey(words, '', 'bip39')).not.toThrow()
  })

  it.each(wordlists.map((list, index) => [index, list] as const))('derives supported BIP-39 language fixture %i', (_index, list) => {
    const words = entropyToMnemonic(new Uint8Array(16), list)
    expect(detectBip39Language(words)).toBeDefined()
    expect(deriveAddress(createMasterKey(words, '', 'bip39'), "m/44'/236'/0'/0/0").address).toMatch(/^1/)
  })

  it('normalizes Unicode passphrases with NFKD before derivation', () => {
    const composed = createMasterKey(bip39, '\u00e9', 'bip39')
    const decomposed = createMasterKey(bip39, 'e\u0301', 'bip39')
    expect(deriveAddress(composed, "m/44'/236'/0'/0/0").address)
      .toBe(deriveAddress(decomposed, "m/44'/236'/0'/0/0").address)
  })

  it('recognizes and derives a standard Electrum v2 seed', () => {
    expect(electrumSeedVersion(electrum).startsWith('01')).toBe(true)
    expect(isSupportedElectrumSeed(electrum)).toBe(true)
    const master = createMasterKey(electrum, '', 'electrum-v2')
    expect(deriveAddress(master, 'm/0/0').address).toBe('1NNkttn1YvVGdqBW4PR6zvc3Zx3H5owKRf')
    expect(deriveAddress(master, 'm/1/0').address).toBe('1KSezYMhAJMWqFbVFB2JshYg69UpmEXR4D')
  })

  it('rejects Electrum SegWit seeds instead of deriving the wrong wallet', () => {
    expect(electrumSeedVersion(electrumSegwit).startsWith('100')).toBe(true)
    expect(isSupportedElectrumSeed(electrumSegwit)).toBe(false)
    expect(() => createMasterKey(electrumSegwit, '', 'electrum-v2')).toThrow(/SegWit and 2FA/)
  })

  it('expands accounts, chains and indexes exactly', () => {
    expect(expandTemplate("m/44'/236'/{account}'/{change}/{index}", 3, 1, 27)).toBe("m/44'/236'/3'/1/27")
  })
})
