# Threat Model

## Assets and trust boundary

The protected assets are the legacy recovery phrase/passphrase, derived private keys, the authoritative source-outpoint set, transaction destination, fee, and broadcast outcome. Phrase derivation and P2PKH signing occur inside one browser tab. The target BRC-100 wallet is trusted to create wallet-owned receiving output(s), persist the resulting action, and broadcast it when the user authorizes `signAction`. Passage does not send the transaction to an indexer or separate broadcaster. WhatsOnChain and Bitails are individually untrusted indexers. CARS serves immutable frontend bytes but never receives secret material through an application endpoint.

## Adversaries considered

| Adversary or failure | Control | Residual risk |
| --- | --- | --- |
| Malicious/lagging/indexer-limited response | Exact two-provider outpoint/value agreement; strict batch-shape checks; provider-specific pacing; bounded `429`/`5xx` retry with `Retry-After`; source BEEF and script/value recheck | Both providers could collude or share bad upstream state; address linkage is disclosed; an extended provider cooldown stops the scan and requires a later rescan |
| Fork replay | Block outputs created at/before BSV/BCH height 556767 | Later outputs whose ancestry or external handling creates special replay risk require expert review |
| Path confusion | Named, source-linked profiles; BIP-39 checksum; Electrum seed-version check; known-address recommendation | A valid passphrase can derive a different empty wallet; undocumented wallets remain manual |
| Target substitution | BRC-100 wallet constructs receiving outputs; proposal summary and expected TXID shown before broadcast | A compromised wallet can create its own malicious output; user must trust and verify the wallet |
| Transaction mutation | Exact input-set check and SDK P2PKH `all` signature scope | SDK or runtime compromise remains possible |
| Fee theft | Positive integer fee and 1–1000 sat/kB hard bound | An in-range fee can still be uneconomic for tiny inputs |
| Double spend/race | Source wallet must be closed; unconfirmed inputs blocked; no automatic rebroadcast | A remote copy of the old wallet can still race |
| Ambiguous network result | Expected TXID before send; one attempt; retry lock with manual reconciliation instructions | User can ignore the warning in another tool |
| Browser memory/extension compromise | No persistence/logging/clipboard; immediate field clear; CSP; iframe refusal; local-build guidance | JavaScript secret zeroization is not guaranteed; extensions and host malware remain powerful |
| Supply-chain/host compromise | Locked dependencies, CI tests/audits, public source, checksummed offline artifact, no third-party runtime scripts | A malicious dependency update or compromised release account may evade review |
| Oversized recovery | 1,200-address scan ceiling and 100-input action ceiling | Specialist recoveries must be split into reviewed batches |

## Security invariants

The migration engine will not return a broadcast-ready proposal unless all of the following are true:

1. The seed format validation succeeded.
2. Every selected outpoint is part of the current scan report exactly once.
3. Both indexers reported the same outpoint and satoshi value set.
4. Every selected output is confirmed and was created after split height 556767.
5. Atomic BEEF supplies each source transaction.
6. Each source output’s script equals `P2PKH(derived address)` and its value equals the scan.
7. The target wallet did not add an unaccounted input.
8. Every verified source input appears exactly once, every transaction output is positive, and fee is positive.
9. Fee rate lies within the hard bound.
10. Every source signature commits to all outputs without `ANYONECANPAY`.

Any failure aborts the proposed BRC-100 action where an action reference already exists.

## Recovery from interruption

- Before prepare: clear/reload and scan again.
- Prepared but not broadcast: choose **Cancel proposal** so the BRC-100 wallet releases the action. SPA navigation also makes a best-effort abort.
- Broadcast reported success: verify the TXID independently and confirm the BRC-100 balance.
- Broadcast threw or returned an unexpected/missing TXID: do not click broadcast again and do not create a replacement transaction. Check the precomputed TXID, every source outpoint, and BRC-100 action history. Only rescan after the chain state is unambiguous.
- Provider disagreement: wait and rescan; if persistent, compare a third reviewed source manually.
- Pre-split output: use a reviewed chain-splitting procedure with a demonstrably BSV-only anchor before returning to Passage.

## Explicit non-goals

Passage does not recover forgotten words, crack passphrases, handle BIP-38/WIF, reconstruct BRC-42 invoice metadata, spend STAS/custom scripts, infer multisig policy, withdraw custodial accounts, or automatically split BCH/BSV replayable coins. ElectrumSVP remains the better reviewed route for WIF/BIP-38 sweeping.
