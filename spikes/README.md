# Phase 1 — Spike block (G0 de-risking probes)

These are **throwaway validation probes**, not product code. Each spike maps to a
row in [PLAN.md](../PLAN.md) Phase 1 and exists to prove one risky assumption on
live infrastructure before the contracts freeze (Phase 2). The reusable bits
(S4 mirror-verify, S5 tlock wrapper) are written cleanly so Phase 3 can lift them
into `lib/`.

## Status matrix (G0 exit needs all green or a locked fallback)

| # | Owner | Spike | Runs without secrets? | How to run |
|---|-------|-------|----------------------|------------|
| S1 | **HUMAN** | WebHID → device-signed `CryptoTransfer` | No — needs Ledger Nano + funded testnet acct | Browser ceremony (see below) |
| S2 | agent | Schedule clock (`waitForExpiry`) | No — needs `HEDERA_OPERATOR_*` | `pnpm spike:schedule` |
| S3 | agent | HFS create→append→seal | No — needs `HEDERA_OPERATOR_*` | `pnpm spike:hfs` |
| S4 | agent | Mirror tx-read helper | **Yes** (public read-only mirror) | `pnpm spike:mirror` |
| S5 | agent | tlock encrypt→wait→decrypt | **Yes** (public drand quicknet) | `pnpm spike:tlock` |
| S6 | **HUMAN** + scaffold | World staging round-trip | No — needs World app + `signing_key` | see `spikes/s6_world/` |

`pnpm spike:all` runs every spike that has its prerequisites; it skips (does not
fail) the ones whose secrets are absent and prints what's missing.

## What each spike proves (pass criteria from PLAN.md)

- **S2** — message lands on topic within seconds of expiry (**records the lag**, the
  M1/M2 release bound); `ScheduleDelete`d schedule never fires; admin-keyless
  schedule rejects delete with `SCHEDULE_IS_IMMUTABLE`.
- **S3** — byte-identical 100 KB round-trip; post-seal `FileAppend` **and**
  `FileUpdate` both rejected; ≤4 KB single-create-immutable fast path also green.
- **S4** — both endpoint forms (`/transactions/{id}` and
  `?account.id=&timestamp=gt:&order=asc`) return the tx; helper asserts
  `SUCCESS` + decoded memo + Ledger-account debit (`amount<0`); null-memo tx
  handled (guard before decode).
- **S5** — exact 32 B key round-trip through tlock; decrypt **before** the round
  fails, **after** the round succeeds; armored capsule size recorded (~600 B).
- **S6** — triple env match (staging action ⟷ IDKit `environment:"staging"` ⟷
  Simulator); verify ×3 → same nullifier; replayed proof REJECTED; wrong-signal
  proof REJECTED.

## S1 — human ceremony (no script; underwrites BOTH arm & cancel)

In Chrome (WebHID is Chromium-only; localhost/HTTPS), with the Ledger Nano
unlocked and the Hedera app open, sign a `CryptoTransfer(Ledger → agent, amount,
memo)`. Confirm the **Trusted Display shows recipient + amount + memo**, then run
`pnpm spike:mirror -- <txId>` (or set `HEDERA_MIRROR_TX_ID`) to confirm the mirror
returns `result==SUCCESS`, a decodable `memo_base64`, and a debit from the Ledger
account (`amount<0`). That single round-trip is S4's real end-to-end assertion.

## Setup

```bash
pnpm install
cp .env.example .env.local   # fill in HEDERA_OPERATOR_* (and World for S6)
```
