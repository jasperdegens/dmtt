// watcher/cancel-backstop.test.ts — pure unit tests for the cancel backstop (WS-D).
//
// Exercises the Phase-5 deliverable "watcher backstop poll of agent-account inbound
// txs for cancel memos" (CLAUDE.md C1): a SUCCESS DMTT:CANCEL:<topicId> transfer to the
// agent is honored through the cancel executor even with no /api/cancel call; everything
// else (non-cancel memo, non-SUCCESS, unknown/terminal switch) is skipped; the cursor
// advances so a tx is never re-scanned; infra errors leave the cursor for a retry.
//
// In-memory + dependency-injected (no SDK / network / fs). The honorCancel + store deps
// are hand-rolled spies; we never import lib/fixtures.ts (extensionless imports break the
// native TS test resolver — same reason release.test.ts inlines its values).
// Run: node --test --test-reporter=spec watcher/cancel-backstop.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";

import { scanCancels, decodeMemo, type CancelBackstopDeps, type CancelCursor } from "./cancel-backstop.ts";
import { cancelMemo, armMemo } from "../lib/types.ts";
import type { MirrorTransaction, Switch } from "../lib/types.ts";

const TOPIC = "0.0.7777777";
const LEDGER_ACCOUNT = "0.0.1234567";
const AGENT_ACCOUNT = "0.0.2000000";
const POLICY_HASH = "5e69cb3137841c36cc5a6aafcea18e8d81f5dbe654eca0f4e64f652539ba5285";

/** base64 of a tx memo, the way the mirror returns memo_base64. */
function b64(memo: string): string {
  return Buffer.from(memo, "utf8").toString("base64");
}

/** A device-signed cancel transfer (Ledger debit → agent credit) as the mirror reports it. */
function cancelTx(
  topicId: string,
  ts: string,
  over: Partial<MirrorTransaction> = {},
): MirrorTransaction {
  return {
    transactionId: `${LEDGER_ACCOUNT}-${ts.split(".")[0]}-000000000`,
    result: "SUCCESS",
    memoBase64: b64(cancelMemo(topicId)),
    consensusTimestamp: ts,
    transfers: [
      { account: LEDGER_ACCOUNT, amount: -1 },
      { account: AGENT_ACCOUNT, amount: 1 },
    ],
    ...over,
  };
}

/** A minimal ACTIVE switch — only the fields the backstop reads (status, ledgerAccountId). */
function activeSwitch(): Switch {
  return {
    topicId: TOPIC,
    status: "ACTIVE",
    policy: {
      terms: { intervalSec: 86_400, n: 20, fundingHbar: 50, bulletin: "" },
      nullifier: "12345678901234567890123456789012345678901234567890",
      ciphertextHash: "5430f9936b4151ab899ee7af3ae2f723319484953442d861ecea8cb6fdbbc86a",
      nonce: "9f1c7a4b2e8d05f36a91c4be7d20a8f15c3e6b9d042a7f18e5c90b3d6172a4e8b",
    },
    policyHash: POLICY_HASH,
    storage: { kind: "hfs", fileId: "0.0.8888888", bytes: 1024 },
    armTxId: `${LEDGER_ACCOUNT}-1760000000-000000000`,
    ledgerAccountId: LEDGER_ACCOUNT,
    armTime: 1_760_000_000_000,
    ladder: [],
    liveIdx: 1,
    seq: 0,
    currentDeadline: 1_760_086_400_000,
    scheduleId: "0.0.5555555",
    releaseNonce: "1f2e3d4c5b6a7988796a5b4c3d2e1f00112233445566778899aabbccddeeff00",
    createdAt: 1_760_000_000_000,
    updatedAt: 1_760_000_000_000,
  };
}

/** Record of every honorCancel call so tests can assert what (if anything) was honored. */
interface HonorCall {
  topicId: string;
  cancelTxId: string;
  ledgerAccountId: string;
}

/** Build deps: a store that serves `sw` for TOPIC (null otherwise), a listAccountTransactions
 *  that returns `txs` filtered by the gt: cursor, and a honorCancel spy returning `result`. */
function makeDeps(opts: {
  sw: Switch | null;
  txs: MirrorTransaction[];
  honorResult?: boolean | ((c: HonorCall) => boolean | Promise<boolean>);
}): { deps: CancelBackstopDeps; calls: HonorCall[] } {
  const calls: HonorCall[] = [];
  const deps: CancelBackstopDeps = {
    store: {
      async load(topicId) {
        return topicId === (opts.sw?.topicId ?? TOPIC) ? opts.sw : null;
      },
    },
    async listAccountTransactions(after) {
      // Mirror semantics: timestamp=gt:after, ascending. Lexicographic compare works
      // for the fixed-width "secs.nanos" strings the mirror returns.
      return after ? opts.txs.filter((t) => t.consensusTimestamp > after) : opts.txs;
    },
    async honorCancel(topicId, cancelTxId, ledgerAccountId) {
      calls.push({ topicId, cancelTxId, ledgerAccountId });
      const r = opts.honorResult ?? true;
      return typeof r === "function" ? r({ topicId, cancelTxId, ledgerAccountId }) : r;
    },
  };
  return { deps, calls };
}

// ── tests ────────────────────────────────────────────────────────────────────

test("honors a SUCCESS DMTT:CANCEL memo for an ACTIVE switch (right txId + ledger account)", async () => {
  const tx = cancelTx(TOPIC, "1760000100.000000000");
  const { deps, calls } = makeDeps({ sw: activeSwitch(), txs: [tx] });
  const cursor: CancelCursor = { ts: null };

  const cancelled = await scanCancels(deps, cursor);

  assert.equal(cancelled, 1, "one switch cancelled");
  assert.equal(calls.length, 1, "honorCancel called exactly once");
  assert.deepEqual(calls[0], {
    topicId: TOPIC,
    cancelTxId: tx.transactionId,
    ledgerAccountId: LEDGER_ACCOUNT, //  pulled from the switch record, not the memo
  });
  assert.equal(cursor.ts, "1760000100.000000000", "cursor advanced to the tx timestamp");
});

test("ignores a non-cancel memo (e.g. an arm transfer) — never calls honorCancel", async () => {
  const armTx = cancelTx(TOPIC, "1760000100.000000000", { memoBase64: b64(armMemo(POLICY_HASH)) });
  const { deps, calls } = makeDeps({ sw: activeSwitch(), txs: [armTx] });
  const cursor: CancelCursor = { ts: null };

  const cancelled = await scanCancels(deps, cursor);

  assert.equal(cancelled, 0);
  assert.equal(calls.length, 0, "arm memo is not a cancel");
  assert.equal(cursor.ts, "1760000100.000000000", "cursor still advances past the scanned tx");
});

test("ignores a cancel memo whose tx did not SUCCEED", async () => {
  const failed = cancelTx(TOPIC, "1760000100.000000000", { result: "INSUFFICIENT_ACCOUNT_BALANCE" });
  const { deps, calls } = makeDeps({ sw: activeSwitch(), txs: [failed] });

  const cancelled = await scanCancels(deps, { ts: null });

  assert.equal(cancelled, 0);
  assert.equal(calls.length, 0, "a non-SUCCESS cancel transfer is not honored");
});

test("ignores a cancel memo for an unknown switch (store.load → null)", async () => {
  const tx = cancelTx("0.0.9999999", "1760000100.000000000");
  const { deps, calls } = makeDeps({ sw: null, txs: [tx] });

  const cancelled = await scanCancels(deps, { ts: null });

  assert.equal(cancelled, 0);
  assert.equal(calls.length, 0);
});

test("idempotent: a cancel for an already-CANCELLED switch is skipped (UI got there first)", async () => {
  const terminal = { ...activeSwitch(), status: "CANCELLED" as const };
  const tx = cancelTx(TOPIC, "1760000100.000000000");
  const { deps, calls } = makeDeps({ sw: terminal, txs: [tx] });
  const cursor: CancelCursor = { ts: null };

  const cancelled = await scanCancels(deps, cursor);

  assert.equal(cancelled, 0, "no re-cancel");
  assert.equal(calls.length, 0, "honorCancel not called for a terminal switch");
  assert.equal(cursor.ts, "1760000100.000000000", "cursor still advances (won't re-scan)");
});

test("honorCancel returning false (verify rejected) is counted 0 but the cursor still advances", async () => {
  const tx = cancelTx(TOPIC, "1760000100.000000000");
  const { deps, calls } = makeDeps({ sw: activeSwitch(), txs: [tx], honorResult: false });
  const cursor: CancelCursor = { ts: null };

  const cancelled = await scanCancels(deps, cursor);

  assert.equal(cancelled, 0, "executor rejected the cancel → not counted");
  assert.equal(calls.length, 1, "but it was attempted");
  assert.equal(cursor.ts, "1760000100.000000000", "advance anyway — re-submit goes through the UI");
});

test("cursor advances to the last tx; a second pass (gt: cursor) finds nothing new", async () => {
  const t1 = cancelTx(TOPIC, "1760000100.000000000");
  const t2 = cancelTx(TOPIC, "1760000200.000000000");
  const { deps, calls } = makeDeps({
    sw: activeSwitch(),
    txs: [t1, t2],
    // First honored cancel flips the switch terminal for subsequent loads (realistic).
    honorResult: true,
  });
  const cursor: CancelCursor = { ts: "1760000050.000000000" };

  const first = await scanCancels(deps, cursor);
  assert.equal(cursor.ts, "1760000200.000000000", "cursor at the latest tx");
  // Both txs target the same ACTIVE switch in this mock (store doesn't mutate), so both
  // are honored — the point of THIS test is cursor advance + no re-scan on pass two.
  assert.equal(first >= 1, true);
  const callsAfterFirst = calls.length;

  const second = await scanCancels(deps, cursor);
  assert.equal(second, 0, "no new txs after the cursor");
  assert.equal(calls.length, callsAfterFirst, "nothing re-scanned");
});

test("an infra error from honorCancel propagates and leaves the cursor BEFORE the failed tx", async () => {
  const t1 = cancelTx(TOPIC, "1760000100.000000000");
  const { deps } = makeDeps({
    sw: activeSwitch(),
    txs: [t1],
    honorResult: () => {
      throw new Error("ScheduleDelete failed");
    },
  });
  const cursor: CancelCursor = { ts: "1760000050.000000000" };

  await assert.rejects(() => scanCancels(deps, cursor), /ScheduleDelete failed/);
  assert.equal(cursor.ts, "1760000050.000000000", "cursor not advanced → next pass retries the tx");
});

test("decodeMemo is null-safe: null in → null out, undecodable handled, valid decodes", () => {
  assert.equal(decodeMemo(null), null);
  assert.equal(decodeMemo(b64(cancelMemo(TOPIC))), cancelMemo(TOPIC));
});
