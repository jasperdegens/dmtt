// scripts/integration-hedera.ts — GATED live WS-B integration (the M1 human gate).
//
// Runs the PLAN WS-B Verify against REAL testnet + mirror: HFS fast-path round-trip,
// HCS large-path round-trip, topic create/submit/list round-trip, a waitForExpiry
// schedule firing (observed lag), mirror-verify green vs a fresh memo'd transfer, and
// the NEGATIVE submit-without-submit-key rejection. Self-verify the WS-B SDK code that
// the pure unit tests (lib/hedera.test.ts) deliberately can't reach.
//
// NO creds ⇒ prints a clear SKIP and exits 0 (so CI / a credless `node` run is green).
// Run at M1 with HEDERA_OPERATOR_* set in .env.local. Costs real testnet ℏ.

import {
  Client,
  AccountId,
  PrivateKey,
  Hbar,
  TransferTransaction,
  TopicCreateTransaction,
  TopicMessageSubmitTransaction,
} from "@hiero-ledger/sdk";

import { env, hasHederaCreds, mirrorBase } from "../lib/env.ts";
import {
  createHedera,
  parseOperatorKey,
  selectMedium,
  splitChunks,
  HCS_CHUNK_BYTES,
} from "../lib/hedera.ts";
import type { ReleaseAuthorizedEvent, SwitchEvent } from "../lib/types.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function pass(t: string): void {
  console.log(`  PASS ${t}`);
}
function info(t: string): void {
  console.log(`  ... ${t}`);
}

async function main(): Promise<void> {
  if (!hasHederaCreds()) {
    console.log("SKIP: no Hedera creds (run at M1 with HEDERA_OPERATOR_* set)");
    process.exit(0);
  }

  console.log("WS-B integration (live testnet + mirror)");

  const id = env("HEDERA_OPERATOR_ID")!;
  const rawKey = env("HEDERA_OPERATOR_KEY")!;
  const net = (env("HEDERA_NETWORK") ?? "testnet").toLowerCase();
  const client = net === "mainnet" ? Client.forMainnet() : Client.forTestnet();
  const operatorKey: PrivateKey = parseOperatorKey(rawKey);
  const operatorId = AccountId.fromString(id);
  client.setOperator(operatorId, operatorKey);
  info(`operator ${operatorId.toString()} on ${net}`);

  const base = mirrorBase();
  const h = createHedera();

  // ── 1. HFS fast path: ≤4 KB → single immutable FileCreate, byte-identical round-trip ──
  {
    const small = randomBytes(2048);
    if (selectMedium(small.length) !== "hfs") throw new Error("expected hfs for 2 KB");
    const ref = await h.storeCiphertext(small);
    if (ref.kind !== "hfs") throw new Error(`expected hfs ref, got ${ref.kind}`);
    info(`HFS file ${ref.fileId} (${ref.bytes} B)`);
    const back = await h.readCiphertext(ref);
    assertBytesEqual(back, small, "HFS round-trip");
    pass(`HFS ≤4 KB round-trip byte-identical (${ref.fileId})`);
  }

  // ── 2. HCS large path: >4 KB → dedicated topic, chunked, reassembled from the mirror ──
  {
    const big = randomBytes(10_000); // > FAST_PATH_MAX_BYTES → hcs
    if (selectMedium(big.length) !== "hcs") throw new Error("expected hcs for 10 KB");
    const expectedChunks = Math.ceil(big.length / HCS_CHUNK_BYTES);
    const ref = await h.storeCiphertext(big);
    if (ref.kind !== "hcs") throw new Error(`expected hcs ref, got ${ref.kind}`);
    if (ref.chunks !== expectedChunks) throw new Error(`chunk count ${ref.chunks} ≠ ${expectedChunks}`);
    info(`HCS topic ${ref.topicId} (${ref.chunks} chunks, ${ref.bytes} B)`);
    // Give the mirror a moment to index the chunk messages.
    await waitForTopicCount(base, ref.topicId, ref.chunks);
    const back = await h.readCiphertext(ref);
    assertBytesEqual(back, big, "HCS round-trip");
    pass(`HCS >4 KB round-trip byte-identical (${ref.topicId}, ${ref.chunks} chunks)`);
  }

  // ── 3. Topic create + submitEvent + listTopicMessages round-trip ──────────────
  let auditTopic = "";
  {
    auditTopic = await h.createTopic();
    info(`audit topic ${auditTopic}`);
    const event: SwitchEvent = { type: "BULLETIN", seq: 0, text: "WS-B integration probe" };
    const { seq, txId } = await h.submitEvent(auditTopic, event);
    info(`submitted BULLETIN seq=${seq} tx=${txId}`);
    await waitForTopicCount(base, auditTopic, 1);
    const messages = await h.listTopicMessages(auditTopic);
    const decoded = messages.map(
      (m) => JSON.parse(Buffer.from(m.contents, "base64").toString("utf8")) as SwitchEvent,
    );
    const found = decoded.find((e) => e.type === "BULLETIN" && e.text === "WS-B integration probe");
    if (!found) throw new Error("submitted event not found in listTopicMessages");
    pass(`topic create + submitEvent + listTopicMessages round-trip (${auditTopic})`);
  }

  // ── 4. scheduleRelease fires unattended at expiry; observe the firing lag ──────
  {
    const EXPIRY_S = 75;
    const expirySec = Math.floor(Date.now() / 1000) + EXPIRY_S;
    const deadlineMs = expirySec * 1000;
    const releaseEvent: ReleaseAuthorizedEvent = {
      type: "RELEASE_AUTHORIZED",
      seq: 0,
      nonce: "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff",
    };
    const scheduleId = await h.scheduleRelease(auditTopic, releaseEvent, deadlineMs);
    info(`schedule ${scheduleId} → expiry ${new Date(deadlineMs).toISOString()} — waiting…`);
    const fired = await waitForReleaseAuthorized(base, auditTopic, expirySec);
    if (!fired) throw new Error("RELEASE_AUTHORIZED never landed after expiry");
    const lagMs = Math.round((fired.tsSeconds - expirySec) * 1000);
    pass(`scheduleRelease fired unattended — observed lag ${lagMs} ms (seq ${fired.seq})`);
  }

  // ── 5. verifyTransfer green vs a fresh memo'd CryptoTransfer (S4 recipe, live) ─
  {
    const memo = `DMTT:PROBE:${Date.now()}`;
    // 1 tinybar operator→operator self-transfer: still produces a debit from the
    // operator account (mirror-verify proof-of-signature) carrying our memo.
    const resp = await new TransferTransaction()
      .addHbarTransfer(operatorId, Hbar.fromTinybars(-1))
      .addHbarTransfer(operatorId, Hbar.fromTinybars(1))
      .setTransactionMemo(memo)
      .execute(client);
    await resp.getReceipt(client);
    const txId = resp.transactionId.toString();
    info(`probe transfer ${txId} memo="${memo}"`);
    const verified = await waitForVerify(h, txId, { expectedMemo: memo, debitAccountId: operatorId.toString() });
    if (!verified.ok) throw new Error(`verifyTransfer not green: ${JSON.stringify(verified.checks)}`);
    pass(`verifyTransfer green (SUCCESS + memo + debit) on ${txId}`);

    // Negative: a wrong expected memo must reject (memoMatch false → ok false).
    const wrong = await h.verifyTransfer(txId, { expectedMemo: "DMTT:WRONG", debitAccountId: operatorId.toString() });
    if (wrong.ok || wrong.checks.memoMatch !== false) {
      throw new Error("verifyTransfer accepted a WRONG memo");
    }
    pass("verifyTransfer rejects a wrong memo (negative)");
  }

  // ── 6. NEGATIVE: submit to a submitKey'd topic WITHOUT the key must be rejected ─
  {
    // A throwaway key the operator does NOT hold — set it as the topic's submitKey.
    const stranger = PrivateKey.generateED25519();
    const guarded = (
      await (
        await new TopicCreateTransaction()
          .setSubmitKey(stranger.publicKey)
          .setAdminKey(operatorKey.publicKey)
          .execute(client)
      ).getReceipt(client)
    ).topicId;
    if (!guarded) throw new Error("guarded TopicCreate returned no topicId");
    info(`guarded topic ${guarded.toString()} (submitKey = stranger)`);
    let rejected = false;
    try {
      await (
        await new TopicMessageSubmitTransaction()
          .setTopicId(guarded)
          .setMessage("should be rejected — operator lacks submitKey")
          .execute(client)
      ).getReceipt(client);
    } catch (e) {
      rejected = true;
      info(`rejected with: ${statusOf(e)}`);
    }
    if (!rejected) throw new Error("submit WITHOUT the submitKey unexpectedly SUCCEEDED");
    pass("submit without the submitKey rejected (negative)");
  }

  console.log("WS-B integration PASS");
  client.close();
}

// ── helpers ──────────────────────────────────────────────────────────────────

function randomBytes(n: number): Uint8Array {
  const a = new Uint8Array(n);
  for (let i = 0; i < n; i++) a[i] = (Math.random() * 256) | 0;
  return a;
}

function assertBytesEqual(a: Uint8Array, b: Uint8Array, label: string): void {
  if (a.length !== b.length) throw new Error(`${label}: length ${a.length} ≠ ${b.length}`);
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) throw new Error(`${label}: byte ${i} differs`);
  }
}

function statusOf(e: unknown): string {
  const s = (e as { status?: { toString(): string } }).status;
  return s ? s.toString() : String(e).split("\n")[0];
}

async function mirrorGet(url: string): Promise<{ status: number; json: unknown }> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  return { status: res.status, json: res.status === 200 ? await res.json() : null };
}

/** Poll the mirror until a topic has ≥ `want` messages (the chunks/messages are indexed). */
async function waitForTopicCount(base: string, topicId: string, want: number): Promise<void> {
  const deadline = Date.now() + 60_000;
  const url = `${base}/api/v1/topics/${topicId}/messages?limit=200&order=asc`;
  while (Date.now() < deadline) {
    const { status, json } = await mirrorGet(url);
    const rows = status === 200 ? (json as { messages?: unknown[] }).messages : undefined;
    if (Array.isArray(rows) && rows.length >= want) return;
    await sleep(3000);
  }
  throw new Error(`mirror never indexed ${want} messages for topic ${topicId}`);
}

/** Poll the topic past expiry until a RELEASE_AUTHORIZED message lands; return its ts/seq. */
async function waitForReleaseAuthorized(
  base: string,
  topicId: string,
  expirySec: number,
): Promise<{ tsSeconds: number; seq: number } | null> {
  const deadline = Date.now() + 150_000;
  const url = `${base}/api/v1/topics/${topicId}/messages?limit=200&order=asc`;
  while (Date.now() < deadline) {
    if (Date.now() / 1000 > expirySec - 2) {
      const { status, json } = await mirrorGet(url);
      const rows = status === 200 ? (json as { messages?: MirrorRow[] }).messages : undefined;
      if (Array.isArray(rows)) {
        for (const m of rows) {
          let event: SwitchEvent | null = null;
          try {
            event = JSON.parse(Buffer.from(m.message, "base64").toString("utf8")) as SwitchEvent;
          } catch {
            event = null;
          }
          if (event && event.type === "RELEASE_AUTHORIZED") {
            return { tsSeconds: Number(m.consensus_timestamp), seq: m.sequence_number };
          }
        }
      }
    }
    await sleep(3000);
  }
  return null;
}

/** Retry verifyTransfer until the mirror has indexed the tx (or give up green-false). */
async function waitForVerify(
  h: ReturnType<typeof createHedera>,
  txId: string,
  opts: { expectedMemo?: string; debitAccountId?: string },
) {
  const deadline = Date.now() + 60_000;
  let last = await h.verifyTransfer(txId, opts);
  while (Date.now() < deadline && !last.ok) {
    await sleep(3000);
    last = await h.verifyTransfer(txId, opts);
  }
  return last;
}

interface MirrorRow {
  message: string;
  consensus_timestamp: string;
  sequence_number: number;
}

main().catch((e) => {
  console.error("WS-B integration FAILED:", e instanceof Error ? e.stack : String(e));
  process.exit(1);
});
