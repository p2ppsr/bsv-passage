# Security Policy

## Supported release

Only the current production commit on `master` and its checksum-matched offline artifact are supported. Never enter secret material into a fork, preview deployment, pull-request build, search result, advertisement, or site with a lookalike hostname.

## Report a vulnerability

Open a GitHub security advisory at `p2ppsr/bsv-passage` for code or deployment vulnerabilities. Do not include a real seed phrase, WIF, xprv, passphrase, PIN, signed transaction, unredacted wallet screenshot, private provider credential, or personally identifying wallet history. Use an unfunded generated test vector and public testnet/mainnet fixtures.

For an active key-exposure incident, stop using the affected device and use a separately verified wallet from a clean device. Do not post the backup to an issue or ask a contributor to take custody.

## Security properties

- No seed/passphrase API and no Passage application backend.
- No analytics, third-party script, remote font, wallet-history database, local storage, session storage, service worker, or automatic clipboard access.
- Phrases are cleared from controlled form state immediately after derivation; the derived root remains only in tab memory until success, explicit clear, navigation, or reload.
- Public address discovery requires independent WhatsOnChain and Bitails UTXO agreement.
- BEEF source proofs, exact P2PKH scripts, source values, outpoint set, fee bounds and all-output signatures are checked before wallet broadcast.
- Split-era ambiguity, unconfirmed value, provider disagreement, non-P2PKH script and unknown inputs fail closed.
- An expected TXID is computed before the single broadcast attempt. An ambiguous outcome is locked against retry.
- The app refuses to render the recovery workspace in an iframe.

## Limits

Browser-local does not mean invulnerable. A compromised host, browser, extension, dependency, clipboard, target BRC-100 wallet, DNS/TLS path or served JavaScript can expose a phrase or alter behavior. JavaScript strings cannot be reliably zeroized; closing the tab and browser process is the strongest available memory cleanup. Address queries reveal public-address groupings to both indexers. BRC-42 metadata, multisig descriptors, custom locking scripts and custodial account recovery are outside the automatic sweep envelope.

Read [docs/THREAT-MODEL.md](docs/THREAT-MODEL.md) before a meaningful-value recovery.
