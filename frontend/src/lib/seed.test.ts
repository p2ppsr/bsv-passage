import { describe, expect, it } from 'vitest'
import { createMasterKey, deriveAddress, detectBip39Language, electrumSeedVersion, expandTemplate, isSupportedElectrumSeed, normalizeWords } from './seed'

const bip39 = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const electrum = 'cycle rocket west magnet parrot shuffle foot correct salt library feed song'

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

  it('recognizes and derives a standard Electrum v2 seed', () => {
    expect(electrumSeedVersion(electrum).startsWith('01')).toBe(true)
    expect(isSupportedElectrumSeed(electrum)).toBe(true)
    const master = createMasterKey(electrum, '', 'electrum-v2')
    expect(deriveAddress(master, 'm/0/0').address).toBe('1NNkttn1YvVGdqBW4PR6zvc3Zx3H5owKRf')
    expect(deriveAddress(master, 'm/1/0').address).toBe('1KSezYMhAJMWqFbVFB2JshYg69UpmEXR4D')
  })

  it('expands accounts, chains and indexes exactly', () => {
    expect(expandTemplate("m/44'/236'/{account}'/{change}/{index}", 3, 1, 27)).toBe("m/44'/236'/3'/1/27")
  })
})
