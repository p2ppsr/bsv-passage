# Mainnet validation protocol

This protocol validates Passage with real BSV while bounding custody exposure, provider load and monetary cost. It is not an invitation to reuse the fixture or to test with a valuable recovery phrase. Campaign secrets live only in a mode-`0600` file under the private `network-ops/secrets/local` tree and are destroyed after every output is reconciled into the BRC-100 wallet.

## Hard boundaries

- Mainnet fixture exposure: at most 20,000 satoshis for the volume campaign and never more than the separately authorized 200,000-satoshi ceiling.
- Campaign count: exactly 250 recoverable P2PKH transactions, 250 unique target keys and 499 transaction outputs.
- Value: 20-satoshi RockWallet volume outputs, 200-satoshi cross-wallet outputs, and a final recoverable carrier output. A captured BSV/USD price sets a hard cumulative nominal-flow ceiling below USD 2.00.
- Fee: linked-chain construction uses the live 100 sat/kB policy and stops if one of those tiny transactions has a non-positive fee or a fee above 100 satoshis. BRC-100 sweeps use the wallet's proposed policy and remain locked unless the measured rate is within Passage's 1–1,000 sat/kB bound.
- Rate: Arcade broadcasts are serialized at no more than two starts per second. Passage keeps WhatsOnChain starts below three per second and Bitails starts below ten per second. `429`, `Retry-After`, transient `5xx`, temporarily malformed HTTP-200 payloads, timeouts, long cooldowns and terminal rejection are explicit states.
- Recovery: the exact signed raw transaction and its BRC-30 extended-format submission are atomically checkpointed before broadcast. An uncertain request resolves that transaction ID first and can only resend identical bytes. A BRC-100 migration with an ambiguous `signAction` result is never retried automatically. A new migration is refused until every earlier labeled Passage action is `completed`.
- A definite pre-propagation ARC format rejection may be revalidated with source data using ARC's documented `X-ForceValidation` control. Every other terminal rejection remains quarantined.

## Live wallet matrix

All automatic profiles are funded and scanned. Shared derivation paths intentionally prove interoperability across the products that used them.

| Product/profile | Seed fixture | Mainnet coverage |
|---|---|---|
| Centbee | BIP-39 plus four-digit PIN/passphrase | receiving, change, ordinary indices, index 25 beyond the default gap |
| RockWallet | BIP-39 | 221 consecutive receiving keys and 221 UTXOs; three bounded migration batches |
| ElectrumSV native | standard Electrum v2 | receiving, change and index 25 |
| ElectrumSV imported | BIP-39 | coin types 0, 145 and 236, receiving and change |
| Exodus | BIP-39 | coin type 236, accounts 0–2, receiving and change |
| Coinomi native | BIP-39 | coin type 236, accounts 0–2, receiving and change |
| Coinomi BCH-fork | BIP-39 | coin type 145, accounts 0–2, receiving and change |
| Atomic Wallet | BIP-39 | coin type 145, account 0, receiving and change |
| Simply Cash compliant releases | BIP-39 | coin type 145, account 0, receiving and change |

Guided and non-seed products are validation boundaries, not guessed paths: Money Button, HandCash 1.x, BRC-100 wallet roots, UserWallet/Metanet Desktop/Peacock, RelayX/RelayOne, Edge/Guarda, DotWallet, current HandCash, hardware wallets and multisig. Their first-class guides must direct users to vendor restore, metadata/database recovery, WIF sweep or descriptor/cosigner recovery as appropriate.

## Edge and failure matrix

| Class | Required assertion |
|---|---|
| Seed parsing | valid 12/15/18/21/24-word BIP-39; every supported language; Unicode NFKD; passphrase; wrong checksum; wrong PIN empty-wallet warning; standard Electrum v2; Electrum SegWit/2FA/v1 rejection |
| Derivation | receiving/change; hardened/non-hardened components; accounts 0–19; gap 5/20/30/100; used address resets gap; high-index address is missed below its real gap and found at the sufficient gap |
| Provider | unordered batches; missing/duplicate/malformed rows; empty bulk UTXO omission; invalid outpoints; UTXO disagreement; activity disagreement; `401`; `404`; `429`; `Retry-After` seconds/date; timeout; `5xx`; cancellation |
| Source safety | unconfirmed output blocked; pre-BSV/BCH-split output blocked; changed value/script/address/path blocked; duplicate/unknown input blocked; missing BEEF blocked |
| Transaction | 1, 99, 100 and 101+ available inputs; no action exceeds 100 selected inputs; positive outputs; exact source/output totals; 1–1,000 sat/kB fee bound; exact expected txid |
| Wallet | unauthenticated and wrong-network rejection; create/abort/sign lifecycle; unexpected wallet input/output/value/txid rejection; delayed broadcast disabled; unknown result locks retry |
| Mainnet | canary funding; 250 linked broadcasts; 499 outputs; 250 independently matched UTXOs; all nine scan profiles; multi-batch BRC-100 sweeps; final zero legacy balance and completed wallet receipts |
| Recovery | restart before broadcast; restart after request/before response; idempotent identical-byte resend; provider cooldown; indexer lag; shared stale mempool view across overlapping profiles; terminal double-spend/rejection quarantine; one-action confirmation barrier; prepared-action abort |

The unit suite carries deterministic error injection. The live campaign exercises only compliant request rates; it does not intentionally deny service or exceed a provider’s published ceiling merely to provoke an error.

## Operator commands

The guarded harness is `frontend/scripts/mainnet-campaign.ts`. Every mutating command requires both `--execute` and the exact `PASSAGE_MAINNET_CAMPAIGN_ACK` value shown by its help output. It refuses state outside a `secrets/local` path, refuses an unexpected transaction count, verifies mainnet, checks every wallet/Arcade-returned transaction ID, and keeps an atomic checkpoint.

Sequence:

1. `init`
2. `wallet-fund`
3. `wait-confirmed`
4. `broadcast-chain --limit 1`, then continue in bounded canary phases only after reconciling the prior phase
5. `wait-confirmed`
6. `reconcile-chain`
7. `scan-matrix`
8. `sweep` prepares at most one action
9. `wait-sweeps-confirmed`; repeat steps 8–9 only after every accepted action is mined
10. `verify-empty` independently confirms all eight sweeps mined, all 250 fixture addresses empty, and every campaign transaction completed in BRC-100 action history
11. destroy the secret fixture

Public operational evidence contains transaction IDs, counts, heights, fees, provider results and release revisions—but never phrases, passphrases, private keys, unlocking material or the protected checkpoint.

## Executed mainnet record

The authorized campaign ran on 2026-09-03/04 with a USD 15.73/BSV price snapshot, a 20,000-satoshi fixture and a 200,000-satoshi hard exposure ceiling.

- Funding transaction [`ef2d65a7…d78b5`](https://whatsonchain.com/tx/ef2d65a7e00d3d7de6840b4d4643c406c7a45c155e3431f91cd440546d0d78b5) mined at height 965192.
- The first linked transaction [`1806c14c…42687`](https://whatsonchain.com/tx/1806c14c2822609e944c2bd0a0b57e9b69509e2d922f14f615cc1e9354142687) mined at height 965196 and the 250th [`2c09794d…6f06f`](https://whatsonchain.com/tx/2c09794d5efa1cc3c441e9f0e3f7e3cd219cef26b868395f5ae571e0e446f06f) at height 965197.
- Reconciliation found 250/250 transactions mined, 250 unique target keys, 499 outputs, and exact UTXO agreement for every target. Linked-chain fees were 5,747 sats. Cumulative linked-chain source flow was 3,597,578 sats, or USD 0.565899 at the captured price.
- The first raw canary submission received a definite pre-propagation extended-format rejection. The checkpoint retained the exact txid and raw bytes; the documented `X-ForceValidation` recovery resubmitted the identical transaction with source data and it mined. A later transient fetch failure also exited without changing or duplicating state.

All nine automatic profile scans matched:

| Profile | Found/expected outputs | Addresses checked | Satoshis | Provider result |
|---|---:|---:|---:|---|
| Centbee PIN | 6/6 | 88 | 1,200 | exact |
| RockWallet | 221/221 | 261 | 8,453 | exact |
| Electrum native | 6/6 | 88 | 1,200 | exact |
| Electrum imported BIP-39 | 9/9 | 129 | 1,800 | exact |
| Exodus | 7/7 | 127 | 1,400 | exact |
| Coinomi native | 7/7 | 127 | 1,400 | exact |
| Coinomi BCH-fork | 7/7 | 127 | 1,400 | exact |
| Atomic Wallet | 3/3 | 43 | 600 | exact |
| Simply Cash | 3/3 | 43 | 600 | exact |

Eight successful BRC-100 wallet sweeps consumed exactly 250 inputs and 14,253 sats:

| Route | Inputs | Source sats | Fee sats | Height | Transaction |
|---|---:|---:|---:|---:|---|
| RockWallet batch 1 | 100 | 2,000 | 1,498 | 965198 | [`14269baa…94f5`](https://whatsonchain.com/tx/14269baa9d7ea0f7680e2c6b2ffaa85a42cf1bd0090e2d2aaf8a3d2842ae94f5) |
| RockWallet batch 2 | 100 | 2,000 | 1,498 | 965200 | [`c42bda9a…d3d4`](https://whatsonchain.com/tx/c42bda9a7cb3caf76b30c9fb9aaf521690053cb37f3c0ca1ddf2a0674cf7d3d4) |
| RockWallet final | 21 | 4,453 | 321 | 965202 | [`071a7f46…08a9`](https://whatsonchain.com/tx/071a7f4603fa00156883a0a72dd71dcbaf268d5e542aa25dccaa9a96197708a9) |
| Centbee PIN | 6 | 1,200 | 98 | 965202 | [`faa2409e…7177`](https://whatsonchain.com/tx/faa2409e63dc6259d2075eba6d21faf0cb4fd504f5eb3145656d06ab6e447177) |
| Electrum native | 6 | 1,200 | 98 | 965202 | [`51090bc9…6189`](https://whatsonchain.com/tx/51090bc999df6928c6a14a10e31658069228bfa82157bdc2b1b62c6097086189) |
| Electrum imported account 0 | 9 | 1,800 | 142 | 965202 | [`c2d1bffd…f238`](https://whatsonchain.com/tx/c2d1bffd3e36443c35016dc176ec9ce313e2d665ecd53a570d13905a8fcbf238) |
| Coinomi fork accounts 1–2 | 4 | 800 | 68 | 965205 | [`80677cbf…7b64`](https://whatsonchain.com/tx/80677cbf6b7948c8b44312ecf0aa7dff079410c4cea3a7ba0dec09b12b617b64) |
| Coinomi native accounts 1–2 | 4 | 800 | 68 | 965208 | [`ede51cdb…6b57`](https://whatsonchain.com/tx/ede51cdbbaef4f02144dc2b94c13eac852938f87e494b09e339365c9155d6b57) |

Sweep fees totaled 3,791 sats and chain-plus-sweep fees totaled 9,538 sats. The eight receiving actions therefore placed 10,462 sats into wallet-owned outputs.

The live campaign exposed a shared-staleness edge case: after the imported-Electrum action propagated, both indexers still reported three overlapping account-zero outputs. Two seven-input Coinomi proposals were terminally rejected by ARC with `UTXO_SPENT`; neither paid a mining fee nor appeared as a completed BRC-100 action. The campaign quarantined both txids, waited for the winning action to mine, rescanned, and produced the correct four-input replacements above. Production commit `7203003303095bec650b8774dffbc269a95bc210` now requires all prior labeled BRC-100 actions to be `completed` before preparing another migration, and the operator harness permits one accepted action per confirmation barrier.

Final verification completed at 2026-09-04T01:17:15.074Z:

- ARC: 8/8 successful sweep txids `MINED`.
- WhatsOnChain plus Bitails: 250/250 legacy target addresses independently empty.
- BRC-100 wallet: 8/8 expected action txids matched with status `completed`.
- Secret checkpoint: no pending chain transaction or pending sweep action.

This is evidence for the tested fixtures and network state, not a guarantee that every backup, device, provider, wallet implementation or future chain condition is risk-free.
