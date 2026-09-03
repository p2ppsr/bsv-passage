# Recovery Runbook

## Prepare

1. Identify the exact wallet product and approximate version/year.
2. Preserve the original backup offline. Do not photograph, email, message, or issue-track it.
3. Find one public receiving address or transaction from the old wallet when possible.
4. Update and scan a clean device. Disable screen sharing and unnecessary browser extensions.
5. For meaningful value, clone the tagged source, run tests, build locally, and compare the release SHA-256 file.
6. Install/open a trusted BRC-100 wallet and confirm it is on BSV mainnet.

## Discover

1. Choose the exact named profile. For Centbee, the old four-digit PIN is the BIP-39 passphrase.
2. Enter the phrase and optional passphrase. Passage clears the visible values immediately after derivation.
3. Keep the default gap of 20 unless the old wallet created a larger known gap. Scan additional BIP-44 accounts only if used.
4. Passage batches only public addresses, paces each provider below its published unauthenticated request rate, and stops on a long provider cooldown or malformed/partial batch. Waiting and rescanning is safe; never treat a provider error as an empty wallet.
5. Compare at least one result address with an old record.
6. An empty scan is not proof of an empty backup. Recheck profile, passphrase/PIN, language, account and wallet-specific exception.

## Review and pilot

1. Require **Matched indexer UTXOs**, **Clear replay screen**, and **Confirmed source outputs**.
2. Select **Pilot one output**. It migrates the smallest complete UTXO, not an arbitrary fraction.
3. Confirm the amount, network fee, fee rate, transaction shape and expected TXID.
4. Broadcast once.
5. Verify the TXID on an independent explorer and confirm it appears in the target wallet. Wait for confirmation before the remaining balance.
6. Re-enter the backup, rescan current chain state, and migrate the next batch of up to 100 verified inputs.

If the wallet contains one large UTXO, Passage cannot create a genuinely small pilot without also creating source-wallet change. Do not pretend the full UTXO is a small test. Use professional review or the old wallet’s normal send flow first.

## Stop conditions

Stop immediately for:

- a provider mismatch or unavailable provider;
- a pre-split outpoint;
- an unconfirmed outpoint;
- an address that does not match the old wallet;
- unexpected wallet permission or network;
- a fee outside the displayed safety range;
- an unknown broadcast outcome; or
- instructions from a website/person asking you to send the phrase or “verification” payment.

## Close out

1. Confirm every desired outpoint is spent on BSV and the destination wallet controls the received outputs.
2. Preserve the receipt/TXID, not the seed.
3. Keep the old backup until all migrations and metadata/certificate restoration are complete.
4. Clear and close the browser session. For high assurance, shut down the browser process/device.
5. Never reuse the exposed legacy wallet after a successful sweep.
