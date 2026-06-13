# DMTT — Architecture Evaluation & Verified Findings

Evaluation of the DMTT architecture doc + build-plan doc against primary sources: Hedera protobufs/HIPs/mirror-node OpenAPI, the Ledger device app's source code, World ID 4.0 docs, live drand API, AI SDK v5 docs, Bun's compat tracker, HashPack's support docs, and live mirror-node queries. ~35 claims verified across five research passes (2026-06-12).

**Verdict:** the architecture's core ideas all survive — single mutating surface with artifact-gated executors, deterministic dispatch, client-executed-tool cards, plaintext-never-in-chat, schedule-as-clock, tlock-sealed capsules. Two inherited ceremonies were impossible as written (C1, C2) and have decided replacements; the Bun runtime was at-risk and is dropped (N1); a few API names were one generation stale (N2, C4). One user proposal was evaluated and rejected with a recorded rationale (N10).

---

## C1. Ledger Hedera app cannot sign `AccountAllowanceApprove` → DECIDED: direct funding + device-signed cancel memo

**Finding (from firmware source):** the device app parses ONLY ContractCall, CryptoCreateAccount, CryptoTransfer, CryptoUpdateAccount, TokenMint, TokenBurn, TokenAssociate, TokenDissociate. `CryptoApproveAllowance`, `ConsensusSubmitMessage`, `ScheduleDelete` are hard-rejected (`default: THROW(EXCEPTION_MALFORMED_APDU)`) — **no blind-signing setting exists**. Identical on `develop`, `master`, and the latest release tag (app v1.9.1; repo current to 2026-05-11). Zero allowance issues/PRs. `CryptoTransfer` IS supported with a **Memo screen** (≤100 chars; max 2 account-amounts summing to zero).

**Mechanism (why "the wallet signs it" can't work):** `@ledgerhq/hw-app-hedera` sends raw `TransactionBody` bytes; the firmware nanopb-decodes them against its trimmed proto before any confirm screen. With a Ledger-backed account, HashPack holds no key — it is a relay, not a co-signer. HashPack's own support center: *"Ledger does not currently support Hedera dApps"*; their community docs name token allowance specifically (the Zuse-listing example). HashPack's dApp connector lists Allowance Approve — **for software-keyed accounts**. Instructive precedent: staking works on Ledger because it extends `CryptoUpdateAccount`, an already-parsed type — the same pattern as our memo'd-transfer workaround.

**Decided design (user-confirmed):** no allowances, no budget account, no derived keys.
- **ARM** (both factors): ① World proof → enroll nullifier (part of `policyHash`); ② device signs `CryptoTransfer(Ledger → agent, FUNDING, memo="DMTT:ARM:"+policyHash)` — recipient, amount, and policy commitment on the Trusted Display. The arm executor fetches the tx from the mirror node and asserts `result==SUCCESS` + decoded `memo_base64` matches + a `transfers[]` debit from the Ledger account.
- **CANCEL:** device signs `CryptoTransfer(Ledger → agent, 1 tinybar, memo="DMTT:CANCEL:"+topicId)`; cancel executor verifies the same three facts → `ScheduleDelete` + shred ladder + post `CANCELLED`. (The Hedera app has no off-chain message signing — this memo'd transfer is the on-chain equivalent of a signed message, publicly auditable and unforgeable.)
- **Why the verification is sound:** Hedera consensus requires every debited account to sign — a confirmed transfer debiting the Ledger account IS cryptographic proof the device signed. The agent authorizes by reading the chain; zero signature-verification code.

**Honest tradeoffs (trust slide):**
1. *Possession, not permission* — FUNDING moves to the agent at arm; a Byzantine agent could keep unspent funds (HIP-336 restoration = roadmap).
2. *Cancel is honored, not chain-enforced* — same residual class as retained-rung delay; the cancel memo is public, so misbehavior is detectable; watchtower/courier roadmap unchanged.
3. *No "exhausted → release" secondary path* — the primary go-silent → release mechanism is untouched.

**Track impact:** Ledger track intact ("only the device can arm or cancel" — device signs both ceremonies, value + memo on the Trusted Display). Hedera Agentic Payments still qualifies via the agent's autonomous release-bounty payment (+ optional per-check-in service fee for a recurring story).

Sources:
- https://github.com/LedgerHQ/app-hedera/blob/develop/proto/transaction_body.proto
- https://github.com/LedgerHQ/app-hedera/blob/develop/src/sign_transaction.c
- https://github.com/LedgerHQ/ledger-live/blob/develop/libs/ledgerjs/packages/hw-app-hedera/src/Hedera.ts
- https://www.npmjs.com/package/@ledgerhq/hw-app-hedera
- https://hashpackapp.zendesk.com/hc/en-us/articles/29207643332497
- https://www.hashpack.app/community-blog/hashgraph-enthusiasts-news-rumours-62-ledger-staking-is-coming
- https://docs.hedera.com/hedera/sdks-and-apis/sdks/cryptocurrency/transfer-cryptocurrency (debited accounts must sign)
- https://support.ledger.com/article/4494505217565-zd (setup-only article; no tx-type claims)

### Mirror-node keystone (arm/cancel verification recipe — verified vs OpenAPI + live query)
- `GET /api/v1/transactions/{transactionId}` and `GET /api/v1/transactions?account.id={id}` return `memo_base64` (base64; **null possible — guard before decode**), `transfers[]{account, amount}` (negative = debit), `result` (compare `"SUCCESS"`), `name` (`"CRYPTOTRANSFER"`), stable `transaction_id` (`{payer}-{validStartSecs}-{nanos}`).
- **Gotcha:** `/api/v1/accounts/{id}/transactions` does NOT exist (404) — use the `account.id` query param; poll with `order=asc&timestamp=gt:{lastConsensusTs}` (default window is last 60 days without a timestamp filter).
- Memo limit 100 UTF-8 bytes: `DMTT:ARM:`+64 hex = 73 B ✓ · `DMTT:CANCEL:0.0.x` ≈ 21 B ✓.

Sources:
- https://github.com/hiero-ledger/hiero-mirror-node/blob/main/rest/api/v1/openapi.yml
- https://docs.hedera.com/hedera/sdks-and-apis/rest-api
- https://docs.hedera.com/hedera/core-concepts/transactions-and-queries/transaction-properties

## C2. `FileCreate`(empty KeyList) + `FileAppend` is impossible → create → append → seal

`FileAppend` requires signatures from **all** keys in the file's KeyList and "the identified file MUST NOT be immutable" — a keyless file can never be appended. The original hour-1 check ("empty-KeyList file is immutable") tests the wrong property. **Fix (verified):** create with agent key → append chunks → `FileUpdate` with an **empty KeyList**: "the file SHALL be immutable after completion of this transaction." Fast path: a single `FileCreate` carries ~5 KB (6 KiB tx cap) → memos ≤4 KB skip append and are immutable from creation. Integrity never depended on file immutability — the device-signed policyHash commits to the ciphertext hash.

Sources:
- https://raw.githubusercontent.com/hashgraph/hedera-protobufs/main/services/file_append.proto
- https://raw.githubusercontent.com/hashgraph/hedera-protobufs/main/services/file_update.proto
- https://docs.hedera.com/hedera/sdks-and-apis/sdks/file-service/create-a-file · /append-to-a-file

## C3. Use `@hiero-ledger/sdk`, not `@hashgraph/sdk`

`@hashgraph/hedera-agent-kit` v4.0.0 peer-depends on `@hiero-ledger/sdk ^2.81` (the JS SDK moved to Hiero). The Vercel AI SDK adapter exists: `@hashgraph/hedera-agent-kit-ai-sdk` 1.0.0. Mixing `@hashgraph/sdk` Client instances with the kit causes type/instance mismatches — one package repo-wide.

Sources:
- https://registry.npmjs.org/@hashgraph/hedera-agent-kit/latest
- https://registry.npmjs.org/@hashgraph/hedera-agent-kit-ai-sdk/latest
- https://github.com/hiero-ledger/hiero-sdk-js

## C4. World ID 4.0 — implement per World's official agent guide

World publishes an LLM-ready skill (`world.id/SKILL.md` → `docs.world.org/world-id/SKILL.md`); the World workstream uses it as primary source. Key facts:
- **Developer Portal MCP** (`https://developer.world.org/api/mcp`, Bearer) automates app+RP+action creation and guarantees capturing the **one-time `signing_key`** (server-only secret, never `NEXT_PUBLIC_*`).
- Pin `@worldcoin/idkit@^4` — v2/v3 samples won't work. Verify endpoint: `POST https://developer.world.org/api/v4/verify/{rp_id}` (v2 is legacy). Every IDKit request needs a backend-signed `rp_context` (`signRequest` from `@worldcoin/idkit-core/signing`).
- Credential preset `orbLegacy` (proof of human) with our **signal binding** through it; backend re-enforces the same signal; **forward the proof as-is** (no mutation/re-encoding).
- **Identifier = nullifier** (skill's canonical step 6: store `(action, nullifier)` with a UNIQUE constraint; it's a uint256 — decimal string in our JSON store). Same human + same action → same nullifier; unlimited max-verifications confirmed (portal source: 0/-1 = unlimited).
- **Triple environment match** (mismatches fail silently): IDKit `environment` prop ⟷ action environment ⟷ Simulator-vs-real-App. Staging verifies only via https://simulator.worldcoin.org; the production World App signs only production proofs. Standalone web apps: `app_mode: "external"` + QR connector flow.

Sources:
- https://docs.world.org/world-id/SKILL.md
- https://docs.world.org/world-id/idkit/integrate · /world-id/4-0-migration · /api-reference/developer-portal/verify
- https://github.com/worldcoin/developer-portal (web/api/helpers/verify.ts — unlimited semantics)
- https://github.com/worldcoin/simulator

## C5. Scheduled messages can't chunk

A scheduled `TopicMessageSubmit` cannot use SDK chunking — the entire `ScheduleCreate` must fit the 6 KiB transaction cap. `RELEASE_AUTHORIZED` stays minimal (seq/nonce); the capsule goes in the watcher's follow-up `CAPSULE_PUBLISHED` (see N10 for why it must anyway).

Sources: HIP-423 + https://docs.hedera.com/hedera/sdks-and-apis/sdks/consensus-service/submit-a-message

## Confirmed working (the core clock is real)

- `waitForExpiry(true)` schedules execute at expiration, no external trigger; **long-term scheduling live on testnet** (`scheduling.longTermEnabled = true`, ConsensusSubmitMessage whitelisted); max horizon 62 days; `ScheduleDelete` requires the admin key (`SCHEDULE_IS_IMMUTABLE` without). Inner-tx payer = ScheduleCreate payer; **fails once if unfunded at execution** → operator balance on the demo checklist.
- Mirror node serves **no file contents** → reveal reads HFS via the backend `FileContentsQuery` proxy.
- HCS: 1024 B/message, SDK chunks to ~20 KB — proof artifacts (1–2 KB) fit.
- drand quicknet live (checked 2026-06-12), 3 s rounds, unchained (`bls-unchained-g1-rfc9380`); `tlock-js` 0.9 API (`timelockEncrypt/timelockDecrypt`, `roundForTime`); armored capsule for a 32 B key ≈ 550–650 B.
- WebHID: Chromium-only, HTTPS/localhost.

Sources:
- https://hips.hedera.com/HIP/hip-423.html
- https://github.com/hiero-ledger/hiero-consensus-node (SchedulingConfig.java)
- https://docs.hedera.com/hedera/sdks-and-apis/sdks/schedule-transaction/create-a-schedule-transaction · /delete-a-schedule-transaction · /core-concepts/scheduled-transaction
- https://docs.hedera.com/hedera/sdks-and-apis/sdks/file-service/get-file-contents
- https://github.com/drand/tlock-js · https://api.drand.sh/v2/beacons/quicknet/rounds/latest
- https://developers.ledger.com/docs/device-interaction/ledgerjs/integration/web-application/web-hid-usb

---

## N1. Bun runtime at-risk for Hedera gRPC → DECIDED: pnpm + Node, no Bun

Bun's `node:http2` is officially "yellow" (95% of gRPC's suite); `hiero-sdk-js` #3186 documents the SDK crashing under Bun during transaction execution; no official support statement from either side. (`bun run dev` runs Next on Node anyway — the runtime, not the PM, was the risk.) **Decision: pnpm + Node everywhere; Bun removed from the stack.**

Sources:
- https://bun.com/docs/runtime/nodejs-compat
- https://github.com/hiero-ledger/hiero-sdk-js/issues/3186
- https://bun.com/guides/ecosystem/nextjs

## N2. AI SDK v5 API names

Client-executed tools: `onToolCall` + **`addToolOutput({tool, toolCallId, output})`** (`addToolResult` is v4-era); don't `await` inside `onToolCall`; check `toolCall.dynamic`; use `sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls`. **AI Elements** is a shadcn-style registry (`npx ai-elements@latest` copies into `@/components/ai-elements/`), not an npm dependency.

Sources:
- https://ai-sdk.dev/v5/docs/ai-sdk-ui/chatbot-tool-usage
- https://github.com/vercel/ai-elements

## N3. World AgentKit is real — the exclusion is a feature

`@worldcoin/agentkit` (launched 2026-03-17) delegates a human's World ID to AI agents. DMTT deliberately excludes it: **AgentKit exists precisely to delegate proof-of-human — the one thing a dead man's switch must never allow.** Judge-ready line.

Source: https://world.org/blog/announcements/now-available-agentkit-proof-of-human-for-the-agentic-web

## N4. Ledger Agent Stack — public preview 2026-06-10 (two days before the hackathon)

Agent Stack (DMK Skills, Wallet CLI, Enterprise CLI — "Agents propose. Humans approve. Hardware enforces.") is in public preview; **Agent Intents is Q3 2026 roadmap, not shipped.** This repo already has the Agent Stack DMK skills installed (`ledgerhq/agent-skills`) — the build itself uses Ledger's agent tooling, and the mandatory feedback submission can include genuine Agent Stack preview feedback.

Sources:
- https://www.ledger.com/blog-preview-ledger-agent-stack
- https://www.ledger.com/blog-2026-ai-security-roadmap
- https://github.com/LedgerHQ/device-sdk-ts/tree/develop/packages/signer (no Hedera signer kit)

## N5. Memo key K — random, ephemeral

With allowances dropped there is no budget key to derive, so derivation has no remaining payoff worth its cost. **K is random, in-memory at arm only; minted into N tlock copies; discarded. Lost state ⇒ re-arm** (the user still holds the original memo). The device's only jobs are the two transfers. (hw-app-hedera has no `signMessage`; any future derivation would ride `signTransaction` over a canonical body + a determinism spike — roadmap.)

## N6–N9. Resolved / hardening kept

- Ladder semantics: `armTime + i·interval`, i=1..N, `liveIdx` — coherent (sync older doc wording).
- One AI framework: AI SDK adapter everywhere; LangChain never enters.
- Hardening (cheap, high-value): **`rungHashes[]` commitment in `ARMED`** (externally verifiable signal binding + recovery claim) · **topic submitKey = agent** (anti-spam; scheduled message still fires — sigs collected at ScheduleCreate count) · **create-new-schedule-before-delete-old** on check-in (crash window errs toward release) + idempotent watcher.
- Patterns that hold: artifact-gated executors (prompt-injected tool calls fail like forged requests); deterministic dispatch; MemoCard plaintext isolation; JSON store + lock with the Turso migration trigger; watcher as a separate process.

## N10. Scheduled-capsule proposal — evaluated and REJECTED (public-schedule-body trap)

**Proposal:** put the tlock-encrypted key in the scheduled message itself, so the network publishes the capsule with no watcher.
**Why it can't work:** a scheduled transaction's inner body is **public from `ScheduleCreate`** (record stream + mirror `/api/v1/schedules/{id}`). `capsule_i` becomes copyable the moment its schedule exists; `ScheduleDelete` removes the schedule, not the copies; and **drand round `deadline_i` arrives regardless of check-ins** — any copy then decrypts. Check-ins would postpone nothing. tlock seals against *early* reading, not against time: **publishing a capsule is an irrevocable commitment to release at its round.** Invariant: **rungs stay private (agent-held) until release is authorized**; the scheduled message is only the minimal `RELEASE_AUTHORIZED` event. (Size was never the blocker — ~600 B vs the 6 KiB cap.)
**What the proposal got right (already the design):** ciphertext static, posted once at arm (HFS); per-check-in artifacts are only the tiny capsules; K never stored.
**Honesty fix surfaced:** "never silent reading" was overstated — an agent retaining a *burned* rung can decrypt it privately once its round passes and read the forever-public ciphertext. Bounded (stale-round only, never earlier than an armed deadline, detectable via the `ARMED` commitment), but the trust slide must say **delay / shirk / stale-read**, mitigations = rotation/watchtower/couriers roadmap.

---

## Older-doc sync list (apply during the Phase 7 docs pass)

ERC-7730 checklist line → replace with the Ledger feedback doc + Agent Stack feedback · "booth question #1" (allowance signing) is answered from source — replace with Agent Stack / coverage-roadmap questions · ladder wording → `armTime + i·interval` semantics · keys-table K row → random-K · README line on grid semantics (check-in advances the deadline along the rung grid, not to `now + interval`) · **keys/trust table:** remove budget/allowance row; Ledger account = signs arm funding + cancel transfers (root authority); agent account = holds prepaid FUNDING (possession-not-permission caveat); policy = `{intervalSec, N, fundingHbar, nullifier, ciphertextHash, nonce}`.
