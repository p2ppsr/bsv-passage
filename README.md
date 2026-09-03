# BSV Passage

Bring old keys safely forward.

BSV Passage is a source-available, browser-local recovery planner and guarded migration tool for standard P2PKH funds held by historical Bitcoin SV wallets. It derives supported BIP-39 and native Electrum v2 backups locally, discovers receiving and change addresses, requires matching UTXO sets from WhatsOnChain and Bitails, obtains BEEF source proofs, and lets a connected BRC-100 wallet create the destination output.

The secret words and passphrase are never intentionally transmitted or persisted. Public addresses are necessarily sent to the two discovery providers. Every proposed transaction is separated into prepare and broadcast steps and is rejected if any source script, value, key, outpoint, confirmation, fee, or transaction-shape invariant fails.

## Safety status

This is financial recovery software. It has defense-in-depth controls and deterministic tests, but no software can guarantee that loss is impossible. Use the smallest verified output as a pilot, confirm it independently, and use a reviewed local build for a meaningful balance.

Automatic migration currently covers:

- Centbee BIP-39 plus original PIN;
- RockWallet BIP-39;
- ElectrumSV/ElectrumSVP native Electrum v2 and imported BIP-39 seeds;
- Exodus BSV;
- Coinomi native BSV and BCH-fork derivation paths;
- Atomic Wallet BSV; and
- Simply Cash standards-compliant BIP-39 wallets.

The first-class catalog also explains why BRC-42 wallets, current HandCash, custodial accounts, multisig, hardware policies, early non-compliant Bitcore derivation and undocumented backups need another recovery route. See [compatibility research](docs/COMPATIBILITY.md).

Passage refuses to automatically sign:

- an outpoint created at or before BSV/BCH split height `556767`;
- an unconfirmed output;
- provider-disagreed or changed UTXO data;
- a non-P2PKH source script;
- a transaction with an unexpected, missing or duplicated input;
- a fee outside `1–1000 sat/kB`; or
- more than 100 inputs in one reviewed action.

## Run a reviewed local copy

Requirements: Node.js 22.12+ or 24+ and a BRC-100 wallet reachable by the standard wallet client.

```bash
git clone https://github.com/p2ppsr/bsv-passage.git
cd bsv-passage
npm ci
npm --prefix frontend ci
npm run frontend:test
npm run frontend:build
npm run frontend:dev
```

Open `http://127.0.0.1:8080`. Compare the checkout commit and release checksum before entering a valuable backup. The built static artifact is `frontend/build/` and has no application backend.

## Verification

```bash
npm run frontend:test
npm run frontend:lint
npm run frontend:build
npm audit --audit-level=high
npm --prefix frontend audit --audit-level=high
```

The unit suite covers BIP-39 and Electrum vectors, path integrity, independent indexer agreement, batched gap-limit behavior, rate-limit scheduling and backoff, replay and confirmation gates, selection tampering, input ceilings, source persistence bans, and CSP presence. CI also builds a checksum-addressed offline artifact and deploys only after all gates pass.

## Transaction design

1. The user selects a source-backed wallet profile.
2. The browser validates and derives the seed; the visible phrase/passphrase fields are cleared.
3. Both receiving and change chains are scanned to the configured gap in provider-supported windows of at most 20 public addresses. WhatsOnChain request starts are held below 3 per second and Bitails below 10 per second; transient `429`/`5xx` responses use bounded exponential backoff and honor reasonable `Retry-After` instructions.
4. WhatsOnChain and Bitails must agree exactly on every spendable outpoint and value.
5. The target BRC-100 wallet receives the proven external inputs and creates wallet-owned change.
6. Passage proves each source transaction with BEEF, re-derives each key, verifies exact P2PKH script/value/outpoint inclusion, and signs `SIGHASH_ALL|FORKID` through the SDK P2PKH template.
7. The user reviews the exact source value, destination-output value, fee, fee rate, input/output count and expected TXID.
8. A separate action authorizes the BRC-100 wallet to broadcast once. Passage does not send the transaction to an indexer or a separate broadcaster, and ambiguous outcomes are never automatically retried.

See the full [threat model](docs/THREAT-MODEL.md), [recovery state machine](docs/RECOVERY-RUNBOOK.md), and [security policy](SECURITY.md).

## Liability and authorization

Users must own or be authorized to move every selected output. Users choose the backup, passphrase, profile, providers, BRC-100 wallet and transaction, and accept sole responsibility for title, tax, compliance, replay, key-exposure, device and transaction risks. Peer-to-peer Privacy Systems Research, LLC (P2PPSR), its members, contributors and infrastructure operators do not custody funds, verify title, provide legal/financial/tax advice, or guarantee compatibility or recovery, and disclaim liability to the fullest extent permitted by applicable law. Rights that cannot legally be waived remain unaffected.

Have counsel review product terms and Open BSV License compatibility before operating a modified or commercial recovery service.

## License

[Open BSV License version 4](LICENSE.txt). This is a BSV-use-restricted source license; do not describe it as OSI-approved open source.
