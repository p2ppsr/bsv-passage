export type SupportLevel = 'ready' | 'guided' | 'not-seed-based'
export type SeedFormat = 'bip39' | 'electrum-v2'

export interface DerivationProfile {
  id: string
  label: string
  seedFormat: SeedFormat
  templates: string[]
  source: string
  sourceLabel: string
  confidence: 'verified' | 'documented' | 'investigative'
  note?: string
}

export interface WalletEntry {
  id: string
  name: string
  era: string
  status: string
  support: SupportLevel
  summary: string
  profiles: DerivationProfile[]
  steps: string[]
  caveat?: string
}

export const wallets: WalletEntry[] = [
  {
    id: 'centbee',
    name: 'Centbee',
    era: '2018–present',
    status: 'Recovery site available',
    support: 'ready',
    summary: 'BIP-39 phrase with the original four-digit PIN used as the BIP-39 passphrase.',
    profiles: [{
      id: 'centbee-primary', label: 'Centbee standard', seedFormat: 'bip39',
      templates: ["m/44'/0/{change}/{index}"], confidence: 'verified',
      source: 'https://github.com/HandCash/centbee-recovery', sourceLabel: 'Centbee recovery implementation',
      note: 'The coin and chain components are intentionally not hardened.',
    }],
    steps: ['Choose Centbee.', 'Enter the backup words exactly.', 'Enter the original four-digit wallet PIN in the passphrase field.', 'Scan both receiving and change chains.'],
    caveat: 'A wrong PIN can still derive a valid but empty wallet. Do not assume an empty result means the words are wrong.',
  },
  {
    id: 'rockwallet', name: 'RockWallet', era: '2021–present', status: 'Active', support: 'ready',
    summary: 'BIP-39 phrase using RockWallet’s documented BIP-32 path.',
    profiles: [{
      id: 'rockwallet-primary', label: 'RockWallet BSV', seedFormat: 'bip39',
      templates: ["m/0'/{change}/{index}"], confidence: 'documented',
      source: 'https://help.rockwallet.com/what-derivation-paths-does-rockwallet-use', sourceLabel: 'RockWallet derivation-path help',
      note: 'The first documented address is m/0\'/0/0; Passage also checks the conventional change branch.',
    }],
    steps: ['Choose RockWallet.', 'Enter the wallet recovery phrase.', 'Leave passphrase empty unless you deliberately created one.', 'Review both external and change results.'],
  },
  {
    id: 'electrumsv', name: 'ElectrumSV / ElectrumSVP', era: '2018–present', status: 'ElectrumSVP active', support: 'ready',
    summary: 'Native Electrum v2 seeds and imported BIP-39 seeds across the historical BSV coin types.',
    profiles: [
      { id: 'electrum-native', label: 'Native Electrum seed', seedFormat: 'electrum-v2', templates: ['m/{change}/{index}'], confidence: 'verified', source: 'https://github.com/electrumsv/electrumsv/blob/releases/1.3/RELEASE-NOTES', sourceLabel: 'ElectrumSV release notes' },
      { id: 'electrum-bip39', label: 'BIP-39 imported into ElectrumSV', seedFormat: 'bip39', templates: ["m/44'/0'/0'/{change}/{index}", "m/44'/145'/0'/{change}/{index}", "m/44'/236'/0'/{change}/{index}"], confidence: 'verified', source: 'https://github.com/electrumsv/electrumsv/blob/releases/1.3/RELEASE-NOTES', sourceLabel: 'ElectrumSV release notes', note: 'ElectrumSV used 0, 145 and 236 at different points or for imports.' },
    ],
    steps: ['Choose whether the phrase was created by Electrum or imported from another wallet.', 'Include any Electrum seed extension/passphrase.', 'Increase account depth only for a BIP-39 wallet that used additional accounts.', 'For loose WIF keys, use ElectrumSVP’s dedicated sweep instead.'],
    caveat: 'Electrum v1 seeds, multisig wallets and hardware-wallet descriptors need their original recovery workflow and are not silently guessed.',
  },
  {
    id: 'exodus', name: 'Exodus', era: '2018–present', status: 'BSV support varies', support: 'ready',
    summary: 'BIP-39 with the registered BSV coin type 236.',
    profiles: [{ id: 'exodus-bsv', label: 'Exodus BSV', seedFormat: 'bip39', templates: ["m/44'/236'/{account}'/{change}/{index}"], confidence: 'verified', source: 'https://www.exodus.com/support/en/articles/8598933-derivation-paths-in-exodus', sourceLabel: 'Exodus derivation paths' }],
    steps: ['Choose Exodus.', 'Enter the Exodus recovery phrase and optional passphrase.', 'Scan more accounts if you used Exodus portfolios.', 'Confirm the address sample against an old Exodus record if one is available.'],
  },
  {
    id: 'coinomi', name: 'Coinomi', era: '2018–2024', status: 'BSV delisted', support: 'ready',
    summary: 'Checks native BSV path 236 and the BCH-fork path 145.',
    profiles: [
      { id: 'coinomi-native', label: 'Coinomi native BSV', seedFormat: 'bip39', templates: ["m/44'/236'/{account}'/{change}/{index}"], confidence: 'verified', source: 'https://coinomi.freshdesk.com/support/solutions/articles/29000032982-i-have-a-coin-that-is-being-or-has-been-delisted-what-should-i-do-', sourceLabel: 'Coinomi delisting guide' },
      { id: 'coinomi-fork', label: 'Coinomi BCH fork balance', seedFormat: 'bip39', templates: ["m/44'/145'/{account}'/{change}/{index}"], confidence: 'verified', source: 'https://coinomi.freshdesk.com/support/solutions/articles/29000026274-bch-abc-bsv-fork-information-splitter-tool', sourceLabel: 'Coinomi BSV split guide', note: 'Pre-split outputs are detected and blocked from automatic migration.' },
    ],
    steps: ['Choose the native BSV profile if BSV was added as its own Coinomi asset.', 'Choose BCH fork if the balance originated before the 2018 split.', 'Scan every account you used.', 'Resolve any replay warning before migration.'],
    caveat: 'A pre-split outpoint may also exist on BCH. Passage will not broadcast it automatically.',
  },
  {
    id: 'atomic', name: 'Atomic Wallet', era: '2018–present', status: 'BSV availability varies', support: 'ready',
    summary: 'BIP-39 with Atomic’s documented BSV path under coin type 145.',
    profiles: [{ id: 'atomic-bsv', label: 'Atomic BSV', seedFormat: 'bip39', templates: ["m/44'/145'/0'/{change}/{index}"], confidence: 'verified', source: 'https://support.atomicwallet.io/article/146-list-of-derivation-paths', sourceLabel: 'Atomic derivation paths' }],
    steps: ['Choose Atomic Wallet.', 'Enter the twelve-word backup and optional passphrase.', 'Scan.', 'Treat a fork-era result as replay-sensitive.'],
  },
  {
    id: 'simplycash', name: 'Simply Cash', era: '2018–2020', status: 'Discontinued', support: 'ready',
    summary: 'BIP-39 at the BCH-style 145 path, including receiving and change chains.',
    profiles: [{ id: 'simplycash-standard', label: 'Simply Cash standard', seedFormat: 'bip39', templates: ["m/44'/145'/0'/{change}/{index}"], confidence: 'verified', source: 'https://github.com/simplycash/simplycashwallet/blob/master/src/providers/wallet/wallet.ts', sourceLabel: 'Simply Cash source' }],
    steps: ['Choose Simply Cash.', 'Enter the words and any BIP-39 passphrase.', 'Scan both chains.', 'If the app was an early pre-0.0.61 build and no addresses match, follow the legacy non-compliant derivation guide.'],
    caveat: 'Very early builds used a non-compliant Bitcore child derivation. Passage identifies the exception but does not guess it during an automatic spend.',
  },
  {
    id: 'moneybutton', name: 'Money Button', era: '2018–2023', status: 'Discontinued', support: 'guided',
    summary: 'Historical backups varied; verify an old address before using a candidate path.', profiles: [],
    steps: ['Find the original backup/export and one known receiving address.', 'Use the documented Money Button recovery or a reviewed offline tool.', 'Do not paste an account password—it is not necessarily a seed.', 'Compare the first derived address before moving value.'],
    caveat: 'No current first-party derivation reference was available for a universal automatic profile.',
  },
  {
    id: 'handcash-legacy', name: 'HandCash 1.x', era: '2017–2019', status: 'Legacy product', support: 'guided',
    summary: 'Some early versions exposed a seed; current HandCash accounts do not.', profiles: [],
    steps: ['Confirm this is an early seed-based wallet, not a current HandCash account.', 'Locate an old address and export record.', 'Use a dedicated reviewed legacy recovery flow.', 'Send normally from a current working HandCash account instead of entering credentials here.'],
    caveat: 'Current HandCash uses threshold/keyless account recovery and has no compatible twelve-word wallet seed.',
  },
  {
    id: 'bsv-browser', name: 'BSV Browser / BRC-100 wallets', era: '2024–present', status: 'Active', support: 'guided',
    summary: 'The phrase restores the identity root, but BRC-42 payment keys require wallet metadata—not a BIP-44 address scan.', profiles: [],
    steps: ['Prefer the wallet’s database backup/restore procedure.', 'Restore the same root identity only in a trusted BRC-100 wallet.', 'Preserve certificates, baskets, labels and derivation metadata.', 'Do not expect an address scan to recreate BRC-42 invoice keys.'],
    caveat: 'A seed-only sweep cannot recover certificates, labels, transaction metadata or arbitrary BRC-42 outputs.',
  },
  {
    id: 'userwallet', name: 'UserWallet / Metanet Desktop / Peacock', era: '2023–present', status: 'Active', support: 'guided',
    summary: 'BRC-100 identity-root recovery belongs in the wallet restore flow, not a legacy P2PKH sweep.', profiles: [],
    steps: ['Use the signed wallet application.', 'Restore the root phrase through its recovery flow.', 'Restore or synchronize the wallet database.', 'Use Passage only for separate legacy P2PKH balances.'],
    caveat: 'The root phrase alone may not reconstruct application metadata or every protocol-derived output.',
  },
  {
    id: 'relayx', name: 'RelayX / RelayOne', era: '2019–2023', status: 'Discontinued/changed', support: 'guided',
    summary: 'Export formats and custody modes changed across versions.', profiles: [],
    steps: ['Identify whether you have words, WIF, JSON backup, or only account credentials.', 'Locate one old address.', 'Use a format-specific recovery tool.', 'Never treat a login password as a BIP-39 passphrase without documentation.'],
  },
  {
    id: 'edge-guarda', name: 'Edge / Guarda / multi-asset wallets', era: '2018–present', status: 'Support varies', support: 'guided',
    summary: 'Multi-asset wallets may use app-specific key wrapping, usernames or export formats.', profiles: [],
    steps: ['Use the vendor’s current backup/export documentation first.', 'Export only the BSV private material on an offline machine when supported.', 'Verify candidate addresses.', 'Use ElectrumSVP for reviewed WIF sweeping.'],
  },
  {
    id: 'dotwallet', name: 'DotWallet', era: '2019–present', status: 'Account-based', support: 'not-seed-based',
    summary: 'Use the provider’s authenticated withdrawal/export route; there is no universal BIP-39 sweep.', profiles: [],
    steps: ['Sign in through the official product.', 'Complete its recovery checks.', 'Send BSV to the destination wallet through the normal flow.'],
  },
  {
    id: 'handcash-current', name: 'HandCash (current)', era: '2019–present', status: 'Active keyless recovery', support: 'not-seed-based',
    summary: 'Threshold-signature account; no traditional seed phrase to scan.', profiles: [],
    steps: ['Recover through the official HandCash account process.', 'Use the normal Send flow to move funds.', 'Never enter HandCash login or 2FA credentials into Passage.'],
  },
  {
    id: 'hardware-multisig', name: 'Hardware and multisig wallets', era: 'Any', status: 'Descriptor required', support: 'guided',
    summary: 'Seeds alone are insufficient when policy, cosigners, redeem scripts or device paths are missing.', profiles: [],
    steps: ['Collect the wallet descriptor, derivation paths, quorum and every required cosigner.', 'Restore on a compatible offline system.', 'Verify scripts and a small test transaction.', 'Never reduce a multisig recovery to a guessed single-key sweep.'],
  },
]

export const readyWallets = wallets.filter((wallet) => wallet.support === 'ready')

export function getWallet(id: string): WalletEntry {
  const wallet = wallets.find((entry) => entry.id === id)
  if (!wallet) throw new Error('Unknown wallet profile.')
  return wallet
}

export function getProfile(walletId: string, profileId: string): DerivationProfile {
  const profile = getWallet(walletId).profiles.find((entry) => entry.id === profileId)
  if (!profile) throw new Error('Unknown derivation profile.')
  return profile
}
