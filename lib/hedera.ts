// lib/hedera.ts — WS-B: the HederaSurface implementation (Phase 3, wave 1).
//
// Design split (CRITICAL for testability): all PURE logic — mirror-verify parsing,
// topic-message parsing, ciphertext chunk split/join, medium selection by size —
// lives in pure functions that take INJECTED data/fetch, so lib/hedera.test.ts can
// cover them with NO network and NO SDK. The SDK + network ops (FileCreate/Append/
// Update, FileContentsQuery, TopicCreate/Submit, ScheduleCreate/Delete) are exercised
// only by the gated integration script (scripts/integration-hedera.ts), at the M1 gate.
//
// House rules honored: relative imports with explicit .ts extensions, NO @/ alias,
// erasable TypeScript only (no enums/namespaces/decorators/parameter-properties), and
// the SDK Client is constructed LAZILY — importing this module with no creds must not
// throw (the executors and other modules import `hedera` unconditionally).

import {
  Client,
  PrivateKey,
  AccountId,
  TopicCreateTransaction,
  TopicMessageSubmitTransaction,
  ScheduleCreateTransaction,
  ScheduleDeleteTransaction,
  Timestamp,
  FileCreateTransaction,
  FileContentsQuery,
  KeyList,
  TransferTransaction,
  Hbar,
} from "@hiero-ledger/sdk";

import {
  FAST_PATH_MAX_BYTES,
  type StorageRef,
  type SwitchEvent,
  type ReleaseAuthorizedEvent,
  type MirrorVerifyResult,
  type MirrorTopicMessage,
  type MirrorTransaction,
  type HederaSurface,
  type TopicId,
  type ScheduleId,
  type FileId,
  type TxId,
  type AccountId as AccountIdStr,
  type UnixMs,
} from "./types.ts";
import { env, mirrorBase, hasHederaCreds } from "./env.ts";

// ─────────────────────────────────────────────────────────────────────────────
// PURE: medium selection by size.
// ─────────────────────────────────────────────────────────────────────────────

/** ≤ FAST_PATH_MAX_BYTES ⇒ "hfs" (single immutable FileCreate); larger ⇒ "hcs"
 *  (chunked across a dedicated storage topic). See docs/CONTRACTS.md §2. */
export function selectMedium(byteLength: number): "hfs" | "hcs" {
  return byteLength <= FAST_PATH_MAX_BYTES ? "hfs" : "hcs";
}

// ─────────────────────────────────────────────────────────────────────────────
// PURE: ciphertext chunk split/join for the HCS large path.
// ─────────────────────────────────────────────────────────────────────────────

/** HCS message payload cap is 1024 bytes per message. We carry RAW ciphertext bytes
 *  in each topic message (base64 happens at the SDK boundary, not here), so a 1000-byte
 *  raw chunk stays well under the cap. Kept as a named constant so the integration
 *  script and tests agree on the split. */
export const HCS_CHUNK_BYTES = 1000;

/** Split bytes into ≤ chunkSize pieces, in order. Each returned chunk is a *copy*
 *  (subarray view sliced) so callers can mutate/zero originals safely. */
export function splitChunks(bytes: Uint8Array, chunkSize: number = HCS_CHUNK_BYTES): Uint8Array[] {
  if (chunkSize <= 0) throw new Error("chunkSize must be > 0");
  const out: Uint8Array[] = [];
  for (let off = 0; off < bytes.length; off += chunkSize) {
    out.push(bytes.slice(off, Math.min(off + chunkSize, bytes.length)));
  }
  // An empty input still produces zero chunks; callers that need a sentinel handle it.
  return out;
}

/** Concatenate ordered chunks back into one Uint8Array (inverse of splitChunks). */
export function joinChunks(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// PURE: mirror-verify (S4 recipe) — fetch INJECTED so tests need no network.
// ─────────────────────────────────────────────────────────────────────────────

/** A minimal Response-like shape so tests can inject a stub without a real fetch. */
type FetchLike = (input: string, init?: { headers?: Record<string, string> }) => Promise<{
  status: number;
  json: () => Promise<unknown>;
}>;

/** The S4 recipe (docs/CONTRACTS.md §7) — the ONLY way arm/cancel are authorized.
 *  Fetch the tx by id and assert all three: result === "SUCCESS"; decoded memo ===
 *  expectedMemo (null-guarding memo_base64 BEFORE decode); a transfers[] debit from
 *  debitAccountId (a debit is cryptographic proof the device signed). No signature code.
 *
 *  `fetchFn` defaults to globalThis.fetch; tests inject a Response-like stub. */
export async function mirrorVerifyTransfer(
  base: string,
  txId: TxId,
  opts: { expectedMemo?: string; debitAccountId?: AccountIdStr } = {},
  fetchFn: FetchLike = globalThis.fetch as unknown as FetchLike,
): Promise<MirrorVerifyResult> {
  const expectedMemo = opts.expectedMemo;
  const debitAccountId = opts.debitAccountId;

  const url = `${base.replace(/\/$/, "")}/api/v1/transactions/${encodeURIComponent(txId)}`;
  let status = 0;
  let json: unknown = null;
  try {
    const res = await fetchFn(url, { headers: { accept: "application/json" } });
    status = res.status;
    json = res.status === 200 ? await res.json() : null;
  } catch {
    // Network/parse failure → treat as not_found (the executor errs toward "unverified").
    return notFound();
  }

  if (status === 404 || json == null) return notFound();

  const txs = (json as { transactions?: unknown[] }).transactions;
  const tx = Array.isArray(txs) ? (txs[0] as MirrorTxRaw | undefined) : undefined;
  if (!tx) return empty();

  // (2) null-guard memo_base64 BEFORE decoding — mirror returns null for no-memo txs.
  const memo =
    tx.memo_base64 == null
      ? null
      : Buffer.from(tx.memo_base64, "base64").toString("utf8");
  // (3) a transfers[] debit from the expected account proves the device signed.
  const debitAmount =
    debitAccountId == null
      ? null
      : (tx.transfers ?? []).find((t) => t.account === debitAccountId && t.amount < 0)?.amount ?? null;
  const debited = debitAmount == null ? false : debitAmount < 0;

  const checks = {
    success: tx.result === "SUCCESS", //                                    (1)
    memoMatch: expectedMemo == null ? null : memo === expectedMemo, //      (2)
    debit: debitAccountId == null ? null : debited, //                      (3)
  };
  const ok = checks.success && checks.memoMatch !== false && checks.debit !== false;

  return {
    ok,
    result: tx.result,
    memo,
    checks,
    transactionId: tx.transaction_id,
    consensusTimestamp: tx.consensus_timestamp,
    debitAmountTinybar: debitAmount,
  };
}

/** Raw mirror tx shape (snake_case from REST). Internal — typed shape is MirrorVerifyResult. */
interface MirrorTxRaw {
  transaction_id?: TxId;
  result?: string;
  memo_base64?: string | null;
  consensus_timestamp?: string;
  transfers?: Array<{ account: AccountIdStr; amount: number }>;
}

function notFound(): MirrorVerifyResult {
  return { ok: false, checks: { success: false, memoMatch: null, debit: null }, reason: "not_found" };
}
function empty(): MirrorVerifyResult {
  return { ok: false, checks: { success: false, memoMatch: null, debit: null }, reason: "empty" };
}

// ─────────────────────────────────────────────────────────────────────────────
// PURE: topic-message parsing (mirror REST → MirrorTopicMessage).
// ─────────────────────────────────────────────────────────────────────────────

/** Map the mirror's /topics/{id}/messages rows to the typed MirrorTopicMessage shape.
 *  Pure (no fetch): the network read lives in listTopicMessages, this is the parser. */
export function parseTopicMessages(json: unknown): MirrorTopicMessage[] {
  const rows = (json as { messages?: unknown[] } | null)?.messages;
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => {
    const row = r as { sequence_number?: number; consensus_timestamp?: string; message?: string };
    return {
      sequenceNumber: Number(row.sequence_number),
      consensusTimestamp: String(row.consensus_timestamp ?? ""),
      contents: String(row.message ?? ""),
    } satisfies MirrorTopicMessage;
  });
}

export function topicMessagesUrl(base: string, topicId: TopicId, afterSeq?: number): string {
  const seqClause = afterSeq != null && afterSeq > 0 ? `&sequencenumber=gt:${afterSeq}` : "";
  return `${base.replace(/\/$/, "")}/api/v1/topics/${topicId}/messages?limit=100&order=asc${seqClause}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// PURE: account-transaction parsing (mirror REST → MirrorTransaction). Feeds the
// watcher's cancel backstop (Phase 5): scan the AGENT account's inbound transfers
// for device-signed DMTT:CANCEL:<topicId> memos (the cancel authority is the on-chain
// transfer, not the /api/cancel call — C1). The decode + verify recipe is the same
// mirrorVerifyTransfer the executor re-runs before honoring.
// ─────────────────────────────────────────────────────────────────────────────

/** Map the mirror's /api/v1/transactions rows to the typed MirrorTransaction shape.
 *  Pure (no fetch): the network read lives in mirrorAccountTransactions. */
export function parseAccountTransactions(json: unknown): MirrorTransaction[] {
  const rows = (json as { transactions?: unknown[] } | null)?.transactions;
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => {
    const row = r as MirrorTxRaw;
    return {
      transactionId: String(row.transaction_id ?? ""),
      result: String(row.result ?? ""),
      memoBase64: row.memo_base64 ?? null,
      consensusTimestamp: String(row.consensus_timestamp ?? ""),
      transfers: Array.isArray(row.transfers) ? row.transfers : [],
    } satisfies MirrorTransaction;
  });
}

/** Build the mirror URL for an account's transactions, consensus order, paged forward
 *  from `afterTimestamp` ("secs.nanos"). NB: /api/v1/accounts/{id}/transactions is a 404
 *  (CLAUDE.md C1) — the account.id query param is the supported form. */
export function accountTransactionsUrl(
  base: string,
  accountId: AccountIdStr,
  afterTimestamp?: string,
): string {
  const tsClause = afterTimestamp ? `&timestamp=gt:${encodeURIComponent(afterTimestamp)}` : "";
  return `${base.replace(/\/$/, "")}/api/v1/transactions?account.id=${encodeURIComponent(accountId)}&order=asc&limit=100${tsClause}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Operator key parsing (ported from spikes/_lib.mjs).
// ─────────────────────────────────────────────────────────────────────────────

// Hedera keys: DER-encoded start with 0x30; raw 32-byte hex is ambiguous ECDSA/ED25519.
// Picking the wrong curve yields a valid-looking key that fails INVALID_SIGNATURE, so
// honor an explicit HEDERA_KEY_TYPE and default raw hex to ECDSA (testnet faucet default).
export function parseOperatorKey(raw: string): PrivateKey {
  const key = raw.trim();
  const type = (env("HEDERA_KEY_TYPE") ?? "").toUpperCase();
  const isDer = /^(0x)?30/.test(key);
  const order =
    type === "ECDSA"
      ? ["fromStringECDSA"]
      : type === "ED25519"
        ? ["fromStringED25519"]
        : isDer
          ? ["fromStringDer", "fromStringECDSA", "fromStringED25519"]
          : ["fromStringECDSA", "fromStringED25519", "fromStringDer"];
  for (const fn of [...order, "fromString"]) {
    try {
      const f = (PrivateKey as unknown as Record<string, (k: string) => PrivateKey>)[fn];
      if (typeof f === "function") return f(key);
    } catch {
      /* try the next parser */
    }
  }
  throw new Error("could not parse HEDERA_OPERATOR_KEY");
}

// ─────────────────────────────────────────────────────────────────────────────
// SDK client bootstrap (LAZY — never at module load).
// ─────────────────────────────────────────────────────────────────────────────

interface OperatorContext {
  client: Client;
  operatorId: AccountId;
  operatorKey: PrivateKey;
}

let _cached: OperatorContext | null = null;

/** Build (and cache) the SDK Client + operator key from env. Throws when creds are
 *  absent — only called from SDK ops, never at import time. */
function operator(): OperatorContext {
  if (_cached) return _cached;
  const id = env("HEDERA_OPERATOR_ID");
  const rawKey = env("HEDERA_OPERATOR_KEY");
  if (!id || !rawKey) throw new Error("missing HEDERA_OPERATOR_ID / HEDERA_OPERATOR_KEY");
  const net = (env("HEDERA_NETWORK") ?? "testnet").toLowerCase();
  const client = net === "mainnet" ? Client.forMainnet() : Client.forTestnet();
  const operatorKey = parseOperatorKey(rawKey);
  const operatorId = AccountId.fromString(id);
  client.setOperator(operatorId, operatorKey);
  _cached = { client, operatorId, operatorKey };
  return _cached;
}

// ─────────────────────────────────────────────────────────────────────────────
// SDK ops: file read (FileContentsQuery), used by the file route + HFS reads.
// ─────────────────────────────────────────────────────────────────────────────

/** Read raw HFS file bytes through the backend FileContentsQuery proxy (the mirror
 *  serves no file bytes). Used by app/api/file/[fileId] and readCiphertext (HFS). */
export async function readFileBytes(fileId: FileId): Promise<Uint8Array> {
  const { client } = operator();
  const bytes = await new FileContentsQuery().setFileId(fileId).execute(client);
  return Uint8Array.from(bytes);
}

// ─────────────────────────────────────────────────────────────────────────────
// HederaSurface — the WS-B slice the executors depend on.
// ─────────────────────────────────────────────────────────────────────────────

export function createHedera(): HederaSurface {
  // The returned object closes over operator() (lazy): the SDK Client is only built
  // when the FIRST SDK op runs. The pure methods (verifyTransfer, listTopicMessages)
  // touch only the mirror REST + the pure parsers above.

  async function storeCiphertext(ciphertext: Uint8Array): Promise<StorageRef> {
    if (selectMedium(ciphertext.length) === "hfs") {
      // ≤4 KB fast path: a single immutable FileCreate (empty KeyList).
      const { client } = operator();
      const receipt = await (
        await new FileCreateTransaction()
          .setKeys(new KeyList()) // empty KeyList → immutable from creation
          .setContents(ciphertext)
          .execute(client)
      ).getReceipt(client);
      const fileId = receipt.fileId;
      if (!fileId) throw new Error("FileCreate returned no fileId");
      return { kind: "hfs", fileId: fileId.toString(), bytes: ciphertext.length };
    }

    // >4 KB large path: a DEDICATED storage topic, ciphertext split across ordered
    // TopicMessageSubmit messages, reassembled from the mirror at reveal.
    const { client, operatorKey } = operator();
    const topicReceipt = await (
      await new TopicCreateTransaction()
        .setSubmitKey(operatorKey.publicKey) // agent-only submit (anti-spam)
        .setAdminKey(operatorKey.publicKey)
        .execute(client)
    ).getReceipt(client);
    const storageTopic = topicReceipt.topicId;
    if (!storageTopic) throw new Error("TopicCreate returned no topicId");

    const chunks = splitChunks(ciphertext);
    for (const chunk of chunks) {
      await (
        await new TopicMessageSubmitTransaction()
          .setTopicId(storageTopic)
          .setMessage(chunk)
          .execute(client)
      ).getReceipt(client);
    }
    return { kind: "hcs", topicId: storageTopic.toString(), chunks: chunks.length, bytes: ciphertext.length };
  }

  async function readCiphertext(ref: StorageRef): Promise<Uint8Array> {
    if (ref.kind === "hfs") return readFileBytes(ref.fileId);
    // HCS: read all chunk messages from the mirror, sort by sequenceNumber, base64-decode
    // each payload, join, then slice to the recorded byte length.
    const messages = await listTopicMessages(ref.topicId);
    const ordered = [...messages].sort((a, b) => a.sequenceNumber - b.sequenceNumber);
    const decoded = ordered.map((m) => Uint8Array.from(Buffer.from(m.contents, "base64")));
    const joined = joinChunks(decoded);
    return joined.length > ref.bytes ? joined.slice(0, ref.bytes) : joined;
  }

  async function createTopic(): Promise<TopicId> {
    const { client, operatorKey } = operator();
    const receipt = await (
      await new TopicCreateTransaction()
        .setSubmitKey(operatorKey.publicKey) // anti-spam; scheduled message still fires
        .setAdminKey(operatorKey.publicKey)
        .execute(client)
    ).getReceipt(client);
    const topicId = receipt.topicId;
    if (!topicId) throw new Error("TopicCreate returned no topicId");
    return topicId.toString();
  }

  async function submitEvent(topicId: TopicId, event: SwitchEvent): Promise<{ seq: number; txId: TxId }> {
    const { client } = operator();
    const message = Buffer.from(JSON.stringify(event), "utf8");
    const resp = await new TopicMessageSubmitTransaction()
      .setTopicId(topicId)
      .setMessage(message)
      .setMaxChunks(64) // proofs (~1–2 KB) can exceed the 1 KB single-message cap; chunk
      .execute(client);
    const receipt = await resp.getReceipt(client);
    const seq = receipt.topicSequenceNumber;
    return {
      seq: seq == null ? -1 : Number(seq.toString()),
      txId: resp.transactionId.toString(),
    };
  }

  async function scheduleRelease(
    topicId: TopicId,
    event: ReleaseAuthorizedEvent,
    deadline: UnixMs,
  ): Promise<ScheduleId> {
    const { client, operatorKey } = operator();
    const inner = new TopicMessageSubmitTransaction()
      .setTopicId(topicId)
      .setMessage(Buffer.from(JSON.stringify(event), "utf8")); // RELEASE_AUTHORIZED ≤1 KB (no chunking)
    const deadlineSec = Math.floor(deadline / 1000);
    const receipt = await (
      await new ScheduleCreateTransaction()
        .setScheduledTransaction(inner)
        .setExpirationTime(new Timestamp(deadlineSec, 0))
        .setWaitForExpiry(true) // fires at expiry, no trigger
        .setAdminKey(operatorKey.publicKey) // deletable on check-in/cancel
        .execute(client)
    ).getReceipt(client);
    const scheduleId = receipt.scheduleId;
    if (!scheduleId) throw new Error("ScheduleCreate returned no scheduleId");
    return scheduleId.toString();
  }

  async function deleteSchedule(scheduleId: ScheduleId): Promise<void> {
    const { client } = operator();
    await (
      await new ScheduleDeleteTransaction().setScheduleId(scheduleId).execute(client)
    ).getReceipt(client);
  }

  async function verifyTransfer(
    txId: TxId,
    opts: { expectedMemo?: string; debitAccountId?: AccountIdStr },
  ): Promise<MirrorVerifyResult> {
    return mirrorVerifyTransfer(mirrorBase(), txId, opts);
  }

  async function listTopicMessages(topicId: TopicId, afterSeq?: number): Promise<MirrorTopicMessage[]> {
    const url = topicMessagesUrl(mirrorBase(), topicId, afterSeq);
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (res.status !== 200) return [];
    return parseTopicMessages(await res.json());
  }

  return {
    storeCiphertext,
    readCiphertext,
    createTopic,
    submitEvent,
    scheduleRelease,
    deleteSchedule,
    verifyTransfer,
    listTopicMessages,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Lazy singleton — `hedera` delegates to createHedera() on first SDK call. Importing
// this module with NO creds must not throw (createHedera builds no Client until an op
// runs), so we build the surface eagerly but the Client stays lazy inside it.
// ─────────────────────────────────────────────────────────────────────────────

let _surface: HederaSurface | null = null;
function surface(): HederaSurface {
  if (!_surface) _surface = createHedera();
  return _surface;
}

export const hedera: HederaSurface = {
  storeCiphertext: (c) => surface().storeCiphertext(c),
  readCiphertext: (r) => surface().readCiphertext(r),
  createTopic: () => surface().createTopic(),
  submitEvent: (t, e) => surface().submitEvent(t, e),
  scheduleRelease: (t, e, d) => surface().scheduleRelease(t, e, d),
  deleteSchedule: (s) => surface().deleteSchedule(s),
  verifyTransfer: (t, o) => surface().verifyTransfer(t, o),
  listTopicMessages: (t, a) => surface().listTopicMessages(t, a),
};

/** Agent → recipient CryptoTransfer (the watcher's autonomous release-bounty payment).
 *  Standalone (not on HederaSurface): the watcher imports it directly. */
export async function payHbar(toAccountId: string, amountHbar: number, memo?: string): Promise<TxId> {
  const { client, operatorId } = operator();
  const tx = new TransferTransaction()
    .addHbarTransfer(operatorId, Hbar.fromTinybars(Math.round(-amountHbar * 100_000_000)))
    .addHbarTransfer(AccountId.fromString(toAccountId), Hbar.fromTinybars(Math.round(amountHbar * 100_000_000)));
  if (memo) tx.setTransactionMemo(memo);
  const resp = await tx.execute(client);
  await resp.getReceipt(client);
  return resp.transactionId.toString();
}

/** Page the agent account's transactions from the mirror (consensus order, after a
 *  timestamp cursor). Standalone (NOT on HederaSurface — keeps the frozen contract
 *  intact): the watcher cancel backstop imports it directly. Returns [] on non-200. */
export async function mirrorAccountTransactions(
  accountId: AccountIdStr,
  afterTimestamp?: string,
): Promise<MirrorTransaction[]> {
  const url = accountTransactionsUrl(mirrorBase(), accountId, afterTimestamp);
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (res.status !== 200) return [];
  return parseAccountTransactions(await res.json());
}

/** Re-export for the file route / callers that want the creds gate. */
export { hasHederaCreds };
