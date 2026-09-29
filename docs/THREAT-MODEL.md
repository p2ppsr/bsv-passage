# Threat Model

## Assets and trust boundary

The protected assets are the legacy recovery phrase/passphrase, derived private keys, the authoritative source-outpoint set, transaction destination, fee, and broadcast outcome. Phrase derivation and P2PKH signing occur inside one browser tab. The target BRC-100 wallet is trusted to create wallet-owned receiving output(s), provide mainnet block headers, persist the resulting action, and broadcast it when the user authorizes `signAction`. Passage does not send the transaction to an indexer or separate broadcaster. WhatsOnChain and Bitails are individually untrusted indexers. CARS serves immutable frontend bytes but never receives secret material through an application endpoint.

## Adversaries considered

| Adversary or failure | Control | Residual risk |
| --- | --- | --- |
| Malicious/lagging/indexer-limited response | Exact two-provider outpoint/value/confirmation-height agreement; strict batch-shape checks; provider-specific pacing; bounded `429`/`5xx` retry with `Retry-After`; source BEEF height and Merkle-root check against the trusted wallet header; script/value recheck | Both providers could collude or share bad upstream state; address linkage is disclosed; an extended provider cooldown stops the scan and requires a later rescan |
| Fork replay | Block outputs created at/before BSV/BCH height 556767 | Later outputs whose ancestry or external handling creates special replay risk require expert review |
| Path confusion | Named, source-linked profiles; BIP-39 checksum; Electrum seed-version check; known-address recommendation | A valid passphrase can derive a different empty wallet; undocumented wallets remain manual |
| Target substitution | BRC-100 wallet constructs receiving outputs; proposal summary and expected TXID shown before broadcast | A compromised wallet can create its own malicious output; user must trust and verify the wallet |
| Transaction mutation | Exact input-set check and SDK P2PKH `all` signature scope | SDK or runtime compromise remains possible |
| Fee theft | Positive integer fee and 1–1000 sat/kB hard bound | An in-range fee can still be uneconomic for tiny inputs |
| Double spend/race | Source wallet must be closed; unconfirmed inputs blocked; no automatic rebroadcast; every earlier labeled Passage action must be `completed` before another proposal | A remote copy of the old wallet can still race; an external mempool spend unknown to the BRC-100 wallet can temporarily evade both indexers |
| Ambiguous network result | Expected TXID before send; one attempt; retry lock with manual reconciliation instructions | User can ignore the warning in another tool |
| Browser memory/extension compromise | No persistence/logging/clipboard; immediate field clear; CSP; iframe refusal; local-build guidance | JavaScript secret zeroization is not guaranteed; extensions and host malware remain powerful |
| Supply-chain/host compromise | Locked dependencies, CI tests/audits, public source, checksummed offline artifact, no third-party runtime scripts | A malicious dependency update or compromised release account may evade review |
| Oversized recovery | 1,200-address scan ceiling and 100-input action ceiling | Specialist recoveries must be split into reviewed batches |

## Security invariants

The migration engine will not return a broadcast-ready proposal unless all of the following are true:

1. The seed format validation succeeded.
2. Every selected outpoint is part of the current scan report exactly once.
3. Both indexers reported the same outpoint, satoshi value and confirmation height set.
4. Every selected output is confirmed and was created after split height 556767.
5. BRC-100 action history contains no earlier labeled Passage action whose status is not `completed`.
6. Atomic BEEF supplies each source transaction and a Merkle path at the agreed post-split height, whose root matches the trusted mainnet wallet's 80-byte header for that height. Missing or unavailable headers block preparation.
7. Each source output’s script equals `P2PKH(derived address)` and its value equals the scan.
8. The target wallet did not add an unaccounted input.
9. Every verified source input appears exactly once, every transaction output is positive, and fee is positive.
10. Fee rate lies within the hard bound.
11. Every source signature commits to all outputs without `ANYONECANPAY`.

Any failure attempts to abort the proposed BRC-100 action where an action reference already exists. Only `aborted: true` confirms release. A refusal or transport failure preserves the action reference, original error, and expected signed TXID when available; the UI blocks a new proposal until release succeeds. Header checks inherit the receiving wallet's mainnet chain-tracking trust; Passage is not an independent full node.

## Recovery from interruption

- Before prepare: clear/reload and scan again.
- Prepared but not broadcast: choose **Cancel proposal**. The review stays visible until the BRC-100 wallet explicitly confirms release; subsequent proposals require fresh broadcast consent. In-app navigation is disabled during work, review and unresolved cleanup. Closing/reloading the tab is not a confirmed cancellation; use the wallet action history to reconcile interruptions.
- Wallet submission returned the expected TXID: treat it as unproven, verify at least one confirmation independently, and wait for the BRC-100 action to become `completed` before scanning or preparing another batch or overlapping profile.
- Broadcast threw or returned an unexpected/missing TXID: do not click broadcast again and do not create a replacement transaction. Check the precomputed TXID, every source outpoint, and BRC-100 action history. Only rescan after the chain state is unambiguous.
- Failed preparation with unsuccessful cleanup: retain the displayed reference/TXID and use **Retry releasing action**. Do not replace the action while its state is unresolved.
- Provider disagreement: wait and rescan; if persistent, compare a third reviewed source manually.
- Pre-split output: use a reviewed chain-splitting procedure with a demonstrably BSV-only anchor before returning to Passage.

## Explicit non-goals

Passage does not recover forgotten words, crack passphrases, handle BIP-38/WIF, reconstruct BRC-42 invoice metadata, spend STAS/custom scripts, infer multisig policy, withdraw custodial accounts, or automatically split BCH/BSV replayable coins. ElectrumSVP remains the better reviewed route for WIF/BIP-38 sweeping.
