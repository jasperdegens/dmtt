// Shared spike helpers. Throwaway probe support — but mirrorVerifyTransfer and the
// Hedera client bootstrap are written cleanly so Phase 3 can lift them into lib/.
import { readFileSync, existsSync } from "node:fs";
import { Client, PrivateKey, AccountId } from "@hiero-ledger/sdk";

// ── env ────────────────────────────────────────────────────────────────────
// Minimal .env loader: real shell vars win, then .env.local, then .env.
export function loadEnv() {
  for (const f of [".env.local", ".env"]) {
    if (!existsSync(f)) continue;
    for (const line of readFileSync(f, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!m) continue;
      const [, key] = m;
      if (key in process.env) continue;
      let val = m[2];
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      process.env[key] = val;
    }
  }
}
loadEnv();

// ── logging ──────────────────────────────────────────────────────────────────
const C = { reset: "\x1b[0m", red: "\x1b[31m", grn: "\x1b[32m", yel: "\x1b[33m", cyn: "\x1b[36m", dim: "\x1b[2m" };
export const section = (t) => console.log(`\n${C.cyn}━━ ${t} ━━${C.reset}`);
export const info = (t) => console.log(`   ${C.dim}•${C.reset} ${t}`);
export const pass = (t) => console.log(`   ${C.grn}✓${C.reset} ${t}`);
export const warn = (t) => console.log(`   ${C.yel}!${C.reset} ${t}`);
export const fail = (t) => { console.log(`   ${C.red}✗ ${t}${C.reset}`); process.exitCode = 1; };
export const skip = (t) => { console.log(`   ${C.yel}⏭ skipped:${C.reset} ${t}`); };
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── mirror node REST ──────────────────────────────────────────────────────────
export function mirrorBase() {
  if (process.env.HEDERA_MIRROR_URL) return process.env.HEDERA_MIRROR_URL.replace(/\/$/, "");
  return (process.env.HEDERA_NETWORK || "testnet").toLowerCase() === "mainnet"
    ? "https://mainnet-public.mirrornode.hedera.com"
    : "https://testnet.mirrornode.hedera.com";
}

export async function mirrorGet(path) {
  const url = path.startsWith("http") ? path : mirrorBase() + path;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  const json = res.status === 200 ? await res.json() : null;
  return { status: res.status, json, url };
}

// S4 — the ONLY way arm/cancel are authorized: read the chain, assert three facts.
// A confirmed transfer that DEBITS the Ledger account is cryptographic proof the
// device signed (Hedera requires every debited account to sign). No signature code.
export async function mirrorVerifyTransfer(txId, { expectedMemo = null, debitAccountId = null } = {}) {
  const { status, json } = await mirrorGet(`/api/v1/transactions/${encodeURIComponent(txId)}`);
  if (status === 404 || !json) return { ok: false, reason: "not_found", status };
  const tx = (json.transactions || [])[0];
  if (!tx) return { ok: false, reason: "empty", status };

  // (2) null-guard memo_base64 BEFORE decoding — mirror returns null for no-memo txs.
  const memo = tx.memo_base64 == null ? null : Buffer.from(tx.memo_base64, "base64").toString("utf8");
  // (3) a transfers[] debit from the expected account.
  const debit = (tx.transfers || []).find((t) => t.account === debitAccountId && t.amount < 0);

  const checks = {
    success: tx.result === "SUCCESS",                                  // (1)
    memoMatch: expectedMemo == null ? null : memo === expectedMemo,    // (2)
    debit: debitAccountId == null ? null : !!debit,                    // (3)
  };
  const ok = checks.success && checks.memoMatch !== false && checks.debit !== false;
  return { ok, result: tx.result, memo, debit, checks, transactionId: tx.transaction_id, consensusTimestamp: tx.consensus_timestamp };
}

// ── Hedera client (S2/S3) ─────────────────────────────────────────────────────
export function hederaClientOrSkip(spikeName) {
  const id = process.env.HEDERA_OPERATOR_ID;
  const key = process.env.HEDERA_OPERATOR_KEY;
  if (!id || !key || id.includes("xxxx") || !key.trim()) {
    skip(`${spikeName}: needs HEDERA_OPERATOR_ID + HEDERA_OPERATOR_KEY (testnet) in .env.local`);
    return null;
  }
  const net = (process.env.HEDERA_NETWORK || "testnet").toLowerCase();
  const client = net === "mainnet" ? Client.forMainnet() : Client.forTestnet();
  let pk;
  for (const fn of ["fromStringDer", "fromStringECDSA", "fromStringED25519", "fromString"]) {
    try { pk = PrivateKey[fn](key); break; } catch { /* try next */ }
  }
  if (!pk) { fail(`${spikeName}: could not parse HEDERA_OPERATOR_KEY`); return null; }
  client.setOperator(AccountId.fromString(id), pk);
  return { client, operatorId: AccountId.fromString(id), operatorKey: pk, network: net };
}
