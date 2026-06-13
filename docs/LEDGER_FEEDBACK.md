# Ledger Feedback — DMTT (Dead Men Tell Tales)

> **STATUS: DRAFT (Phase 4).** Pending the human S1 Ledger device ceremony (`spikes/FINDINGS.md` lists S1 as `⏳ human`) and the Ledger workshop (PLAN.md, "Workshops" line). The Trusted-Display observations in Gap 3 are **design-level expectations** drawn from our build decisions, not yet independently re-verified on a physical device — they will be confirmed at S1 and the workshop before this doc is sent.

This document captures the concrete gaps we hit building **DMTT** on the Ledger Hedera app, each one sourced. It is written to be useful to the Ledger app and Device Management Kit (DMK) teams. Where a statement is a design decision we made (rather than something we re-measured), it is marked as such.

---

## 1. Context

DMTT is a dead man's switch for encrypted documents on Hedera (with World ID, Ledger, and drand). The user's **Ledger Hedera account key** is the root authority of the switch: it must sign exactly two transactions **on-device** — the **ARM** funding transfer and the **CANCEL** transfer. The device key never leaves the device, so the entire arm/cancel authorization model rests on what the Ledger Hedera app is able to clear-sign. (Source: CLAUDE.md, "The four authorities" and §C1.)

---

## 2. Gap 1 — Ledger Hedera app transaction-type coverage (the central gap)

**What we found.** The Ledger Hedera app **hard-rejects** the following transaction types — there is no blind-sign fallback offered:

- `AccountAllowanceApprove`
- `ConsensusSubmitMessage`
- `ScheduleDelete`

It **can** sign `CryptoTransfer`, with the transfer details and a **memo shown on the Trusted Display**. (Source: CLAUDE.md §C1.)

> Note on provenance: in our repo this is recorded as a **verified design decision** in CLAUDE.md §C1 ("hard-rejected by firmware, no blind-sign"), which states it was checked against primary sources. It has **not** yet been re-reproduced in our own spike harness — the on-device ceremony (S1) is still human-pending (`spikes/FINDINGS.md`). We would welcome confirmation of the exact current behavior (and any firmware/app-version dependence) at the workshop.

**Downstream design cost this forced on us.** Because the device cannot sign those three types, DMTT could not adopt the architecture we would otherwise have chosen:

- **No HIP-336 allowances.** We wanted the device to grant a scoped allowance to the operator/agent. `AccountAllowanceApprove` is rejected, so this is impossible. (CLAUDE.md §C1: "No budget account, no derived keys, no HIP-336 allowance.")
- **The device cannot sign topic messages.** `ConsensusSubmitMessage` is rejected, so the device cannot directly author entries in the switch's audit trail / event topic.
- **The device cannot sign schedule deletes.** `ScheduleDelete` is rejected, so the device cannot directly retract a scheduled release.

**What we did instead.** We encode all device-rooted authorization as **`CryptoTransfer`s with structured memos**, then verify them by reading the mirror node — no on-app signature-verification logic, just the transaction's own effects:

- **ARM** = device signs `CryptoTransfer(Ledger → agent, FUNDING, memo = "DMTT:ARM:" + policyHash)`.
- **CANCEL** = device signs `CryptoTransfer(Ledger → agent, 1 tinybar, memo = "DMTT:CANCEL:" + topicId)`.
- **Authorization check (mirror-verify):** fetch the tx and assert all three of — `result === "SUCCESS"`; the decoded memo equals the expected `DMTT:ARM:<policyHash>` / `DMTT:CANCEL:<topicId>` string; and a `transfers[]` entry debits the Ledger account (`amount < 0`), which Hedera only allows if that account signed. The debit is therefore cryptographic proof the device signed. (Source: CLAUDE.md §C1, "Mirror-verify recipe.")

This works, and we are not asking Ledger to change it for us. But it is a **workaround**: a whole class of authority that should naturally live on the device (postpone/delete/schedule actions) instead has to be re-expressed as memo'd value transfers and reconstructed off-chain.

**The ask, framed generally.** Broader transaction-type coverage in the Hedera app — even gated behind an explicit, opt-in clear-signing screen — would let dead-man-switch-style and scheduled/conditional-release apps push **more** authority onto the device instead of routing it through value transfers. The highest-value additions for our class of app are:

- `ScheduleSign` / `ScheduleDelete` (conditional / time-locked release control)
- `ConsensusSubmitMessage` (let the device directly author audit-trail events)

---

## 3. Gap 2 — No documented DMK Hedera signer

**What we found.** The Device Management Kit, as documented in the DMK skill material we worked from, ships signer kits for a specific set of chains and **does not document a Hedera signer**. The signer-kit table enumerates: Ethereum / EVM, Bitcoin, Solana, Cosmos, Hyperliquid, Aleo, Zcash — Hedera is absent. (Source: `ledger-dmk-implementation/dmk-sdk-reference.md`, "Signer kit — pick per chain" and "Chain Routing" tables.) Searching the DMK skill docs for "Hedera" returns no matches at all.

To stay accurate: we are stating only that **no Hedera signer is documented in the DMK material available to us** — not that one definitively does not exist anywhere. (The DMK SDK reference itself notes additional chain packages may live in the `device-sdk-ts` packages directory and directs developers to npm type definitions as the source of truth.)

**What this costs an app.** Because there is no documented DMK Hedera path, our Hedera signing has to go through the older `@ledgerhq/hw-app-hedera` (`^1.6`) plus `@ledgerhq/hw-transport-webhid`, not the DMK. (Source: CLAUDE.md, "Toolchain" stack list.) Concretely, for Hedera we give up the DMK's higher-level ergonomics that other chains get for free:

- **Clear Signing integration** as orchestrated by the DMK signer kits.
- **Device Actions** — the orchestrated flows that handle unlock detection, app opening/switching, the `ConfirmOpenApp` prompt, retries, and terminal-state emission through a single observable (DMK `dmk-business-logic/SKILL.md`, "Device Actions vs Commands"). With `hw-app-hedera` we re-implement that orchestration ourselves.
- **Session management** — the chain-agnostic `sessionId` model where one session serves every signer (`dmk-business-logic/SKILL.md`, "Session and SessionId").
- **Uniform error classification** — the DMK's status-word / rejection mapping (`dmk-sdk-reference.md`, "Error Types and Status Word Codes").

In short, on Hedera we hand-roll the transport and the flow instead of getting the DMK's pre-flight, observable confirmation states, and error classification that ETH/BTC/SOL apps get.

**The ask.** A DMK Hedera signer kit (`@ledgerhq/device-signer-kit-hedera`, following the existing signer-kit pattern) would let Hedera apps adopt the same session, device-action, and error-handling model as every other DMK chain.

---

## 4. Gap 3 — Trusted Display / clear-signing observations for `CryptoTransfer`

**What DMTT relies on.** Our entire mirror-verify trust model depends on the Hedera app showing, on the **Trusted Display**, for a `CryptoTransfer`:

- the **recipient** (the agent account),
- the **amount** (FUNDING for arm; 1 tinybar for cancel), and
- the **memo** (`DMTT:ARM:<policyHash>` / `DMTT:CANCEL:<topicId>`).

The **memo display is load-bearing**: it is the field that binds the on-device approval to the specific switch policy / topic the user is arming or cancelling. If the memo were not shown on the device (or were silently truncated), the user could be made to approve a value transfer whose embedded authorization they could not see — exactly the blind-signing failure mode the device screen exists to prevent (DMK `dmk-business-logic/SKILL.md`, "Clear Signing vs Blind Signing": the device screen is the only trusted display). The memo fits the Hedera 100-UTF-8-byte memo cap, so truncation should not arise in our case (CLAUDE.md §C1). (Source: CLAUDE.md §C1.)

**Verification status — pending.** Whether the Hedera app actually renders the memo (and recipient + amount) on the Trusted Display for these transfers is exactly what our **S1** spike — the human device ceremony — is meant to confirm; **S4** is its on-chain verifier (the mirror-read assertion), which is spec-verified but is "Re-run … with `HEDERA_MIRROR_TX_ID` = S1's tx for the real Ledger-debit assertion." S1 is still `⏳ human` and S4's real-tx pass is gated on it. (Source: `spikes/FINDINGS.md`, S1 and S4 rows.) Until S1 runs, the memo-display guarantee is an **assumption** in our design, not a measurement.

**The ask.** Documented, stable guarantees about **what fields the Hedera app displays for `CryptoTransfer`** — specifically that the memo is shown verbatim (or, if truncated, that truncation is signalled to the user) — would let apps like ours depend on the memo channel for authorization binding with confidence rather than on an unverified assumption.

---

## 5. Agent Stack / workshop notes (open questions, not claims)

From PLAN.md's "Workshops" line, the questions DMTT wants to raise with Ledger. These are **open questions**, not assertions about current behavior:

- **Agent Stack preview feedback channel** — is there a preview / feedback channel for the Agent Stack, and is this class of app (an autonomous operator/agent acting alongside a device-held root key) in scope for it?
- **`app-hedera` transaction-coverage roadmap** — what is the roadmap for transaction-type coverage in the Hedera app? Specifically, are `ScheduleSign` / `ScheduleDelete` and `ConsensusSubmitMessage` clear-signing on it (see Gap 1)?
- **DMK Hedera signer** — is a DMK Hedera signer kit planned (see Gap 2)?
- (Adjacent, from the same workshop line, raised with the World team rather than Ledger: v4 session-proofs vs nullifiers for repeated actions — noted here only for completeness.)

---

## 6. Summary asks (prioritized)

1. **Hedera app `CryptoTransfer` memo-display guarantee, documented and stable** — the lowest-effort, highest-leverage item for us, because our entire arm/cancel authorization binds to the on-device memo. (Gap 3.)
2. **`ScheduleSign` / `ScheduleDelete` + `ConsensusSubmitMessage` clear-signing in the Hedera app** — even behind an explicit opt-in clear-signing screen — so device-rooted authority for scheduled/conditional release and audit-trail events doesn't have to be re-expressed as memo'd value transfers. (Gap 1.)
3. **A DMK Hedera signer kit** — to bring Hedera onto the same DMK session / device-action / error-classification model as every other supported chain. (Gap 2.)

---

*Sources cited inline: `CLAUDE.md` (§C1, "The four authorities", "Toolchain"), `spikes/FINDINGS.md` (S1, S4 rows), `PLAN.md` ("Workshops" line), and the DMK skill docs (`dmk-business-logic/SKILL.md`, `dmk-intent-vocabulary/SKILL.md`, `ledger-dmk-implementation/dmk-sdk-reference.md`). No API names, method signatures, firmware versions, or behaviors have been invented beyond what these sources state.*
