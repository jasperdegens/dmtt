# CLAUDE.md — DMTT build brief (read first, every agent)

**Dead Men Tell Tales**: a dead man's switch for encrypted documents on Hedera + World ID + Ledger + drand. Encrypt a memo, arm with a Ledger signature + World proof, check in (as a verified human) to postpone, go silent and the Hedera network authorizes release — a tlock capsule is published and the memo becomes decryptable by anyone.

Plan: [PLAN.md](PLAN.md). Sourced rationale: [docs/EVALUATION.md](docs/EVALUATION.md). **This file is the source of truth for design decisions — do not re-litigate the items below; they were verified against primary sources.** If reality contradicts a decision, stop and flag it for a human, don't silently work around it.

## Toolchain (non-negotiable)
- **pnpm + Node everywhere. No Bun.** (`@hiero-ledger/sdk` crashes under Bun's `node:http2`.) Run `pnpm install`, `pnpm dev`, `node watcher/index.js`.
- **`@hiero-ledger/sdk` is THE Hedera SDK** — never `@hashgraph/sdk` (Agent Kit v4 peer-deps on hiero; mixing Client instances breaks).
- Stack: Next.js 15 (App Router, single page `/` + `/api/*`) · AI SDK v5 + AI Elements · `@hashgraph/hedera-agent-kit@4` + `@hashgraph/hedera-agent-kit-ai-sdk` (watcher only) · `@worldcoin/idkit@^4` · `tlock-js@0.9` · `@ledgerhq/hw-app-hedera@^1.6` + `@ledgerhq/hw-transport-webhid`. Local JSON store (no DB).

## The four authorities (who can do what)
- **Ledger device** (user's Hedera account key, on-device): signs the **arm funding transfer** and the **cancel transfer**. Root authority for arm + cancel. Cannot leave the device.
- **World nullifier** (user's World App): authorizes **postponements** (check-in). Cannot be scripted or delegated — that's the product invariant (do NOT use World AgentKit).
- **Agent** (operator key, env var): all Hedera ops (file/topic/schedule/fees), holds prepaid FUNDING, publishes capsule + pays bounty on release. Cannot read the memo or forge any authorization.
- **drand quicknet**: the seal. Capsules can't open before their round. Bedrock confidentiality assumption.

## C1 — Arm & cancel are device-signed `CryptoTransfer`s (NOT allowances)
The Ledger Hedera app **cannot sign `AccountAllowanceApprove`, `ConsensusSubmitMessage`, or `ScheduleDelete`** (hard-rejected by firmware, no blind-sign). It CAN sign `CryptoTransfer` with a memo shown on the Trusted Display. So:
- **ARM** = ① World proof → enroll `nullifier` (becomes part of `policyHash`); ② device signs `CryptoTransfer(Ledger → agent, FUNDING, memo="DMTT:ARM:"+policyHash)`. `FUNDING` = config constant covering ops + bounty.
- **CANCEL** = device signs `CryptoTransfer(Ledger → agent, 1 tinybar, memo="DMTT:CANCEL:"+topicId)`.
- **No budget account, no derived keys, no HIP-336 allowance.** Don't add them.

### Mirror-verify recipe (the ONLY way executors authorize arm/cancel — no signature-verification code)
Fetch the tx and assert all three:
1. `result === "SUCCESS"`
2. `base64decode(memo_base64) === expected` (e.g. `"DMTT:ARM:"+policyHash`) — **null-guard `memo_base64` before decoding**
3. a `transfers[]` entry with `account === ledgerAccountId && amount < 0` (a debit from the Ledger account = cryptographic proof the device signed; Hedera requires debited accounts to sign)

Endpoints: `GET /api/v1/transactions/{transactionId}` (by id) and `GET /api/v1/transactions?account.id={id}&timestamp=gt:{cursor}&order=asc` (polling). **`/api/v1/accounts/{id}/transactions` does NOT exist (404)** — use the `account.id` query param. Memo cap is 100 UTF-8 bytes (our memos fit).

## C2 — HFS: create → append → seal
`FileAppend` requires the file's keys and forbids immutable files, so "create empty-KeyList then append" is impossible. Instead:
- ≤4 KB ciphertext: single `FileCreate` with empty KeyList (immutable from creation).
- >4 KB: `FileCreate`(agent key) → `FileAppend` chunks → `FileUpdate(keys = empty KeyList)` to seal. Max file 1 MB.

## N10 — Rung privacy invariant (do not violate)
**Capsules (tlock rungs) stay private, agent-held, until release is authorized.** Never put a capsule in a scheduled transaction body or any public artifact before release — scheduled bodies are public from `ScheduleCreate`, and a published capsule decrypts the instant its drand round passes regardless of check-ins. The scheduled message carries only the minimal `RELEASE_AUTHORIZED{seq,nonce}` event; the **watcher** publishes the capsule as its reaction.

## Crypto / ladder
- **K** = random AES-256-GCM key, in memory at arm ONLY. Mint the ladder `tlock(K, roundForTime(armTime + i·interval))` for `i=1..N` (N=20), hand sealed rungs to the agent, discard K. Never store K. Lost state ⇒ re-arm.
- `policyHash = hash(nullifier ‖ ciphertextHash ‖ terms ‖ nonce)`.
- Check-in advances `liveIdx` along the fixed rung grid (NOT `now + interval`); burns the soonest rung; reschedules.
- Signal binding: World `signal = hash(nextRungHash ‖ newDeadline ‖ topicId ‖ seq)`; backend recomputes and re-enforces.

## World ID 4.0 (per `docs.world.org/world-id/SKILL.md` — the World workstream's primary source)
- Portal via Developer Portal MCP (`https://developer.world.org/api/mcp`). **`signing_key` is returned once → server-only secret, never `NEXT_PUBLIC_*`.**
- Backend signs `rp_context` (`signRequest` from `@worldcoin/idkit-core/signing`) — never sign on the client.
- Verify: POST proof **as-is, no re-encoding** to `https://developer.world.org/api/v4/verify/{rp_id}`. Preset `orbLegacy`.
- Identifier = **nullifier**; store `(action, nullifier)` with a uniqueness check (it's a uint256 — decimal string).
- **Triple environment match** (silent failure otherwise): IDKit `environment` ⟷ action env ⟷ Simulator-vs-real-App. Build a staging/production toggle. `app_mode: "external"` + QR for the standalone web app.

## Hedera specifics
- Schedule: `ScheduleCreate(wrapping TopicMessageSubmit, setExpirationTime(deadline), setWaitForExpiry(true), setAdminKey(agent))`; fires at expiry with no trigger; max 62 days; `ScheduleDelete` needs the admin key. Keep operator funded (inner-tx payer fails once if dry at execution).
- Topic: set `submitKey = agent` (anti-spam; scheduled message still fires).
- On check-in: **create the new schedule BEFORE deleting the old** (crash window then errs toward release).
- `RELEASE_AUTHORIZED` ≤1 KB (scheduled messages can't chunk). Reveal reads HFS via a backend `FileContentsQuery` proxy (mirror serves no file bytes).
- Watcher is **idempotent** — tolerate duplicate `RELEASE_AUTHORIZED`.

## AI SDK v5 / chat
- Client-executed tools: `onToolCall` + **`addToolOutput({tool, toolCallId, output})`** (not `addToolResult`). Don't `await` inside `onToolCall`; check `toolCall.dynamic`; `sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls`.
- AI Elements via `npx ai-elements@latest` (shadcn registry → `@/components/ai-elements/`), not an npm import.
- The chat is a **fixed state machine**; the LLM only narrates + parses free text into chips. It **cannot** reorder steps or invoke a mutation without a captured artifact. **Plaintext never enters `/api/chat`** — MemoCard encrypts locally; disable chat input while it's active. Mutations must work with the LLM offline.

## Topic event schema (the audit trail / state store)
`ARMED{policy, rungHashes[]}` · `CHECKIN_VERIFIED{proof, seq, newDeadline}` · `RELEASE_AUTHORIZED{seq, nonce}` · `CAPSULE_PUBLISHED{capsuleB64}` · `BULLETIN{text}` · `CANCELLED{cancelTxId}` (· optional `SERVICE_FEE_PAID`).

## Repo layout
```
/app           Next.js single page (/ with ?t=) + api/* (chat, switch/[topicId], file/[fileId], world rp_context+verify)
/components     MemoCard, TermsChips, WorldVerifyCard, LedgerSignCard, StatusCard, ai-elements/*
/lib           crypto.ts, hedera.ts, world.ts, ledger.ts, store.ts, types.ts
/watcher       index.ts (Node process)
/data          switches/*.json (gitignored — holds sealed ladders)
/docs          CONTRACTS.md, EVALUATION.md
```

## Env (never client-exposed: plaintext, K, Ledger key, World signing_key)
`HEDERA_OPERATOR_ID` / `HEDERA_OPERATOR_KEY` · `WORLD_APP_ID` / `WORLD_RP_ID` / `WORLD_ACTION` / `WORLD_SIGNING_KEY` · `ANTHROPIC_API_KEY` · `NEXT_PUBLIC_WORLD_APP_ID` etc.

## Honest residuals (keep them in the README/trust slide — the design's credibility is its honesty)
**delay** (agent stalls a postpone — detectable via signal binding) · **shirk** (agent fails to publish — couriers roadmap) · **stale-read** (agent retains a burned rung, decrypts it after its round passes — bounded to an already-armed deadline, never early). The agent can NEVER read early, forge an authorization, or destroy evidence. Possession-not-permission (FUNDING moves to the agent) and cancel-is-honored-not-enforced are accepted MVP tradeoffs with roadmap fixes.

## Definition of done (any workstream)
Code + its `Verify:` block from PLAN.md passing, **including the negative tests** (forged/replayed/wrong-actor inputs must be rejected). Stay within your owned paths; don't touch frozen contracts (`lib/types.ts`, `docs/CONTRACTS.md`) without a human decision.
