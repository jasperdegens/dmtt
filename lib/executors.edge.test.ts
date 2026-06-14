// lib/executors.edge.test.ts — WS-C extra executor edge-case tests (Phase 4).
//
// These fill the GAPS not exercised by lib/executors.test.ts. Same harness pattern:
// a fresh in-memory SwitchStore, a CALL-LOGGING HederaSurface that records call order
// + payloads, a deterministic CryptoSurface, and a flag-aware ExecutorContext.
//
// Focus (CLAUDE.md "Definition of done"): flag gating (verify on/off), no-side-effects
// on every guard rejection, create-before-delete ordering, rung-shred precision, the
// liveIdx === seq + 1 invariant across a multi-check-in walk, and nonce/schedule churn.

import { test } from "node:test";
import assert from "node:assert/strict";

import { arm, checkin, cancel } from "./executors.ts";
import { armMemo, cancelMemo } from "./types.ts";
import type {
  Switch,
  SwitchStore,
  StoreMutator,
  HederaSurface,
  CryptoSurface,
  ExecutorContext,
  ExecutorFlags,
  SwitchEvent,
  Policy,
  LadderRung,
  TopicId,
  ScheduleId,
  ReleaseAuthorizedEvent,
  MirrorVerifyResult,
  WorldVerifyRequest,
  WorldVerifyResponse,
} from "./types.ts";

// ── constants / canonical values (mirror executors.test.ts) ───────────────────
const TOPIC_ID = "0.0.7000000";
const LEDGER = "0.0.1234567";
const ARM_TIME = 1_760_000_000_000;
const INTERVAL_MS = 86_400 * 1000;
const POLICY_HASH = "a".repeat(64);
const NULLIFIER = "12345678901234567890";
const ARM_TX = "0.0.1234567-1760000000-000000000";
const CANCEL_TX = "0.0.1234567-1760200000-000000000";

const N = 20;
function makeLadder(n = N): LadderRung[] {
  return Array.from({ length: n }, (_, i) => ({
    idx: i + 1,
    round: 1000 + i,
    deadline: ARM_TIME + (i + 1) * INTERVAL_MS,
    hash: `hash${i + 1}`.padEnd(64, "0"),
    capsuleB64: `CAPSULE_${i + 1}`,
  }));
}

function makePolicy(n = N): Policy {
  return {
    terms: { intervalSec: 86_400, n, fundingHbar: 50, bulletin: "bye" },
    nullifier: NULLIFIER,
    ciphertextHash: "c".repeat(64),
    nonce: "d".repeat(64),
  };
}

// ── in-memory SwitchStore (own mock) ──────────────────────────────────────────
function makeStore(seed?: Switch): SwitchStore {
  const mem = new Map<string, Switch>();
  if (seed) mem.set(seed.topicId, seed);
  const chains = new Map<string, Promise<unknown>>();
  return {
    async load(topicId) {
      return mem.get(topicId) ?? null;
    },
    async save(sw) {
      mem.set(sw.topicId, structuredClone(sw));
    },
    async list() {
      return [...mem.keys()];
    },
    withLock<T>(topicId: TopicId, mutator: StoreMutator<T>): Promise<T> {
      const prior = chains.get(topicId) ?? Promise.resolve();
      const run = prior.then(async () => {
        const current = mem.get(topicId) ?? null;
        const { next, result } = await mutator(current ? structuredClone(current) : null);
        if (next === null) mem.delete(topicId);
        else mem.set(topicId, structuredClone(next));
        return result;
      });
      chains.set(topicId, run.then(() => undefined, () => undefined));
      return run;
    },
  };
}

// ── CALL-LOGGING HederaSurface (own mock) ─────────────────────────────────────
interface CallLog {
  calls: string[];
  events: Array<{ topicId: TopicId; event: SwitchEvent }>;
  scheduled: Array<{ topicId: TopicId; event: ReleaseAuthorizedEvent; deadline: number }>;
  deleted: ScheduleId[];
  verifyTransferOpts: Array<{ txId: string; expectedMemo?: string; debitAccountId?: string }>;
}

function makeHedera(opts?: { verifyOk?: boolean }): { hedera: HederaSurface; log: CallLog } {
  const log: CallLog = {
    calls: [],
    events: [],
    scheduled: [],
    deleted: [],
    verifyTransferOpts: [],
  };
  let scheduleSeq = 0;
  const hedera: HederaSurface = {
    async storeCiphertext() {
      throw new Error("unused");
    },
    async readCiphertext() {
      throw new Error("unused");
    },
    async createTopic() {
      log.calls.push("createTopic");
      return TOPIC_ID;
    },
    async submitEvent(topicId, event) {
      log.calls.push("submitEvent:" + event.type);
      log.events.push({ topicId, event });
      return { seq: log.events.length, txId: "0.0.1-1700000000-000000000" };
    },
    async scheduleRelease(topicId, event, deadline) {
      log.calls.push("scheduleRelease");
      log.scheduled.push({ topicId, event, deadline });
      scheduleSeq += 1;
      return `0.0.55${scheduleSeq}`;
    },
    async deleteSchedule(scheduleId) {
      log.calls.push("deleteSchedule");
      log.deleted.push(scheduleId);
    },
    async verifyTransfer(txId, o) {
      log.calls.push("verifyTransfer");
      log.verifyTransferOpts.push({ txId, ...o });
      const ok = opts?.verifyOk ?? true;
      return {
        ok,
        result: ok ? "SUCCESS" : "FAIL",
        memo: o.expectedMemo ?? null,
        checks: { success: ok, memoMatch: ok, debit: ok },
        transactionId: txId,
      } satisfies MirrorVerifyResult;
    },
    async listTopicMessages() {
      return [];
    },
  };
  return { hedera, log };
}

// ── deterministic CryptoSurface (own mock) ────────────────────────────────────
function makeCrypto(overrides?: Partial<CryptoSurface>): CryptoSurface {
  return {
    async encrypt() {
      throw new Error("unused");
    },
    async decrypt() {
      throw new Error("unused");
    },
    hashCiphertext() {
      return "c".repeat(64);
    },
    async mintLadder() {
      return makeLadder();
    },
    async openCapsule() {
      return new Uint8Array(32);
    },
    policyHash() {
      return POLICY_HASH;
    },
    signalHash(nextRungHash, newDeadline, topicId, seq) {
      return `SIG|${nextRungHash}|${newDeadline}|${topicId}|${seq}`;
    },
    capsuleHash() {
      return "h".repeat(64);
    },
    ...overrides,
  };
}

const FLAGS_OFF: ExecutorFlags = {
  verifyArmTx: false,
  verifyCheckinProof: false,
  verifyCancelTx: false,
  chargeServiceFee: false,
};

function makeCtx(parts: {
  store?: SwitchStore;
  hedera?: HederaSurface;
  crypto?: CryptoSurface;
  flags?: Partial<ExecutorFlags>;
  worldVerify?: (req: WorldVerifyRequest) => Promise<WorldVerifyResponse>;
  now?: () => number;
}): ExecutorContext {
  return {
    store: parts.store ?? makeStore(),
    hedera: parts.hedera ?? makeHedera().hedera,
    crypto: parts.crypto ?? makeCrypto(),
    flags: { ...FLAGS_OFF, ...parts.flags },
    now: parts.now ?? (() => ARM_TIME + INTERVAL_MS),
    worldVerify: parts.worldVerify,
  };
}

function armInput() {
  return {
    policy: makePolicy(),
    policyHash: POLICY_HASH,
    storage: { kind: "hfs" as const, fileId: "0.0.999", bytes: 1024 },
    ladder: makeLadder(),
    armTime: ARM_TIME,
  };
}

const ARM_ARTIFACTS = { armTxId: ARM_TX, ledgerAccountId: LEDGER, fundingHbar: 50 };

function seededSwitch(liveIdx = 1, n = N): Switch {
  const seq = liveIdx - 1;
  return {
    topicId: TOPIC_ID,
    status: "ACTIVE",
    policy: makePolicy(n),
    policyHash: POLICY_HASH,
    storage: { kind: "hfs", fileId: "0.0.999", bytes: 1024 },
    armTxId: ARM_TX,
    ledgerAccountId: LEDGER,
    armTime: ARM_TIME,
    ladder: makeLadder(n),
    liveIdx,
    seq,
    currentDeadline: ARM_TIME + liveIdx * INTERVAL_MS,
    scheduleId: "0.0.500",
    releaseNonce: "0".repeat(64),
    createdAt: ARM_TIME,
    updatedAt: ARM_TIME,
  };
}

const WORLD_PROOF = {
  proof: "0xproof",
  merkle_root: "0xroot",
  nullifier_hash: NULLIFIER,
  verification_level: "orb",
};

// The signal the crypto mock computes for advancing from a switch's current liveIdx.
function expectedCheckinSignal(sw: Switch): string {
  const L = sw.liveIdx;
  const nextRungHash = sw.ladder[L].hash;
  const newDeadline = sw.ladder[L].deadline;
  return `SIG|${nextRungHash}|${newDeadline}|${sw.topicId}|${L}`;
}

const HEX64 = /^[0-9a-f]{64}$/;

// ════════════════════════════════════════════════════════════════════════════
// arm
// ════════════════════════════════════════════════════════════════════════════

test("arm verifyArmTx ON + mirror ok → succeeds; verifyTransfer got armMemo(policyHash) + ledger debit", async () => {
  const store = makeStore();
  const { hedera, log } = makeHedera({ verifyOk: true });
  const ctx = makeCtx({ store, hedera, flags: { verifyArmTx: true } });

  const res = await arm(ctx, armInput(), ARM_ARTIFACTS);
  assert.ok(res.ok, "arm should succeed when mirror confirms");
  if (!res.ok) return;

  // verifyTransfer was called exactly once with the recipe args.
  assert.equal(log.verifyTransferOpts.length, 1);
  const opts = log.verifyTransferOpts[0];
  assert.equal(opts.txId, ARM_TX);
  assert.equal(opts.expectedMemo, armMemo(POLICY_HASH));
  assert.equal(opts.debitAccountId, LEDGER);

  // verify happened BEFORE the topic was created (gate precedes side effects).
  const iVerify = log.calls.indexOf("verifyTransfer");
  const iCreate = log.calls.indexOf("createTopic");
  assert.ok(iVerify !== -1 && iCreate !== -1 && iVerify < iCreate);
});

test("arm verifyArmTx OFF → verifyTransfer is NEVER called (flag gating)", async () => {
  const store = makeStore();
  const { hedera, log } = makeHedera();
  const ctx = makeCtx({ store, hedera, flags: { verifyArmTx: false } });

  const res = await arm(ctx, armInput(), ARM_ARTIFACTS);
  assert.ok(res.ok);
  assert.equal(log.verifyTransferOpts.length, 0);
  assert.ok(!log.calls.includes("verifyTransfer"));
});

test("arm persists liveIdx 1 / seq 0 (invariant liveIdx===seq+1), currentDeadline===ladder[0].deadline, ACTIVE", async () => {
  const store = makeStore();
  const ctx = makeCtx({ store });
  const input = armInput();

  const res = await arm(ctx, input, ARM_ARTIFACTS);
  assert.ok(res.ok);
  if (!res.ok) return;

  const persisted = await store.load(TOPIC_ID);
  assert.ok(persisted);
  if (!persisted) return;
  assert.equal(persisted.status, "ACTIVE");
  assert.equal(persisted.liveIdx, 1);
  assert.equal(persisted.seq, 0);
  assert.equal(persisted.liveIdx, persisted.seq + 1); // the invariant
  assert.equal(persisted.currentDeadline, input.ladder[0].deadline);
});

test("arm: ARMED carries rungHashes === ladder.map(hash); scheduled RELEASE_AUTHORIZED{seq:0} nonce===persisted releaseNonce (64-hex)", async () => {
  const store = makeStore();
  const { hedera, log } = makeHedera();
  const ctx = makeCtx({ store, hedera });
  const input = armInput();

  const res = await arm(ctx, input, ARM_ARTIFACTS);
  assert.ok(res.ok);
  if (!res.ok) return;

  const armed = log.events.find((e) => e.event.type === "ARMED");
  assert.ok(armed && armed.event.type === "ARMED");
  if (armed && armed.event.type === "ARMED") {
    assert.deepEqual(armed.event.rungHashes, input.ladder.map((r) => r.hash));
  }

  assert.equal(log.scheduled.length, 1);
  const sched = log.scheduled[0];
  assert.equal(sched.event.type, "RELEASE_AUTHORIZED");
  assert.equal(sched.event.seq, 0);
  assert.match(sched.event.nonce, HEX64);

  const persisted = await store.load(TOPIC_ID);
  assert.ok(persisted);
  if (persisted) {
    assert.equal(persisted.releaseNonce, sched.event.nonce); // schedule nonce === stored nonce
  }
});

test("arm POLICY_HASH_MISMATCH: createTopic / submitEvent / scheduleRelease NOT called, nothing persisted", async () => {
  const store = makeStore();
  const { hedera, log } = makeHedera();
  const crypto = makeCrypto({ policyHash: () => "b".repeat(64) });
  const ctx = makeCtx({ store, hedera, crypto });

  const res = await arm(ctx, armInput(), ARM_ARTIFACTS);
  assert.ok(!res.ok);
  if (!res.ok) assert.equal(res.error.code, "POLICY_HASH_MISMATCH");

  assert.ok(!log.calls.includes("createTopic"));
  assert.equal(log.events.length, 0); // no submitEvent
  assert.equal(log.scheduled.length, 0); // no scheduleRelease
  assert.deepEqual(await store.list(), []); // nothing persisted
});

// ════════════════════════════════════════════════════════════════════════════
// checkin
// ════════════════════════════════════════════════════════════════════════════

test("checkin NOT_ACTIVE when switch is RELEASED", async () => {
  const seed: Switch = { ...seededSwitch(1), status: "RELEASED", scheduleId: null };
  const store = makeStore(seed);
  const { hedera, log } = makeHedera();
  const ctx = makeCtx({ store, hedera });

  const res = await checkin(
    ctx,
    { topicId: TOPIC_ID, seq: 0, signal: "anything" },
    { proof: WORLD_PROOF, action: "check-in" },
  );
  assert.ok(!res.ok);
  if (!res.ok) assert.equal(res.error.code, "NOT_ACTIVE");
  assert.deepEqual(await store.load(TOPIC_ID), seed);
  assert.equal(log.scheduled.length, 0);
  assert.equal(log.deleted.length, 0);
  assert.equal(log.events.length, 0);
});

test("checkin NOT_ACTIVE when switch is CANCELLED", async () => {
  const seed: Switch = { ...seededSwitch(1), status: "CANCELLED", scheduleId: null };
  const store = makeStore(seed);
  const { hedera, log } = makeHedera();
  const ctx = makeCtx({ store, hedera });

  const res = await checkin(
    ctx,
    { topicId: TOPIC_ID, seq: 0, signal: "anything" },
    { proof: WORLD_PROOF, action: "check-in" },
  );
  assert.ok(!res.ok);
  if (!res.ok) assert.equal(res.error.code, "NOT_ACTIVE");
  assert.deepEqual(await store.load(TOPIC_ID), seed);
  assert.equal(log.scheduled.length, 0);
  assert.equal(log.deleted.length, 0);
  assert.equal(log.events.length, 0);
});

test("checkin INTERNAL when verifyCheckinProof ON but ctx.worldVerify is undefined", async () => {
  const seed = seededSwitch(1);
  const store = makeStore(seed);
  const { hedera, log } = makeHedera();
  // verify flag on, but NO worldVerify supplied.
  const ctx = makeCtx({ store, hedera, flags: { verifyCheckinProof: true } });

  const res = await checkin(
    ctx,
    { topicId: TOPIC_ID, seq: 0, signal: expectedCheckinSignal(seed) },
    { proof: WORLD_PROOF, action: "check-in" },
  );
  assert.ok(!res.ok);
  if (!res.ok) assert.equal(res.error.code, "INTERNAL");
  assert.deepEqual(await store.load(TOPIC_ID), seed); // unchanged
  assert.equal(log.scheduled.length, 0);
  assert.equal(log.deleted.length, 0);
});

// One parametrized no-side-effects sweep across the rejection codes.
for (const tc of [
  { name: "STALE_SEQ", seed: () => seededSwitch(1), input: { seq: 9, signalBad: false }, code: "STALE_SEQ" },
  { name: "WRONG_SIGNAL", seed: () => seededSwitch(1), input: { seq: 0, signalBad: true }, code: "WRONG_SIGNAL" },
  { name: "LADDER_EXHAUSTED", seed: () => seededSwitch(N), input: { seq: N - 1, signalBad: true }, code: "LADDER_EXHAUSTED" },
  { name: "NOT_ACTIVE", seed: () => ({ ...seededSwitch(1), status: "CANCELLED" as const, scheduleId: null }), input: { seq: 0, signalBad: true }, code: "NOT_ACTIVE" },
]) {
  test(`checkin ${tc.name}: scheduleRelease/deleteSchedule/submitEvent NOT called, store byte-for-byte unchanged`, async () => {
    const seed = tc.seed();
    const store = makeStore(seed);
    const { hedera, log } = makeHedera();
    const ctx = makeCtx({ store, hedera });

    const signal = tc.input.signalBad ? "TAMPERED" : expectedCheckinSignal(seed);
    const res = await checkin(
      ctx,
      { topicId: TOPIC_ID, seq: tc.input.seq, signal },
      { proof: WORLD_PROOF, action: "check-in" },
    );
    assert.ok(!res.ok);
    if (!res.ok) assert.equal(res.error.code, tc.code);

    // No on-chain side effects of any kind.
    assert.equal(log.scheduled.length, 0, "no scheduleRelease");
    assert.equal(log.deleted.length, 0, "no deleteSchedule");
    assert.equal(log.events.length, 0, "no submitEvent");
    assert.ok(!log.calls.includes("scheduleRelease"));
    assert.ok(!log.calls.includes("deleteSchedule"));
    // Store identical.
    assert.deepEqual(await store.load(TOPIC_ID), seed);
  });
}

test("checkin happy path: scheduleRelease recorded BEFORE deleteSchedule (create-before-delete order)", async () => {
  const seed = seededSwitch(1);
  const store = makeStore(seed);
  const { hedera, log } = makeHedera();
  const ctx = makeCtx({ store, hedera });

  const res = await checkin(
    ctx,
    { topicId: TOPIC_ID, seq: 0, signal: expectedCheckinSignal(seed) },
    { proof: WORLD_PROOF, action: "check-in" },
  );
  assert.ok(res.ok);

  const onlySchedDelete = log.calls.filter((c) => c === "scheduleRelease" || c === "deleteSchedule");
  assert.deepEqual(onlySchedDelete, ["scheduleRelease", "deleteSchedule"]);
});

test("checkin rejects a second check-in before the next assigned period opens", async () => {
  const seed = seededSwitch(1);
  const store = makeStore(seed);
  const { hedera, log } = makeHedera();
  const ctx = makeCtx({
    store,
    hedera,
    // Still inside the original rung-1 period for both calls. The first check-in
    // is allowed; the immediate second must not advance into rung 3.
    now: () => ARM_TIME + Math.floor(INTERVAL_MS / 2),
  });

  const first = await checkin(
    ctx,
    { topicId: TOPIC_ID, seq: 0, signal: expectedCheckinSignal(seed) },
    { proof: WORLD_PROOF, action: "check-in" },
  );
  assert.ok(first.ok, "first check-in in the assigned period succeeds");

  const afterFirst = await store.load(TOPIC_ID);
  assert.ok(afterFirst);
  if (!afterFirst) return;
  assert.equal(afterFirst.seq, 1);
  assert.equal(afterFirst.liveIdx, 2);

  const callsBeforeSecond = log.calls.length;
  const snapshot = structuredClone(afterFirst);
  const second = await checkin(
    ctx,
    { topicId: TOPIC_ID, seq: afterFirst.seq, signal: expectedCheckinSignal(afterFirst) },
    { proof: WORLD_PROOF, action: "check-in" },
  );

  assert.ok(!second.ok, "second check-in in the same period is rejected");
  if (!second.ok) {
    assert.equal(second.error.code, "STALE_SEQ");
    assert.match(second.error.message, /already used for this period/);
  }
  assert.deepEqual(await store.load(TOPIC_ID), snapshot, "store unchanged after rejected second check-in");
  assert.equal(log.calls.length, callsBeforeSecond, "no hedera side effects for rejected second check-in");
});

test("checkin allows the next check-in once the next assigned period has opened", async () => {
  const seed = seededSwitch(2);
  const store = makeStore(seed);
  const ctx = makeCtx({
    store,
    now: () => seed.ladder[0].deadline,
  });

  const res = await checkin(
    ctx,
    { topicId: TOPIC_ID, seq: seed.seq, signal: expectedCheckinSignal(seed) },
    { proof: WORLD_PROOF, action: "check-in" },
  );

  assert.ok(res.ok, "next-period check-in succeeds at the prior rung deadline");
  if (!res.ok) return;
  assert.equal(res.value.seq, 2);
  assert.equal(res.value.liveIdx, 3);
});

test("checkin: new releaseNonce differs from the previous one and scheduleId updates", async () => {
  const seed = seededSwitch(1);
  const store = makeStore(seed);
  const { hedera } = makeHedera();
  const ctx = makeCtx({ store, hedera });

  const prevNonce = seed.releaseNonce;
  const prevScheduleId = seed.scheduleId;

  const res = await checkin(
    ctx,
    { topicId: TOPIC_ID, seq: 0, signal: expectedCheckinSignal(seed) },
    { proof: WORLD_PROOF, action: "check-in" },
  );
  assert.ok(res.ok);
  if (!res.ok) return;

  const sw = await store.load(TOPIC_ID);
  assert.ok(sw);
  if (!sw) return;
  assert.notEqual(sw.releaseNonce, prevNonce, "releaseNonce rotated");
  assert.match(sw.releaseNonce, HEX64);
  assert.notEqual(sw.scheduleId, prevScheduleId, "scheduleId updated to the new schedule");
  assert.equal(sw.scheduleId, res.value.scheduleId);
});

test("checkin verifyCheckinProof OFF: worldVerify NOT called; mismatched nullifier does NOT reject (flag gating)", async () => {
  const seed = seededSwitch(1);
  const store = makeStore(seed);
  const { hedera } = makeHedera();
  let worldVerifyCalls = 0;
  const ctx = makeCtx({
    store,
    hedera,
    flags: { verifyCheckinProof: false },
    worldVerify: async () => {
      worldVerifyCalls++;
      return { ok: true, nullifier: NULLIFIER };
    },
  });

  // Proof carries a WRONG nullifier — with the flag off this is irrelevant.
  const res = await checkin(
    ctx,
    { topicId: TOPIC_ID, seq: 0, signal: expectedCheckinSignal(seed) },
    { proof: { ...WORLD_PROOF, nullifier_hash: "99999999" }, action: "check-in" },
  );
  assert.ok(res.ok, "check-in succeeds because proof verification is gated off");
  assert.equal(worldVerifyCalls, 0, "worldVerify never invoked");
});

// ════════════════════════════════════════════════════════════════════════════
// cancel
// ════════════════════════════════════════════════════════════════════════════

test("cancel NOT_FOUND on a missing switch", async () => {
  const store = makeStore(); // empty
  const { hedera, log } = makeHedera();
  const ctx = makeCtx({ store, hedera });

  const res = await cancel(
    ctx,
    { topicId: "0.0.404" },
    { cancelTxId: CANCEL_TX, ledgerAccountId: LEDGER },
  );
  assert.ok(!res.ok);
  if (!res.ok) assert.equal(res.error.code, "NOT_FOUND");
  assert.equal(log.deleted.length, 0);
  assert.equal(log.events.length, 0);
});

test("cancel verifyCancelTx ON + mirror ok → succeeds; verifyTransfer got cancelMemo(topicId) + ledger debit", async () => {
  const seed = seededSwitch(3);
  const store = makeStore(seed);
  const { hedera, log } = makeHedera({ verifyOk: true });
  const ctx = makeCtx({ store, hedera, flags: { verifyCancelTx: true } });

  const res = await cancel(
    ctx,
    { topicId: TOPIC_ID },
    { cancelTxId: CANCEL_TX, ledgerAccountId: LEDGER },
  );
  assert.ok(res.ok, "cancel should succeed when mirror confirms");
  if (!res.ok) return;

  assert.equal(log.verifyTransferOpts.length, 1);
  const opts = log.verifyTransferOpts[0];
  assert.equal(opts.txId, CANCEL_TX);
  assert.equal(opts.expectedMemo, cancelMemo(TOPIC_ID));
  assert.equal(opts.debitAccountId, LEDGER);
});

test("cancel shreds the ENTIRE ladder, sets CANCELLED + scheduleId null + cancelled record", async () => {
  const seed = seededSwitch(7); // mid-ladder
  const store = makeStore(seed);
  const { hedera, log } = makeHedera();
  const ctx = makeCtx({ store, hedera });

  const res = await cancel(
    ctx,
    { topicId: TOPIC_ID },
    { cancelTxId: CANCEL_TX, ledgerAccountId: LEDGER },
  );
  assert.ok(res.ok);
  if (!res.ok) return;

  const sw = await store.load(TOPIC_ID);
  assert.ok(sw);
  if (!sw) return;
  assert.equal(sw.status, "CANCELLED");
  assert.equal(sw.scheduleId, null);
  assert.ok(sw.ladder.every((r) => r.capsuleB64 === ""), "EVERY capsule shredded");
  assert.deepEqual(sw.cancelled, { cancelTxId: CANCEL_TX, at: ARM_TIME + INTERVAL_MS });
  assert.deepEqual(log.deleted, ["0.0.500"]); // prior schedule torn down
});

test("cancel CANCEL_TX_UNVERIFIED (verify ON, mirror ok:false): switch stays ACTIVE/unchanged, no deleteSchedule/submitEvent", async () => {
  const seed = seededSwitch(2);
  const store = makeStore(seed);
  const { hedera, log } = makeHedera({ verifyOk: false });
  const ctx = makeCtx({ store, hedera, flags: { verifyCancelTx: true } });

  const res = await cancel(
    ctx,
    { topicId: TOPIC_ID },
    { cancelTxId: CANCEL_TX, ledgerAccountId: LEDGER },
  );
  assert.ok(!res.ok);
  if (!res.ok) assert.equal(res.error.code, "CANCEL_TX_UNVERIFIED");

  const sw = await store.load(TOPIC_ID);
  assert.deepEqual(sw, seed); // ACTIVE, ladder intact, nothing changed
  assert.equal(log.deleted.length, 0, "no deleteSchedule");
  assert.equal(log.events.length, 0, "no submitEvent");
});
