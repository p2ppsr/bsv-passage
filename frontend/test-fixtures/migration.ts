import { MerklePath, P2PKH, PrivateKey, Transaction, UnlockingScript, Utils } from '@bsv/sdk'
import { createMasterKey, deriveAddress } from '../src/lib/seed'
import { flattenSources } from '../src/lib/migration'
import type { ScanReport } from '../src/lib/providers'

// Public BIP-39 test vector and fabricated transactions. Never fund these keys.
export const testWords = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
export const testReference = 'c3ludGhldGljLXJlZmVyZW5jZQ=='

export function headerForRoot(root: string): string {
  return '00'.repeat(36) + Utils.toHex(Utils.toArray(root, 'hex').reverse()) + '00'.repeat(12)
}

export function migrationFixture() {
  const master = createMasterKey(testWords, '', 'bip39')
  const path = "m/0'/0/0"
  const derived = deriveAddress(master, path)
  const source = new Transaction()
  source.addOutput({ satoshis: 10000, lockingScript: new P2PKH().lock(derived.address) })
  source.merklePath = new MerklePath(800000, [[{ offset: 0, hash: source.id('hex'), txid: true }]])
  const tx = new Transaction()
  tx.addInput({ sourceTransaction: source, sourceOutputIndex: 0, unlockingScript: new UnlockingScript() })
  tx.addOutput({ satoshis: 9900, lockingScript: new P2PKH().lock(PrivateKey.fromString('2', 10).toAddress()) })
  const report: ScanReport = {
    profileId: 'rockwallet-primary', addressesChecked: 40, totalSatoshis: 10000, providersAgree: true,
    activityDisagreements: 0, completedAt: '2026-09-29T00:00:00.000Z',
    funded: [{ address: derived.address, path, account: 0, change: 0, index: 0, satoshis: 10000, providersAgree: true,
      utxos: [{ txid: source.id('hex'), vout: 0, satoshis: 10000, height: 800000 }] }],
  }
  return { master, derived, source, tx, report, sources: flattenSources(report), header: headerForRoot(source.id('hex')) }
}
