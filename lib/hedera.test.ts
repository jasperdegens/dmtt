// lib/hedera.test.ts — WS-B self-verification (node --test --test-reporter=spec).
//
// PURE coverage only: every test here injects a fetch stub or feeds bytes directly, so
// NO network and NO SDK Client is ever constructed. The SDK + live-mirror round-trips
// are exercised by scripts/integration-hedera.ts (gated on Hedera creds) at the M1 gate.
//
// The negative paths are the point (CLAUDE.md "Definition of done"): a non-SUCCESS tx,
// a wrong memo, a missing Ledger debit, and a no-memo (null memo_base64) tx must all be
// reflected in `checks` and drive `ok` false (except the null-memo case, which must NOT
// throw thanks to the memo_base64 null-guard).

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  mirrorVerifyTransfer,
  topicMessagesUrl,
  accountTransactionsUrl,
  parseAccountTransactions,
  selectMedium,
  splitChunks,
  joinChunks,
  HCS_CHUNK_BYTES,
} from "./hedera.ts";
import { FAST_PATH_MAX_BYTES, armMemo } from "./types.ts";

// NOTE: we deliberately do NOT import lib/fixtures.ts here. That frozen module uses
// EXTENSIONLESS relative imports ("./types"), which Node's native TS resolver can't
// follow under `node --test` — importing it would break this whole file. So the raw
// mirror-tx row below is inlined to mirror the SHAPE of mirrorTransactionFixture
// (snake_case, the actual /transactions REST shape) without the broken dependency.

// ─────────────────────────────────────────────────────────────────────────────
// Helpers — a RAW mirror REST row (snake_case) + a fetch stub returning a
// Response-like { status, json }.
// ─────────────────────────────────────────────────────────────────────────────

const BASE = "https://testnet.mirrornode.hedera.com";
const TX_ID = "0.0.1234567-1760000000-000000000";
const LEDGER_ACCOUNT = "0.0.1234567"; // the debited account (amount < 0)
const POLICY_HASH = "5e69cb3137841c36cc5a6aafcea18e8d81f5dbe654eca0f4e64f652539ba5285";
const EXPECTED_MEMO = armMemo(POLICY_HASH); // "DMTT:ARM:5e69cb…"

/** The raw row the mirror's /transactions/{id} endpoint returns (snake_case). Mirrors
 *  the shape of fixtures.mirrorTransactionFixture: a SUCCESS arm transfer that DEBITS
 *  the Ledger account and carries the arm memo (base64). `over` patches result/memo. */
function rawTx(over: Partial<{ result: string; memo_base64: string | null }> = {}) {
  return {
    transaction_id: TX_ID,
    result: over.result ?? "SUCCESS",
    memo_base64:
      "memo_base64" in over
        ? over.memo_base64
        : Buffer.from(EXPECTED_MEMO, "utf8").toString("base64"),
    consensus_timestamp: "1760000000.000000001",
    transfers: [
      { account: LEDGER_ACCOUNT, amount: -5_000_000_000 },
      { account: "0.0.2000000", amount: 5_000_000_000 },
    ],
  };
}

/** A fetch stub that returns `body` as JSON with the given HTTP status. */
function stubFetch(status: number, body: unknown) {
  return async () => ({ status, json: async () => body });
}

// ── mirrorVerifyTransfer ─────────────────────────────────────────────────────

test("mirrorVerifyTransfer: arm-memo happy path → ok, all checks true, memo decoded", async () => {
  const fetchFn = stubFetch(200, { transactions: [rawTx()] });
  const r = await mirrorVerifyTransfer(
    BASE,
    TX_ID,
    { expectedMemo: EXPECTED_MEMO, debitAccountId: LEDGER_ACCOUNT },
    fetchFn,
  );
  assert.equal(r.ok, true);
  assert.equal(r.result, "SUCCESS");
  assert.equal(r.memo, EXPECTED_MEMO);
  assert.deepEqual(r.checks, { success: true, memoMatch: true, debit: true });
  assert.equal(r.transactionId, TX_ID);
});

test("mirrorVerifyTransfer: result !== SUCCESS → checks.success false, ok false", async () => {
  const fetchFn = stubFetch(200, {
    transactions: [rawTx({ result: "INSUFFICIENT_PAYER_BALANCE" })],
  });
  const r = await mirrorVerifyTransfer(
    BASE,
    TX_ID,
    { expectedMemo: EXPECTED_MEMO, debitAccountId: LEDGER_ACCOUNT },
    fetchFn,
  );
  assert.equal(r.checks.success, false);
  assert.equal(r.ok, false);
});

test("mirrorVerifyTransfer: wrong expectedMemo → checks.memoMatch false, ok false", async () => {
  const fetchFn = stubFetch(200, { transactions: [rawTx()] });
  const r = await mirrorVerifyTransfer(
    BASE,
    TX_ID,
    { expectedMemo: armMemo("0".repeat(64)), debitAccountId: LEDGER_ACCOUNT },
    fetchFn,
  );
  assert.equal(r.checks.memoMatch, false);
  assert.equal(r.ok, false);
});

test("mirrorVerifyTransfer: debitAccountId not debited → checks.debit false, ok false", async () => {
  const fetchFn = stubFetch(200, { transactions: [rawTx()] });
  const r = await mirrorVerifyTransfer(
    BASE,
    TX_ID,
    { expectedMemo: EXPECTED_MEMO, debitAccountId: "0.0.9999999" }, // never appears as a debit
    fetchFn,
  );
  assert.equal(r.checks.debit, false);
  assert.equal(r.ok, false);
});

test("mirrorVerifyTransfer: memo_base64 null → memo null, NO throw, memoMatch false", async () => {
  const fetchFn = stubFetch(200, {
    transactions: [rawTx({ memo_base64: null })],
  });
  // Must not throw despite a null memo_base64 (the guard before decode).
  const r = await mirrorVerifyTransfer(
    BASE,
    TX_ID,
    { expectedMemo: EXPECTED_MEMO, debitAccountId: LEDGER_ACCOUNT },
    fetchFn,
  );
  assert.equal(r.memo, null);
  assert.equal(r.checks.memoMatch, false); // null memo !== expected
  assert.equal(r.ok, false);
});

test("mirrorVerifyTransfer: no expectedMemo / no debit → those checks null, ok rides success", async () => {
  const fetchFn = stubFetch(200, {
    transactions: [rawTx({ memo_base64: null })],
  });
  const r = await mirrorVerifyTransfer(BASE, TX_ID, {}, fetchFn);
  assert.equal(r.checks.memoMatch, null);
  assert.equal(r.checks.debit, null);
  assert.equal(r.ok, true); // only success required when neither opt supplied
  assert.equal(r.memo, null);
});

test("mirrorVerifyTransfer: 404 → ok false, reason not_found", async () => {
  const r = await mirrorVerifyTransfer(
    BASE,
    "0.0.1-1-1",
    { expectedMemo: EXPECTED_MEMO },
    stubFetch(404, null),
  );
  assert.equal(r.ok, false);
  assert.equal(r.reason, "not_found");
});

test("mirrorVerifyTransfer: empty transactions[] → ok false, reason empty", async () => {
  const r = await mirrorVerifyTransfer(
    BASE,
    "0.0.1-1-1",
    { expectedMemo: EXPECTED_MEMO },
    stubFetch(200, { transactions: [] }),
  );
  assert.equal(r.ok, false);
  assert.equal(r.reason, "empty");
});

test("mirrorVerifyTransfer: fetch throws → not_found (errs toward unverified)", async () => {
  const fetchFn = async () => {
    throw new Error("network down");
  };
  const r = await mirrorVerifyTransfer(BASE, "0.0.1-1-1", {}, fetchFn);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "not_found");
});

test("topicMessagesUrl: omits sequence filter for first page / afterSeq 0", () => {
  assert.equal(
    topicMessagesUrl(BASE, "0.0.9221027"),
    `${BASE}/api/v1/topics/0.0.9221027/messages?limit=100&order=asc`,
  );
  assert.equal(
    topicMessagesUrl(BASE, "0.0.9221027", 0),
    `${BASE}/api/v1/topics/0.0.9221027/messages?limit=100&order=asc`,
  );
  assert.equal(
    topicMessagesUrl(BASE, "0.0.9221027", 2),
    `${BASE}/api/v1/topics/0.0.9221027/messages?limit=100&order=asc&sequencenumber=gt:2`,
  );
});

// ── accountTransactionsUrl / parseAccountTransactions (cancel backstop) ────────

test("accountTransactionsUrl: account.id query form (NOT /accounts/{id}/transactions), gt: cursor", () => {
  // First scan (no cursor) → no timestamp filter.
  assert.equal(
    accountTransactionsUrl(BASE, "0.0.2000000"),
    `${BASE}/api/v1/transactions?account.id=0.0.2000000&order=asc&limit=100`,
  );
  // Subsequent scans page forward with timestamp=gt:<secs.nanos>.
  assert.equal(
    accountTransactionsUrl(BASE, "0.0.2000000", "1760000100.000000000"),
    `${BASE}/api/v1/transactions?account.id=0.0.2000000&order=asc&limit=100&timestamp=gt:1760000100.000000000`,
  );
});

test("parseAccountTransactions: maps snake_case rows; null memo + missing transfers safe", () => {
  const rows = parseAccountTransactions({
    transactions: [
      {
        transaction_id: "0.0.1234567-1760000100-000000000",
        result: "SUCCESS",
        memo_base64: Buffer.from("DMTT:CANCEL:0.0.7777777", "utf8").toString("base64"),
        consensus_timestamp: "1760000100.000000000",
        transfers: [
          { account: "0.0.1234567", amount: -1 },
          { account: "0.0.2000000", amount: 1 },
        ],
      },
      { transaction_id: "0.0.9-1760000200-000000000", result: "SUCCESS", memo_base64: null },
    ],
  });
  assert.equal(rows.length, 2);
  assert.equal(
    Buffer.from(rows[0].memoBase64 ?? "", "base64").toString("utf8"),
    "DMTT:CANCEL:0.0.7777777",
  );
  assert.equal(rows[0].transfers[0].amount, -1);
  assert.equal(rows[1].memoBase64, null, "null memo passes through (guarded before decode)");
  assert.deepEqual(rows[1].transfers, [], "missing transfers → []");
  // Non-array / empty input is tolerated (never throws on junk).
  assert.deepEqual(parseAccountTransactions(null), []);
  assert.deepEqual(parseAccountTransactions({}), []);
});

// ── selectMedium ─────────────────────────────────────────────────────────────

test("selectMedium: at the boundary picks hfs, one over picks hcs", () => {
  assert.equal(selectMedium(FAST_PATH_MAX_BYTES), "hfs"); // 4096
  assert.equal(selectMedium(FAST_PATH_MAX_BYTES + 1), "hcs"); // 4097
  assert.equal(selectMedium(0), "hfs");
  assert.equal(selectMedium(1_000_000), "hcs");
});

// ── splitChunks / joinChunks ─────────────────────────────────────────────────

test("splitChunks/joinChunks: 10 KB round-trips byte-identical; chunk count + caps hold", () => {
  const x = new Uint8Array(10_240);
  for (let i = 0; i < x.length; i++) x[i] = (Math.random() * 256) | 0;

  const chunks = splitChunks(x);
  assert.equal(chunks.length, Math.ceil(x.length / HCS_CHUNK_BYTES));
  for (const c of chunks) assert.ok(c.length <= HCS_CHUNK_BYTES, "each chunk ≤ cap");

  const joined = joinChunks(chunks);
  assert.equal(joined.length, x.length);
  assert.deepEqual(joined, x);
});

test("splitChunks: respects a custom chunkSize and a non-multiple length", () => {
  const x = new Uint8Array(2_500);
  const chunks = splitChunks(x, 1000);
  assert.equal(chunks.length, 3); // 1000 + 1000 + 500
  assert.equal(chunks[2].length, 500);
  assert.deepEqual(joinChunks(chunks), x);
});

test("splitChunks: empty input → zero chunks; join of [] → empty", () => {
  assert.equal(splitChunks(new Uint8Array(0)).length, 0);
  assert.equal(joinChunks([]).length, 0);
});

test("splitChunks: chunkSize ≤ 0 throws", () => {
  assert.throws(() => splitChunks(new Uint8Array(4), 0));
});
