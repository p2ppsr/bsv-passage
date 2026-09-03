# Mainnet validation protocol

This protocol validates Passage with real BSV while bounding custody exposure, provider load and monetary cost. It is not an invitation to reuse the fixture or to test with a valuable recovery phrase. Campaign secrets live only in a mode-`0600` file under the private `network-ops/secrets/local` tree and are destroyed after every output is reconciled into the BRC-100 wallet.

## Hard boundaries

- Mainnet fixture exposure: at most 20,000 satoshis for the volume campaign and never more than the separately authorized 200,000-satoshi ceiling.
- Campaign count: exactly 250 recoverable P2PKH transactions, 250 unique target keys and 499 transaction outputs.
- Value: 20-satoshi RockWallet volume outputs, 200-satoshi cross-wallet outputs, and a final recoverable carrier output. A captured BSV/USD price sets a hard cumulative nominal-flow ceiling below USD 2.00.
- Fee: transaction construction uses the live 100 sat/kB mining policy and stops if a generated fee is non-positive or above 100 satoshis.
- Rate: Arcade broadcasts are serialized at no more than two starts per second. Passage keeps WhatsOnChain starts below three per second and Bitails starts below ten per second. `429`, `Retry-After`, transient `5xx`, timeouts, long cooldowns and terminal rejection are explicit states.
- Recovery: the exact signed raw transaction and its BRC-30 extended-format submission are atomically checkpointed before broadcast. An uncertain request resolves that transaction ID first and can only resend identical bytes. A BRC-100 migration with an ambiguous `signAction` result is never retried automatically.
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
| Recovery | restart before broadcast; restart after request/before response; idempotent identical-byte resend; provider cooldown; indexer lag; terminal double-spend/rejection quarantine; prepared-action abort |

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
8. `sweep`
9. `wait-sweeps-confirmed`
10. `verify-empty` independently confirms all eight sweeps mined, all 250 fixture addresses empty, and every campaign transaction completed in BRC-100 action history
11. destroy the secret fixture

Public operational evidence contains transaction IDs, counts, heights, fees, provider results and release revisions—but never phrases, passphrases, private keys, unlocking material or the protected checkpoint.
