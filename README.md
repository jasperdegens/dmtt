# Dead Men Tell Tales (DMTT)

**A dead man's switch for encrypted documents on Hedera + World ID + Ledger + drand.**

Encrypt a memo, arm with a Ledger signature + World proof, check in (as a verified
human) to postpone, go silent and the Hedera network authorizes release — a tlock
capsule is published and the memo becomes decryptable by anyone.

The design's credibility is its honesty: this README states plainly what each party
**can** and, more importantly, **cannot** do, and which residual risks remain. See
[CLAUDE.md](CLAUDE.md) (design source of truth), [PLAN.md](PLAN.md) (build plan),
[docs/CONTRACTS.md](docs/CONTRACTS.md) (frozen interfaces), and
[docs/EVALUATION.md](docs/EVALUATION.md) (sourced rationale, ~35 claims verified
against primary sources).

---

## The four authorities (the heart of the trust model)

No single party can both seal and open a switch. Authority is split four ways, and
each is constrained by what it **cannot** do:

| Authority | Holds | Can do | **Cannot** do |
|---|---|---|---|
| **Ledger device** | the user's Hedera account key, on-device | sign the **arm** funding transfer and the **cancel** transfer — root authority for arm + cancel | leave the device; sign allowances, topic messages, or schedule-deletes (firmware hard-rejects these) |
| **World nullifier** | the user's World App | authorize **postponements** (check-in) as a verified human | be scripted or delegated — that's the product invariant |
| **Agent** (operator key, env var) | prepaid FUNDING | all Hedera ops (file/topic/schedule/fees); publish the capsule + pay the bounty at release | read the memo; forge any authorization; release early |
| **drand quicknet** | — | the time-seal | open a capsule before its drand round |

The split is the product: the agent runs everything but holds none of the secrets;
the human holds both factors but cannot run the infrastructure; drand alone decides
*when* a sealed capsule can open.

---

## Lifecycle (the topic is both identity and audit log)

Each switch is one HCS **topic**; its consensus-ordered messages are the canonical
audit trail and state store ([docs/CONTRACTS.md §4–5](docs/CONTRACTS.md)):

1. **Arm** (both factors) — ① a World proof enrolls a `nullifier` (which becomes part
   of `policyHash`); ② the device signs `CryptoTransfer(Ledger → agent, FUNDING,
   memo="DMTT:ARM:"+policyHash)`. The server mirror-verifies the transfer, creates the
   topic, and posts **`ARMED{policy, policyHash, rungHashes[], storage, armTxId,
   armTime}`**. A ladder of `N=20` tlock capsules (one per future deadline) is minted
   in the browser and handed to the agent; the capsules stay private (see *Rung
   privacy* below).
2. **Check-in (postpone)** — a fresh World proof, bound to a recomputed `signal`,
   advances the live pointer one rung along the fixed grid and reschedules the release.
   Posts **`CHECKIN_VERIFIED{proof, seq, newDeadline, nextRungHash, signal}`**. Only a
   verified human can do this; it cannot be scripted.
3. **Go silent → Release** — if no check-in arrives, the scheduled transaction fires
   unattended at the deadline and posts the minimal **`RELEASE_AUTHORIZED{seq, nonce}`**.
4. **Watcher reaction** — the watcher publishes the now-decryptable capsule as
   **`CAPSULE_PUBLISHED{idx, seq, capsuleB64}`**, pays a best-effort bounty, and posts a
   **`BULLETIN{text}`** public message.
5. **Reveal** (any visitor) — read the capsule from the mirror → tlock-decrypt to
   recover **K** → fetch the ciphertext → AES-256-GCM decrypt → render, all in-browser.
6. **Cancel** (any time before release) — the device signs `CryptoTransfer(Ledger →
   agent, 1 tinybar, memo="DMTT:CANCEL:"+topicId)`. The server mirror-verifies, deletes
   the schedule, shreds the ladder, and posts **`CANCELLED{cancelTxId}`**.

Audit-trail event spine: `ARMED` · `CHECKIN_VERIFIED` · `RELEASE_AUTHORIZED` ·
`CAPSULE_PUBLISHED` · `BULLETIN` · `CANCELLED` (· optional `SERVICE_FEE_PAID`).

---

## Why each sponsor is structural, not bolted-on

- **Hedera** — the **scheduled transaction is the dead-man trigger**: `ScheduleCreate`
  with `waitForExpiry(true)` fires at expiry with no external trigger (verified live;
  see G0 below). HFS/HCS store the ciphertext, the topic is the audit log, and the
  agent makes an **autonomous on-chain payment** (release bounty) — agentic payments
  without a smart contract.
- **World ID** — postponement **requires a verified human**. This is the product
  invariant: a switch you could postpone by script is not a dead man's switch. DMTT
  deliberately does **not** use World AgentKit, because AgentKit exists to *delegate*
  proof-of-human — the one thing this switch must never allow.
- **Ledger** — arm and cancel are **device-signed `CryptoTransfer`s**, with the
  recipient, amount, and policy commitment shown on the Trusted Display. The key is
  root authority and **never leaves the device**. (The Ledger Hedera app cannot sign
  allowances / topic messages / schedule-deletes, so a device-signed memo'd transfer is
  the on-chain equivalent of a signed message — publicly auditable, unforgeable.)
- **drand quicknet** — the **time-lock seal**. Each capsule is `tlock(K, round)` and
  cannot be opened before its drand round arrives. This is the bedrock confidentiality
  assumption: publishing a capsule is an irrevocable commitment to release at its round.

---

## Keys & trust table

What is secret, where it lives, and who holds it ([docs/CONTRACTS.md §10](docs/CONTRACTS.md)):

| Secret | Lives | Held by | Reaches the server? |
|---|---|---|---|
| Ledger account key | on the Ledger device | the user | **never** |
| **K** (AES-256-GCM key) | browser memory, **at arm only** | nobody after arm | **never** — minted into N capsules, then discarded; lost state ⇒ re-arm |
| Plaintext memo | browser only (MemoCard encrypts locally) | the user | **never** — only ciphertext transits the server |
| `WORLD_SIGNING_KEY` (rp_context) | server env (returned once) | the operator | server-only; **never** `NEXT_PUBLIC_*` |
| `HEDERA_OPERATOR_KEY` (agent) | server env | the operator | server-only |
| `ANTHROPIC_API_KEY` | server env | the operator | server-only |
| `nullifier` (public identifier) | the JSON store + `ARMED` event | derived from the user's World ID | public (uint256 decimal string) |

The agent never sees the plaintext, **K**, or the Ledger key. The capsule ladder it
holds is sealed against early reading by drand, and its public `rungHashes[]`
commitment lets anyone verify which rung was released.

---

## Honest residuals (keep these in view — the honesty is the point)

The agent can **never** read the memo early, forge an authorization, or destroy
evidence. The remaining failure modes are stated plainly:

- **delay** — a Byzantine agent could stall a legitimate postpone. **Detectable** via
  signal binding (`signal = hash(nextRungHash ‖ newDeadline ‖ topicId ‖ seq)`, re-enforced
  server-side) and the public audit trail. *Mitigation: rotation / watchtower / couriers
  roadmap.*
- **shirk** — the agent could simply fail to publish the capsule at release.
  *Mitigation: couriers roadmap.*
- **stale-read** — the agent could retain a *burned* (checked-past) rung and decrypt it
  privately once its round passes, reading the forever-public ciphertext. **Bounded**: a
  stale-read is only ever a round that was already an *armed deadline* — never earlier —
  and is detectable via the `ARMED` rung-hash commitment. *Mitigation: rotation /
  watchtower / couriers roadmap.*

Two accepted MVP tradeoffs (also on the trust slide):

- **possession, not permission** — FUNDING moves to the agent at arm, so a Byzantine
  agent could keep unspent funds. *Roadmap: HIP-336 allowance restoration once the
  Ledger firmware can sign allowances.*
- **cancel is honored, not chain-enforced** — the cancel memo is public, so any failure
  to honor it is detectable, but it is not enforced on-chain. *Roadmap: watchtower /
  courier.*

### Rung privacy invariant (why capsules stay private)

Capsules stay **private, agent-held, until release is authorized**. A scheduled
transaction body is public from `ScheduleCreate`, and a published capsule decrypts the
instant its drand round passes *regardless of check-ins* — so putting a capsule in a
scheduled body would let it be copied and would make check-ins postpone nothing. The
scheduled message therefore carries only the minimal `RELEASE_AUTHORIZED{seq, nonce}`;
the watcher publishes exactly the one fired rung as its reaction.

---

## What's verified on testnet (G0)

Phase-1 spikes, run live on testnet 2026-06-12 ([spikes/FINDINGS.md](spikes/FINDINGS.md)):

| Item | Result | Key number / note |
|---|---|---|
| Schedule clock (S2) | PASS | schedule fires **~34 ms after expiry** (the release bound); a deleted schedule never fires; admin-keyless `ScheduleDelete` → `SCHEDULE_IS_IMMUTABLE` |
| HFS seal (S3) | PASS | ≤4 KB single-create fast path is immutable, byte-identical, append-rejected; the create→append→`FileUpdate(empty KeyList)` seal path round-trips byte-identical and rejects post-seal append **and** update |
| tlock (S5) | PASS | quicknet; **armored capsule ≈ 601 B**; pre-round decrypt rejected (seal); post-round byte-identical |
| Mirror-verify (S4) | PASS | both endpoint forms; SUCCESS + Ledger debit + real-memo decode (with null-guard); `account.id` polling form; `/accounts/{id}/transactions` is a 404 |
| World rp_context (S6) | backend | rp_context signed server-side; nonce unique; verify endpoint reachable. (Simulator proof + replay/wrong-signal negatives are human-owned, pending.) |
| Ledger ceremony (S1) | human, pending | the device ceremony; S4 is its on-chain verifier |

**Mirror-verify recipe** (the only way arm/cancel are authorized — no
signature-verification code): fetch the tx and assert all three —
① `result === "SUCCESS"`, ② `base64decode(memo_base64) === expected` (null-guard
`memo_base64` first), ③ a `transfers[]` debit from the Ledger account (`amount < 0`),
which is cryptographic proof the device signed (Hedera requires every debited account
to sign).

**Storage cost note** (measured): HFS is ~1 ℏ/KB flat (shortening expiry does *not*
reduce it), so the ≤4 KB HFS fast path is canonical; ciphertext >4 KB (to ~1 MB scope)
uses a chunked HCS large path (~100× cheaper, mirror-served). See
[docs/CONTRACTS.md §2](docs/CONTRACTS.md).

---

## Build status

- **Phase 2 contracts are frozen** — `lib/types.ts` + [docs/CONTRACTS.md](docs/CONTRACTS.md)
  define the shared interfaces every workstream builds against. Changing them requires a
  human decision.
- **This README is part of the Phase 4 documentation batch** (per [PLAN.md](PLAN.md)),
  written from the design docs.
- **Core application code lands in Phase 3** — `lib/crypto.ts`, `lib/hedera.ts`, the
  executors + store, the watcher, the chat shell, and the UI cards are not yet
  implemented. Nothing here claims the app is built.

---

## Repo layout

```
/app           Next.js single page (/ with ?t=) + api/* (chat, switch/[topicId],
               file/[fileId], world rp_context + verify)
/components     MemoCard, TermsChips, WorldVerifyCard, LedgerSignCard, StatusCard,
               ai-elements/*
/lib            crypto.ts, hedera.ts, world.ts, ledger.ts, store.ts, types.ts
/watcher        index.ts (Node process)
/data           switches/*.json (gitignored — holds the sealed ladders)
/docs           CONTRACTS.md, EVALUATION.md
/spikes         FINDINGS.md (G0 testnet spike results)
```

---

## Toolchain (non-negotiable)

- **pnpm + Node everywhere. No Bun** — `@hiero-ledger/sdk` crashes under Bun's
  `node:http2`. Use `pnpm install`, `pnpm dev`, `node watcher/index.js`.
- **`@hiero-ledger/sdk` is THE Hedera SDK** — never `@hashgraph/sdk` (Agent Kit v4
  peer-deps on hiero; mixing Client instances breaks).
- Stack: Next.js 15 (App Router) · AI SDK v5 + AI Elements ·
  `@hashgraph/hedera-agent-kit@4` + `@hashgraph/hedera-agent-kit-ai-sdk` (watcher only) ·
  `@worldcoin/idkit@^4` · `tlock-js@0.9` · `@ledgerhq/hw-app-hedera@^1.6` +
  `@ledgerhq/hw-transport-webhid`. Local JSON store (no DB).

---

*For the full design rationale and primary-source citations, see
[docs/EVALUATION.md](docs/EVALUATION.md). For the source of truth on every design
decision, see [CLAUDE.md](CLAUDE.md).*
