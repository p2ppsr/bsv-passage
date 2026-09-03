import { describe, expect, it } from 'vitest'
import { readyWallets, wallets } from './catalog'

describe('wallet catalog', () => {
  it('uses unique wallet and profile identifiers', () => {
    expect(new Set(wallets.map((wallet) => wallet.id)).size).toBe(wallets.length)
    const profiles = wallets.flatMap((wallet) => wallet.profiles.map((profile) => profile.id))
    expect(new Set(profiles).size).toBe(profiles.length)
  })

  it('requires evidence and bounded path templates for every automatic profile', () => {
    for (const wallet of readyWallets) {
      expect(wallet.profiles.length).toBeGreaterThan(0)
      for (const profile of wallet.profiles) {
        expect(profile.source).toMatch(/^https:\/\//)
        expect(profile.templates.length).toBeGreaterThan(0)
        for (const template of profile.templates) {
          expect(template.startsWith('m/')).toBe(true)
          expect(template).toContain('{change}')
          expect(template).toContain('{index}')
        }
      }
    }
  })

  it('does not offer automatic sweep profiles for metadata, custodial or unknown formats', () => {
    for (const wallet of wallets.filter((entry) => entry.support !== 'ready')) expect(wallet.profiles).toEqual([])
  })
})
