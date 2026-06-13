// S4 — mirror tx-read helper (the shared arm/cancel authorization primitive).
// Public mirror node is read-only → no secrets needed. Validates the helper against
// live testnet transfers. The final end-to-end assertion (a Ledger-account debit with
// our DMTT memo) is S1's tx — set HEDERA_MIRROR_TX_ID after the device ceremony.
import { mirrorBase, mirrorGet, mirrorVerifyTransfer, section, info, pass, warn, fail } from "./_lib.mjs";

const trunc = (s, n = 48) => (s && s.length > n ? s.slice(0, n) + "…" : s);

async function main() {
  section("S4 · mirror tx-read helper");
  info(`mirror: ${mirrorBase()}`);

  // If S1's tx (or any specific tx) is pinned, run the full arm-style assertion.
  const pinned = process.env.HEDERA_MIRROR_TX_ID;
  if (pinned) {
    info(`pinned HEDERA_MIRROR_TX_ID=${pinned}`);
    const r = await mirrorVerifyTransfer(pinned, {
      expectedMemo: process.env.HEDERA_MIRROR_EXPECT_MEMO || null,
      debitAccountId: process.env.HEDERA_MIRROR_DEBIT_ACCT || null,
    });
    console.log("   " + JSON.stringify(r));
    if (r.reason) return fail(`pinned tx: ${r.reason}`);
    pass(`pinned tx parsed (result=${r.result}, memo=${r.memo === null ? "null" : JSON.stringify(trunc(r.memo))})`);
  }

  // Otherwise exercise the helper against real public testnet transfers.
  const list = await mirrorGet(`/api/v1/transactions?transactiontype=cryptotransfer&result=success&order=desc&limit=50`);
  if (list.status !== 200 || !list.json?.transactions?.length) return fail(`could not list transfers (status ${list.status})`);
  const txs = list.json.transactions;
  info(`fetched ${txs.length} recent successful CRYPTOTRANSFERs`);

  // (a) BOTH endpoint forms must return the tx (S4 requires the by-id form too).
  const sample = txs.find((t) => (t.transfers || []).some((x) => x.amount < 0)) || txs[0];
  const byId = await mirrorGet(`/api/v1/transactions/${encodeURIComponent(sample.transaction_id)}`);
  if (byId.status !== 200 || !byId.json?.transactions?.length) return fail(`by-id endpoint failed for ${sample.transaction_id}`);
  pass(`both endpoint forms return ${sample.transaction_id}`);

  // (b) SUCCESS + debit: point the helper at the sample's own debited account.
  const debitEntry = (sample.transfers || []).find((x) => x.amount < 0);
  const v = await mirrorVerifyTransfer(sample.transaction_id, { debitAccountId: debitEntry.account });
  if (!(v.ok && v.checks.success && v.checks.debit)) return fail(`debit assertion failed: ${JSON.stringify(v.checks)}`);
  pass(`SUCCESS + debit-from-${debitEntry.account} asserted (a Ledger debit here = device-signed proof)`);

  // (c) memo decode against a real non-null memo, if present in the window.
  const withMemo = txs.find((t) => t.memo_base64 && t.memo_base64.length);
  if (withMemo) {
    const expect = Buffer.from(withMemo.memo_base64, "base64").toString("utf8");
    const vm = await mirrorVerifyTransfer(withMemo.transaction_id, { expectedMemo: expect });
    if (vm.checks.memoMatch !== true) return fail(`memo decode/match failed for ${withMemo.transaction_id}`);
    pass(`real memo decoded & matched: "${trunc(vm.memo)}"`);
  } else {
    warn("no non-null memo in window — decode path covered by null-guard test below only");
  }

  // (d) NULL-GUARD: a no-memo tx must not throw.
  const noMemo = txs.find((t) => t.memo_base64 == null || t.memo_base64 === "");
  if (noMemo) {
    const vn = await mirrorVerifyTransfer(noMemo.transaction_id, {});
    pass(`null/empty memo handled (memo=${vn.memo === null ? "null" : JSON.stringify(vn.memo)})`);
  } else {
    warn("every sampled tx had a memo — null-guard not exercised this run");
  }

  // (e) Polling form the watcher/executors use: ?account.id=&timestamp=gt:&order=asc.
  const parts = sample.transaction_id.split("-"); // [acct, validStartSecs, validStartNanos]
  const payer = parts[0];
  const cursor = `${parts[1]}.${parts[2]}`; // validStart as secs.nanos (just before consensus)
  const poll = await mirrorGet(`/api/v1/transactions?account.id=${payer}&timestamp=gt:${cursor}&order=asc&limit=25`);
  if (poll.status !== 200) return fail(`polling form failed (status ${poll.status})`);
  const found = (poll.json.transactions || []).some((t) => t.transaction_id === sample.transaction_id);
  if (!found) return fail(`polling form did not return ${sample.transaction_id}`);
  pass(`account.id polling form (timestamp=gt:, order=asc) returns the tx`);

  // (f) Documented gotcha: /accounts/{id}/transactions does NOT exist.
  const gotcha = await mirrorGet(`/api/v1/accounts/${payer}/transactions`);
  if (gotcha.status === 404) pass(`/accounts/{id}/transactions correctly 404s — must use account.id query param`);
  else warn(`/accounts/{id}/transactions returned ${gotcha.status} (expected 404)`);

  section("S4 PASS (helper validated on live mirror)");
  if (!pinned) info("residual → after S1, re-run with HEDERA_MIRROR_TX_ID set for the real Ledger-debit assertion.");
}

main().catch((e) => fail(e.stack || String(e)));
