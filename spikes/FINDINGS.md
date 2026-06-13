# G0 — spike findings (testnet, 2026-06-12)

The observed-lags + decisions record the PLAN requires at G0 exit. Fold the
"corrections" into CLAUDE.md when the gate closes.

## Results

| # | Result | Key number / note |
|---|--------|-------------------|
| S2 schedule clock | ✅ PASS | **schedule fires ~34 ms after expiry** → the M1/M2 release bound. Deleted schedule never fired. Admin-keyless `ScheduleDelete` → `SCHEDULE_IS_IMMUTABLE`. |
| S3 HFS | ✅ PASS | Fast path (≤4 KB single create) **immutable + byte-identical + append-rejected**. Seal path: create→append(chunked)→**`FileUpdate(empty KeyList)`** seal → byte-identical pre/post → post-seal append **and** update both rejected (`UNAUTHORIZED`). |
| S4 mirror helper | ✅ PASS | Both endpoint forms, SUCCESS+debit, real-memo decode, **null-guard**, `account.id` polling form, `/accounts/{id}/transactions` 404. |
| S5 tlock | ✅ PASS | quicknet · **armored capsule 601 B** · pre-round decrypt rejected (seal) · post-round byte-identical. |
| S6 World | ✅ backend | rp_context signed server-side · nonce unique · verify endpoint reachable. Simulator flow (proof + replay/wrong-signal negatives) = human, pending. |
| S1 Ledger | ⏳ human | Device ceremony; S4 is its on-chain verifier. |

## Hedera fee profile (drives FUNDING sizing)

Measured from 0.0.9218794 on testnet:

| tx | avg ℏ | implication |
|----|------:|-------------|
| FILEAPPEND (4 KB chunk) | **4.36** | the >4 KB path is expensive: ~100 KB ≈ **~100 ℏ** |
| FILECREATE | 2.08 | ≤4 KB fast path is one cheap create |
| SCHEDULECREATE | 0.13 | the check-in / reschedule loop is **cheap** |
| CONSENSUSCREATETOPIC | 0.26 | once per switch |
| SCHEDULEDELETE | 0.013 | |
| CONSENSUSSUBMITMESSAGE | 0.002 | events are ~free |
| CRYPTOTRANSFER | 0.0013 | arm/cancel transfers are ~free |

**FUNDING implications:** (1) prefer the **≤4 KB single-create fast path** — one immutable
`FileCreate` (~2 ℏ), no appends; (2) the schedule clock + event trail are economically trivial,
so per-check-in rescheduling is fine.

### Storage cost — measured (`probe_storage_cost.mjs`, funded account)

| medium | cost | note |
|--------|------|------|
| HFS create/append | **~1 ℏ / KB** | ~flat per byte. **Expiration does NOT reduce it** — a 2 KB file cost **2.09 ℏ at 1-day** expiry vs ~2 ℏ at 90-day (the rent-∝-duration theory is **disproven**). 100 KB ≈ ~100 ℏ; 1 MB ≈ ~1000 ℏ (impractical). |
| HCS topic message | **~0.01 ℏ / KB** + 0.26 ℏ one-time topic | pay-per-message, no storage rent (mirror retains history). **~100× cheaper**, and reveal can read it from the mirror directly (no `FileContentsQuery` proxy). |

**The lever that works is HCS, not expiration.** Small memos → HFS fast path is fine and
canonical. Large docs → HFS is impractical (~1 ℏ/KB) → store ciphertext in HCS. Adopting HCS for
ciphertext **changes C2** (a researched decision) → a Phase 2 freeze call, not a silent swap.

## Corrections to fold into CLAUDE.md / CONTRACTS

- **tlock:** the time→round helper is **`roundAt(ms, chainInfo)`**, not `roundForTime`; and
  `tlock-js@0.9` `mainnetClient()` already targets **quicknet** (`52db9ba…`, period 3 s).
- **World verify:** `POST /api/v4/verify/{rp_id}` requires **`action`** in the body alongside
  the proof (live `400 "action is required for uniqueness proofs"`). "Forward as-is" = proof
  fields unchanged **plus** top-level `action`/`signal`.
- **Hedera keys:** a raw-hex private key is ambiguous ECDSA/ED25519; `fromStringDer` will
  mis-parse it (→ `INVALID_SIGNATURE`). Disambiguate explicitly — testnet faucet accounts are
  **ECDSA_SECP256K1**.
- **SDK:** `FileCreateTransaction.setKeys()` takes an **array** (`[publicKey]`); empty `KeyList`
  for immutable.

## To fully close G0

- Operator funded: **0.0.9219464 (1000 ℏ)** — S2 / S3 / S6-backend / probe all green on it.
  (The old 0.0.9218794 was drained to ~0 by the 100 KB fee test.)
- **S1** Ledger device ceremony + **S6** Simulator flow — human-owned.
- Re-run S4 with `HEDERA_MIRROR_TX_ID` = S1's tx for the real Ledger-debit assertion.
- **Phase 2 freeze decision:** HFS fast-path vs HCS for ciphertext storage (cost table above).
