# Historical Wallet Compatibility Research

Reviewed 2026-09-03. A “scan ready” profile means a primary source or inspectable wallet implementation establishes a standard seed/path. It does not certify the old wallet, indexer, target wallet or user device. A guided route is intentional: undocumented guessing is not a production safety feature.

| Wallet family | Backup architecture | Passage route | Evidence / reason |
| --- | --- | --- | --- |
| Centbee | BIP-39; original four-digit PIN used as BIP-39 passphrase; `m/44'/0/{0,1}/n` | Scan ready | [Centbee recovery implementation](https://github.com/HandCash/centbee-recovery) |
| RockWallet | BIP-39/BIP-32; documented first BSV address `m/0'/0/0` | Scan ready; receiving/change | [RockWallet path guide](https://help.rockwallet.com/what-derivation-paths-does-rockwallet-use) |
| ElectrumSV / ElectrumSVP native | Electrum v2 seed → PBKDF2-HMAC-SHA512; `m/{0,1}/n` | Scan ready | [ElectrumSV source](https://github.com/electrumsv/electrumsv), [release notes](https://github.com/electrumsv/electrumsv/blob/releases/1.3/RELEASE-NOTES), [ElectrumSVP](https://github.com/TruthMachine/ElectrumSVP) |
| ElectrumSV BIP-39 import | BIP-39/BIP-44 coin types 0, 145 or 236 | Scan ready across all three | [ElectrumSV release notes](https://github.com/electrumsv/electrumsv/blob/releases/1.3/RELEASE-NOTES) |
| Exodus | BIP-39; `m/44'/236'/account'/{0,1}/n` | Scan ready | [Exodus derivation paths](https://www.exodus.com/support/en/articles/8598933-derivation-paths-in-exodus) |
| Coinomi native BSV | BIP-39; `m/44'/236'/account'/{0,1}/n` | Scan ready | [Coinomi delisting guidance](https://coinomi.freshdesk.com/support/solutions/articles/29000032982-i-have-a-coin-that-is-being-or-has-been-delisted-what-should-i-do-) |
| Coinomi BCH-fork BSV | BIP-39 BCH coin type 145 | Scan ready, but pre-split outpoint signing blocked | [Coinomi splitter guidance](https://coinomi.freshdesk.com/support/solutions/articles/29000026274-bch-abc-bsv-fork-information-splitter-tool) |
| Atomic Wallet | BIP-39; BSV documented at `m/44'/145'/0'/0/0` | Scan ready | [Atomic derivation paths](https://support.atomicwallet.io/article/146-list-of-derivation-paths) |
| Simply Cash | BIP-39; standard `m/44'/145'/0'/{0,1}/n` | Scan ready for compliant releases | [Simply Cash wallet source](https://github.com/simplycash/simplycashwallet/blob/master/src/providers/wallet/wallet.ts) |
| Simply Cash early releases | Bitcore non-compliant child derivation compatibility mode | Guided specialist route | Source contains explicit compliant/non-compliant modes; automatic ambiguity is unsafe |
| Money Button | Backup/export changed over product lifetime | Guided with known-address verification | No current first-party universal derivation contract found |
| HandCash 1.x | Some early seed-based releases | Guided legacy route | Version-specific; require old address/export evidence |
| HandCash current | Keyless threshold account recovery | Official account recovery and normal send | [HandCash support](https://handcash.io/support) describes current account product; no BIP-39 sweep |
| BSV Browser / BRC-157 identity root | BIP-39 entropy to identity root `m/0'/0'` | Restore wallet/database, not P2PKH scan | [BSV Browser support](https://mobile.bsvb.tech/support.html), [BRC-157](https://brc.bsvb.net/brc/157) |
| UserWallet / Metanet Desktop / Peacock | BRC-100 identity root plus wallet storage metadata | Native root/database restore | Address scanning cannot reconstruct arbitrary BRC-42 invoices, certificates, labels or baskets |
| RelayX / RelayOne | Version-dependent export/custody | Guided export route | Require exact version and backup type |
| DotWallet | Account/custodial workflow | Official authenticated withdrawal | No universal seed contract |
| Edge | Application-managed multi-asset backup | Vendor export then verified WIF/seed route | Account backup is not assumed to be raw BIP-39 |
| Guarda | Multi-asset mnemonic/export varies by product | Vendor export then verified route | Require current vendor documentation and known address |
| Bitpie | Multi-asset seed/export varies by release | Guided | Require exact release and known address |
| Hivr, CashPay, Pixel, Hodler Tech, Lastpurse, iPayYou, SV Pay | Historical mobile/web products | Guided archival research | No maintained first-party universal derivation contract found |
| Chainbow, Tique, Volt, ShowPay/Showmoney | Historical BSV wallets | Guided archival research | Validate exact backup type and known address before any spend |
| Yours, Twetch, Panda, Sensilet | Browser/app identity and signing products | Vendor-specific export/restore | Login, app key and seed semantics differ; do not guess |
| Oyo.cash, Oxis, Zumo | Multi-asset or account products | Vendor recovery/withdrawal | No universal BSV BIP-39 path established |
| Tokenized wallets | Wallet plus token/custom-script state | Native application restore | A P2PKH sweep must not spend token/custom scripts |
| Keevo, Ellipal and other hardware wallets | Device seed plus derivation/policy/device behavior | Compatible hardware restore | Preserve device path, passphrase and descriptor |
| Multisig wallets | Multiple seeds plus redeem/witness policy | Original quorum/descriptor restore | One phrase is insufficient and automatic single-key guessing is unsafe |
| Loose WIF / BIP-38 | Individual private key, not a seed tree | ElectrumSVP sweep | [ElectrumSVP releases](https://github.com/TruthMachine/ElectrumSVP/releases) support reviewed WIF/BIP-38 sweeping |

## Standards and destination mechanics

- [BIP-32](https://bitcoin.org/bip/32/) defines hierarchical deterministic key derivation.
- [BIP-39](https://bitcoin.org/bip/39/) defines mnemonic-to-seed conversion; the passphrase is semantically significant.
- [BIP-44](https://github.com/bitcoin/bips/blob/master/bip-0044.mediawiki) defines purpose/coin/account/change/index layout. BSV’s registered coin type is 236, but fork history explains use of 0 and 145.
- [BRC-100](https://brc.dev/100) defines the wallet interface. Passage supplies proven external inputs to `createAction`, signs only the verified legacy inputs, and completes through `signAction`.
- [WhatsOnChain address API](https://docs.whatsonchain.com/address) and [Bitails API](https://docs.bitails.io/) supply independent public-address discovery. Passage does not treat either as authoritative alone.

## Research maintenance rule

A new automatic profile needs: a primary implementation/specification, exact seed format, exact hardened/non-hardened path, both receiving/change behavior, passphrase semantics, deterministic vectors, a known-address fixture, and replay/custom-script analysis. Marketing pages and third-party path lists are leads, not sufficient release evidence.
