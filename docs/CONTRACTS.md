# DMTT — Frozen Contracts (Phase 2)

The interface every workstream shares. After this freeze, the wave-1 workstreams
(WS-A…F) run independently against **mocks of these contracts**; they touch only
what they own and never each other's internals. **Changing anything here — or in
[`lib/types.ts`](../lib/types.ts) — requires a human decision** (CLAUDE.md
"Definition of done").

- **Shapes** are normative in [`lib/types.ts`](../lib/types.ts). This document is
  normative for everything types can't express: **algorithms** (hashing/canonical
  encoding), **lifecycle/state transitions**, the **freeze decisions**, and the
  **mirror-verify recipe**.
- **Fixtures** in [`lib/fixtures.ts`](../lib/fixtures.ts) carry one value per
  contract and the real **cross-check vectors** (`POLICY_HASH_VECTOR`,
  `SIGNAL_VECTOR`, …) that WS-A must reproduce.
- **Verify:** `pnpm typecheck` (≡ `tsc --noEmit`) is clean; every fixture compiles;
  negative-path memo/parse fixtures hold. Design anchors (C1, C2, N1, N10) are
  settled in [CLAUDE.md](../CLAUDE.md) / [docs/EVALUATION.md](EVALUATION.md) — not
  re-litigated here.

---

## 0. The four authorities (recap)

| Authority | Holds | Can do | Cannot do |
|---|---|---|---|
| **Ledger device** | user's Hedera key | sign the **arm** funding transfer + the **cancel** transfer | leave the device; sign allowances / topic msgs / schedule-deletes |
| **World nullifier** | user's World App | authorize **postponements** (check-in) | be scripted/delegated (product invariant) |
| **Agent** (operator key) | prepaid FUNDING | all Hedera ops; publish capsule + pay bounty at release | read the memo; forge any authorization; release early |
| **drand quicknet** | — | the time-seal | open a capsule before its round |

---

## 1. Core domain — `Switch` / `Policy` / `Terms` / `LadderRung` / `StorageRef`

A **Switch** is one armed dead-man's switch, persisted at
`data/switches/{topicId}.json` (gitignored — it holds the agent-held ladder
capsules). Its HCS **topic** is both its identity and its audit log. Public
callers receive a **`SwitchView`**, never the `Switch` (which carries un-fired
capsules — see §9, N10).

| Type | Field | Meaning |
|---|---|---|
| `Terms` | `intervalSec` | postpone cadence; rung *i* targets `armTime + i·intervalSec` |
| | `n` | ladder length *N* (rungs `1..N`); default `LADDER_N = 20` |
| | `fundingHbar` | FUNDING moved Ledger→agent at arm (ops budget + bounty), ℏ |
| | `bulletin` | public message seeded into the release `BULLETIN` |
| `Policy` | `terms` | the `Terms` above |
| | `nullifier` | World human enrolled at arm (uint256 **decimal** string) |
| | `ciphertextHash` | `sha256(ciphertext)` hex — binds policy ↔ stored ciphertext |
| | `nonce` | 32 random bytes (hex); makes `policyHash` unguessable |
| `LadderRung` | `idx` | `1..N` |
| | `round` | drand round = `roundAt(deadline)` |
| | `deadline` | `armTime + idx·intervalSec·1000` (unix ms) |
| | `hash` | `sha256(utf8(capsuleB64))` hex — **public** commitment |
| | `capsuleB64` | armored tlock capsule (~601 B) — **PRIVATE**, agent-held (N10) |
| `Switch` | `liveIdx` | `1..N` — soonest un-burned rung, armed to fire |
| | `seq` | monotonic counter; **invariant `liveIdx === seq + 1`** |
| | `currentDeadline` | `ladder[liveIdx-1].deadline` |
| | `scheduleId` | active `ScheduleCreate`; `null` after release/cancel |
| | `releaseNonce` | nonce in the live `RELEASE_AUTHORIZED` (watcher idempotency) |
| | `status` | `ACTIVE` \| `RELEASED` \| `CANCELLED` |

The `ladder` array is `0`-indexed but rungs are `idx = 1..N`: the live rung is
`ladder[liveIdx-1]` (the element whose `.idx === liveIdx`).

---

## 2. Phase-2 freeze decision — ciphertext storage: **HFS fast path + HCS large path**

> **Status:** decided here (pending human sign-off at the gate). This **amends C2**
> by *adding* a large-file medium; it is recorded loudly, not swapped silently.

`StorageRef` is a discriminated union on `kind`:

- **`hfs` (canonical / default).** Ciphertext ≤ `FAST_PATH_MAX_BYTES` (4 KB) → a
  single immutable `FileCreate` (empty KeyList). This is the headline path: a
  "tell tales" memo is text and fits. Reveal reads it through the backend
  `FileContentsQuery` proxy at `GET /api/file/[fileId]` (the mirror serves no file
  bytes).
- **`hcs` (large path).** Ciphertext > 4 KB (up to the ~1 MB stated scope) →
  chunked across a **dedicated storage topic** (separate from the switch's audit
  topic). Reveal reassembles the chunks **from the mirror** in sequence order — no
  proxy.

**Why** (measured, [spikes/FINDINGS.md](../spikes/FINDINGS.md)): HFS costs **~1 ℏ/KB,
flat** (expiry does not reduce it) → 1 MB ≈ **~1000 ℏ**, which exhausts a faucet
account; the C2 create→append→seal path is correct but **impractical at size**.
HCS is **~0.01 ℏ/KB (~100× cheaper)** and mirror-served. The C2 seal path remains
valid and is kept for the small/medium HFS case; it is **deprecated for large
files on cost grounds**. Integrity never depended on file immutability — the
device-signed `policyHash` commits to `ciphertextHash` regardless of medium.

`FAST_PATH_MAX_BYTES` is the switchover. `HederaSurface.storeCiphertext` picks the
medium by size and returns the `StorageRef`; `readCiphertext` reverses it.

---

## 3. Hashing & canonical encoding (normative — WS-A implements; vectors pinned)

All digests are **SHA-256**, lowercase hex, no `0x`.

**`canonicalJSON(value)`** — deterministic JSON: object keys sorted ascending
**recursively**, arrays in order, **no whitespace**, standard `JSON.stringify`
string/number escaping. (Reference implementation, also used to compute the
fixtures' vectors:)

```js
function canonicalJSON(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canonicalJSON).join(",") + "]";
  return "{" + Object.keys(v).sort()
    .map(k => JSON.stringify(k) + ":" + canonicalJSON(v[k])).join(",") + "}";
}
```

| Quantity | Definition |
|---|---|
| `ciphertextHash` | `sha256(ciphertextBytes)` |
| `nonce` | 32 bytes from a CSPRNG, hex (64 chars) |
| **`policyHash`** | `sha256(utf8(canonicalJSON(policy)))` where `policy = {terms, nullifier, ciphertextHash, nonce}` — the unambiguous realization of `hash(nullifier ‖ ciphertextHash ‖ terms ‖ nonce)` |
| `rung.hash` / `capsuleHash` | `sha256(utf8(capsuleB64))` |
| **`signal`** | `sha256(utf8(canonicalJSON({nextRungHash, newDeadline, topicId, seq})))` where `seq` is the **new** seq and `nextRungHash` is the now-live rung's hash |

**Pinned vectors** (in `lib/fixtures.ts`; WS-A's unit tests must match byte-for-byte):

```
policy   = {terms:{intervalSec:86400,n:20,fundingHbar:50,bulletin:"If you are reading this, I have gone quiet. — A."},
            nullifier:"12345678901234567890123456789012345678901234567890",
            ciphertextHash:"5430f9936b4151ab899ee7af3ae2f723319484953442d861ecea8cb6fdbbc86a",
            nonce:"9f1c7a4b2e8d05f36a91c4be7d20a8f15c3e6b9d042a7f18e5c90b3d6172a4e8b"}
policyHash = 5e69cb3137841c36cc5a6aafcea18e8d81f5dbe654eca0f4e64f652539ba5285

signal over {nextRungHash:"8ca209f0857875aa51bd81bfec6afd2a4ab7a4d0f2d3aa1e2b8480f59ca04400",
             newDeadline:1760172800000, topicId:"0.0.7777777", seq:1}
         = 4811168a447626334db554e71bce35e04f2905b5ac6bb17a36098f808d953ced
```

---

## 4. Lifecycle & state transitions

### Ladder semantics
At arm, with anchor `armTime`: rung *i* (`i = 1..N`) has
`deadline_i = armTime + i·intervalSec·1000` and `round_i = roundAt(deadline_i)`.
The grid is **fixed at arm**; check-in advances a pointer along it (it never
recomputes `now + interval`). **K** (the AES key) lives only in the browser at arm,
is minted into the *N* capsules, and is **discarded** — lost state ⇒ re-arm.

### ARM (both factors)
1. **World** proof → enroll `nullifier` (becomes part of `policyHash`).
2. **Device** signs `CryptoTransfer(Ledger → agent, FUNDING, memo = "DMTT:ARM:"+policyHash)`.

Executor (server): mirror-verify the transfer (§7) → `createTopic` (submitKey =
agent) → post `ARMED{policy, policyHash, rungHashes[], storage, armTxId, armTime}`
→ `scheduleRelease` for `deadline_1` wrapping `RELEASE_AUTHORIZED{seq:0, nonce}` →
persist `Switch{status:ACTIVE, liveIdx:1, seq:0, currentDeadline:deadline_1}`. The
ciphertext was stored (HFS/HCS) **before** arm; the sealed ladder is handed to the
agent (capsules private). The arm memo binds `policyHash` (not `topicId`) — no
chicken-and-egg, since the topic is created during arm.

### CHECK-IN (postpone) — `liveIdx = L`, requires `1 ≤ L ≤ N-1`
Precondition `input.seq === seq` (`= L-1`); else `STALE_SEQ`. World-verify the
proof; the proof's `nullifier_hash` must equal `policy.nullifier` (else
`WRONG_NULLIFIER`); recompute `signal` and require equality (else `WRONG_SIGNAL`).
Then, **create the new schedule for `deadline_{L+1}` BEFORE deleting the old**
(crash window errs toward release), **burn** (shred) rung `L`'s capsule, advance
`liveIdx = L+1`, `seq = L`, `currentDeadline = deadline_{L+1}`, and post
`CHECKIN_VERIFIED{proof, seq:L, newDeadline:deadline_{L+1}, nextRungHash, signal}`.
At `liveIdx = N` no postponement remains → `LADDER_EXHAUSTED` (re-arm to continue).

### RELEASE (go silent) — schedule at `deadline_L` fires unattended
The scheduled `TopicMessageSubmit` posts `RELEASE_AUTHORIZED{seq:L-1, nonce}`
(~34 ms after expiry, S2). The **watcher** reacts idempotently (dedupe on
`nonce`/`seq`): publish the fired rung's capsule `CAPSULE_PUBLISHED{idx:L,
seq:L-1, capsuleB64}` (decryptable now — `round_L` has passed) → best-effort
**bounty** payment → `BULLETIN{text}`. Set `status:RELEASED`,
`released={seq:L-1, idx:L, …}`.

### CANCEL — device signs `CryptoTransfer(Ledger → agent, 1 tinybar, memo="DMTT:CANCEL:"+topicId)`
Mirror-verify (§7) → `deleteSchedule(scheduleId)` → **shred the whole ladder** →
post `CANCELLED{cancelTxId}` → `status:CANCELLED`, `scheduleId:null`.

### REVEAL (any visitor, post-release)
Read `CAPSULE_PUBLISHED.capsuleB64` from the mirror → tlock-decrypt → **K** →
fetch ciphertext (`GET /api/file/[fileId]` for HFS, or reassemble HCS chunks from
the mirror) → AES-256-GCM decrypt → render. All in-browser; plaintext never
re-enters the server.

---

## 5. Topic event schema (the audit trail / state store)

One topic message = `utf8(JSON.stringify(event))`, discriminated by `type`.
Consensus order is the canonical history; the store is a cache the watcher and
boot-resume can rebuild from the mirror.

| `type` | Payload | When | Notes |
|---|---|---|---|
| `ARMED` | `{policy, policyHash, rungHashes[], storage, armTxId, armTime}` | once, at arm | `rungHashes[i] = sha256(utf8(ladder[i].capsuleB64))` — externally verifiable commitment |
| `CHECKIN_VERIFIED` | `{proof, seq, newDeadline, nextRungHash, signal}` | each postpone | `seq` is the **new** seq; ordinary submit (proof ~1–2 KB, can chunk) |
| `RELEASE_AUTHORIZED` | `{seq, nonce}` | schedule fires | **≤1 KB** — rides inside the schedule, can't chunk; **no capsule** (N10) |
| `CAPSULE_PUBLISHED` | `{idx, seq, capsuleB64}` | watcher reaction | `idx = seq + 1`; the now-decryptable rung |
| `BULLETIN` | `{seq, text}` | at release | LLM-composed public message |
| `CANCELLED` | `{cancelTxId}` | on cancel | device-signed cancel transfer id |
| `SERVICE_FEE_PAID` | `{seq, amountHbar, txId}` | optional, per check-in | only if `flags.chargeServiceFee` |

---

## 6. Store interface — `data/switches/{topicId}.json`

`SwitchStore`: `load` / `save` / `list` / `withLock`.

- `save` is **atomic**: write temp → fsync → rename (never a half-written file).
- `withLock<T>(topicId, mutator)` **serializes** read-modify-write per `topicId`:
  it loads the current `Switch | null`, awaits `mutator(current) → {next, result}`,
  persists `next` (`null` deletes), and returns `result`. Concurrent callers on the
  same topic run one-at-a-time (the "20 concurrent writes don't corrupt" test).
- `list` enumerates topicIds for **boot-resume** (re-attach schedules/watcher).

All executor mutations go through `withLock` so the create-schedule-before-delete
ordering and the `liveIdx/seq` invariant hold under concurrency.

---

## 7. Mirror-verify recipe (the ONLY way arm/cancel are authorized)

No signature-verification code. Fetch the tx and assert **all three**:

1. `result === "SUCCESS"`,
2. `base64decode(memo_base64) === expected` — **null-guard `memo_base64` first**
   (mirror returns `null` for no-memo txs),
3. a `transfers[]` entry with `account === ledgerAccountId && amount < 0` — a debit
   from the Ledger account is **cryptographic proof the device signed** (Hedera
   requires every debited account to sign).

Endpoints: `GET /api/v1/transactions/{transactionId}` (by id) and
`GET /api/v1/transactions?account.id={id}&timestamp=gt:{cursor}&order=asc`
(polling). **`/api/v1/accounts/{id}/transactions` does NOT exist (404)** — use the
`account.id` query param. Surfaced as `HederaSurface.verifyTransfer(txId,
{expectedMemo, debitAccountId}) → MirrorVerifyResult`.

Expected memos: arm `"DMTT:ARM:"+policyHash` (73 B); cancel
`"DMTT:CANCEL:"+topicId` (~21 B). Both ≤ `MEMO_MAX_BYTES` (100).

---

## 8. Executor signatures

`(ctx, input, artifacts) → Promise<ExecResult<T>>`, with **artifact verification
behind `ExecutorFlags`** (off for Phase-3 mocks, on at Phase-5 / M2).

| Executor | `input` | `artifacts` (flag-gated) | success `value` |
|---|---|---|---|
| `arm` | `{policy, policyHash, storage, ladder, armTime}` | `{armTxId, ledgerAccountId, fundingHbar}` → mirror-verify | `{topicId, scheduleId, switch}` |
| `checkin` | `{topicId, seq, signal}` | `{proof, action}` → World-verify + nullifier + signal | `{seq, liveIdx, newDeadline, scheduleId}` |
| `cancel` | `{topicId}` | `{cancelTxId, ledgerAccountId}` → mirror-verify | `{topicId, cancelTxId}` |

`ExecResult<T> = {ok:true, value} | {ok:false, error:{code, message}}`. Error codes:
`BAD_MEMO`, `POLICY_HASH_MISMATCH`, `ARM_TX_UNVERIFIED`, `WORLD_VERIFY_FAILED`,
`WRONG_NULLIFIER`, `WRONG_SIGNAL`, `STALE_SEQ`, `LADDER_EXHAUSTED`,
`CANCEL_TX_UNVERIFIED`, `NOT_FOUND`, `NOT_ACTIVE`, `INTERNAL`.

`ExecutorContext = {store, hedera, crypto, flags, now, worldVerify?}`. The
**negative tests are the point** (CLAUDE.md): a prompt-injected or forged tool call
fails exactly like a forged on-chain request — bad memo, wrong nullifier, wrong
signal, and stale seq must all reject.

Dependency surfaces the executors mock against: **`HederaSurface`** (WS-B —
file/topic/schedule/mirror) and **`CryptoSurface`** (WS-A — AES/tlock/ladder/hashes).
These are the executor-facing slices; WS-A/WS-B own their full module APIs.

---

## 9. REST shapes

| Route | Shape | Notes |
|---|---|---|
| `GET /api/switch/[topicId]` | → `SwitchView` | **public** projection; **never** exposes un-fired `ladder[].capsuleB64` (N10). Carries `rungHashes[]`, `events[]` (incl. the one post-release `CAPSULE_PUBLISHED`), `currentDeadline` (`null` when terminal). |
| `GET /api/file/[fileId]` | → `application/octet-stream` (`FileProxyMeta` describes it) | backend `FileContentsQuery` proxy for **HFS** ciphertext (mirror serves no file bytes). HCS ciphertext is read from the mirror directly. |
| `POST /api/world/rp-context` | `RpContextRequest{signal}` → `RpContextResponse{rp_id, nonce, created_at, expires_at, signature}` | backend signs with the **server-only** `signing_key` (`signRequest`); never `NEXT_PUBLIC_*`. |
| `POST /api/world/verify` | `WorldVerifyRequest{proof, action, signal}` → `WorldVerifyResponse{ok, nullifier?, detail?}` | forwards the proof **as-is**; body **must** include top-level `action` (G0) + the bound `signal`. |

Mutation routes (`arm` / `checkin` / `cancel`, and `/api/chat`) call the §8
executors; their request bodies are the executor `input + artifacts`. **Plaintext
never enters `/api/chat`** — MemoCard encrypts locally; ciphertext may transit the
server, plaintext and **K** may not.

---

## 10. Memo grammar & env

**Memos** (`lib/types.ts` builders/parsers): `DMTT:ARM:<policyHash hex64>` ·
`DMTT:CANCEL:<topicId>`. `parseArmMemo` / `parseCancelMemo` return `null` for
anything malformed or cross-typed (the negative fixtures assert this).

**Env names** (`ENV_VARS`; **never** client-exposed = `SERVER_ONLY_SECRETS`):

| Var | Server-only | Purpose |
|---|:--:|---|
| `HEDERA_NETWORK` | | `testnet` \| `mainnet` |
| `HEDERA_OPERATOR_ID` | | agent account id |
| `HEDERA_OPERATOR_KEY` | ✅ | agent private key |
| `HEDERA_KEY_TYPE` | | `ECDSA` \| `ED25519` (faucet = ECDSA) |
| `HEDERA_MIRROR_URL` | | mirror REST base |
| `WORLD_APP_ID` / `WORLD_RP_ID` / `WORLD_ACTION` | | World app/RP/action |
| `WORLD_SIGNING_KEY` | ✅ | rp_context signing key (returned once) |
| `WORLD_ENV` | | `staging` \| `production` (triple-match) |
| `ANTHROPIC_API_KEY` | ✅ | watcher bulletin + chat |
| `NEXT_PUBLIC_WORLD_APP_ID` | | client IDKit app id |

Plaintext, **K**, and the **Ledger key** never reach the server at all.

---

## 11. N10 — rung privacy invariant (contract-level)

Capsules (tlock rungs) stay **private, agent-held, until release is authorized**.
Therefore:

- `Switch.ladder[].capsuleB64` and `LadderRung.capsuleB64` are **server-only**;
  `SwitchView` and every public artifact carry only `rungHashes[]`.
- The scheduled message is **only** `RELEASE_AUTHORIZED{seq, nonce}` — never a
  capsule (a scheduled body is public from `ScheduleCreate`, and a published
  capsule decrypts the instant its round passes regardless of check-ins).
- The watcher publishes exactly the **one** fired rung as `CAPSULE_PUBLISHED`.
- Burned (checked-past) and cancelled rungs are **shredded** from the store.

**Honest residuals** (keep on the trust slide): **delay** · **shirk** ·
**stale-read** — bounded, detectable via the `ARMED` commitment, never an early
read. — *Frozen after this.*
