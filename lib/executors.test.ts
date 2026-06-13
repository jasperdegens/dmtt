// lib/executors.test.ts — WS-C: the arm / checkin / cancel state machine (CONTRACTS §4, §8).
//
// Built against OWN inline mocks (fixtures.ts is reference only): a fresh in-memory
// SwitchStore, a CALL-LOGGING HederaSurface that records the order of scheduleRelease
// vs deleteSchedule and every submitEvent payload, and a deterministic CryptoSurface.
//
// The NEGATIVE paths are the point (CLAUDE.md "Definition of done"): a forged or
// replayed input — wrong policyHash, stale seq, wrong nullifier, wrong signal —
// must reject and leave the store unchanged.

import { test } from "node:test";
import assert from "node:assert/strict";

import { arm, checkin, cancel } from "./executors.ts";
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
  WorldIdkitResponse,
} from "./types.ts";

// ── constants / canonical values for the deterministic mocks ──────────────────
const TOPIC_ID = "0.0.7000000";
const LEDGER = "0.0.1234567";
const ARM_TIME = 1_760_000_000_000;
const INTERVAL_MS = 86_400 * 1000;
const POLICY_HASH = "a".repeat(64);
const NULLIFIER = "12345678901234567890";
const ARM_TX = "0.0.1234567-1760000000-000000000";
const CANCEL_TX = "0.0.1234567-1760200000-000000000";

// A deterministic ladder of N rungs (capsules distinct so we can assert shredding).
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

// ── an in-memory SwitchStore (own mock) ───────────────────────────────────────
function makeStore(seed?: Switch): SwitchStore {
  const mem = new Map<string, Switch>();
  if (seed) mem.set(seed.topicId, seed);
  // Per-topic promise chain so the concurrency contract holds in tests too.
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

// ── a CALL-LOGGING HederaSurface (own mock) ───────────────────────────────────
interface CallLog {
  calls: string[]; // ordered method names ("scheduleRelease", "deleteSchedule", ...)
  events: Array<{ topicId: TopicId; event: SwitchEvent }>;
  scheduled: Array<{ topicId: TopicId; event: ReleaseAuthorizedEvent; deadline: number }>;
  deleted: ScheduleId[];
  verifyTransferOpts: Array<{ txId: string; expectedMemo?: string; debitAccountId?: string }>;
}

function makeHedera(opts?: {
  verifyOk?: boolean;
}): { hedera: HederaSurface; log: CallLog } {
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

// ── a deterministic CryptoSurface (own mock) ──────────────────────────────────
// policyHash echoes a fixed value; signalHash is a pure function of its args so the
// happy path matches and a tampered signal does not.
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
}): ExecutorContext {
  return {
    store: parts.store ?? makeStore(),
    hedera: parts.hedera ?? makeHedera().hedera,
    crypto: parts.crypto ?? makeCrypto(),
    flags: { ...FLAGS_OFF, ...parts.flags },
    now: () => ARM_TIME + INTERVAL_MS,
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

// An ACTIVE switch seeded for checkin/cancel tests (liveIdx L, seq L-1).
function seededSwitch(liveIdx = 1): Switch {
  const seq = liveIdx - 1;
  return {
    topicId: TOPIC_ID,
    status: "ACTIVE",
    policy: makePolicy(),
    policyHash: POLICY_HASH,
    storage: { kind: "hfs", fileId: "0.0.999", bytes: 1024 },
    armTxId: ARM_TX,
    ledgerAccountId: LEDGER,
    armTime: ARM_TIME,
    ladder: makeLadder(),
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

const IDKIT_RESPONSE = {
  protocol_version: "4.0",
  environment: "staging",
  responses: [{ nullifier: NULLIFIER }],
} satisfies WorldIdkitResponse;

// The signal the crypto mock would compute for advancing from liveIdx=1 → rung 2.
function expectedCheckinSignal(sw: Switch): string {
  const L = sw.liveIdx;
  const nextRungHash = sw.ladder[L].hash;
  const newDeadline = sw.ladder[L].deadline;
  return `SIG|${nextRungHash}|${newDeadline}|${sw.topicId}|${L}`;
}

// ── arm ───────────────────────────────────────────────────────────────────────

test("arm (flags off) → ok; persists ACTIVE switch (liveIdx 1, seq 0), ARMED submitted", async () => {
  const store = makeStore();
  const { hedera, log } = makeHedera();
  const ctx = makeCtx({ store, hedera });

  const res = await arm(ctx, armInput(), ARM_ARTIFACTS);
  assert.ok(res.ok, "arm should succeed");
  if (!res.ok) return;

  assert.equal(res.value.topicId, TOPIC_ID);
  assert.ok(res.value.scheduleId.startsWith("0.0.55"));
  const sw = res.value.switch;
  assert.equal(sw.status, "ACTIVE");
  assert.equal(sw.liveIdx, 1);
  assert.equal(sw.seq, 0);
  assert.equal(sw.currentDeadline, ARM_TIME + INTERVAL_MS);
  assert.ok(sw.scheduleId);

  // Persisted to the store under topicId.
  const persisted = await store.load(TOPIC_ID);
  assert.deepEqual(persisted, sw);

  // An ARMED event was submitted, carrying rungHashes.
  const armed = log.events.find((e) => e.event.type === "ARMED");
  assert.ok(armed, "ARMED submitted");
  if (armed && armed.event.type === "ARMED") {
    assert.equal(armed.event.rungHashes.length, N);
    assert.equal(armed.event.policyHash, POLICY_HASH);
  }
  // Schedule wraps RELEASE_AUTHORIZED{seq:0}.
  assert.equal(log.scheduled.length, 1);
  assert.equal(log.scheduled[0].event.seq, 0);
});

test("arm POLICY_HASH_MISMATCH (crypto.policyHash ≠ input.policyHash)", async () => {
  const store = makeStore();
  const { hedera, log } = makeHedera();
  // crypto returns X, input commits Y.
  const crypto = makeCrypto({ policyHash: () => "b".repeat(64) });
  const ctx = makeCtx({ store, hedera, crypto });

  const res = await arm(ctx, armInput(), ARM_ARTIFACTS);
  assert.ok(!res.ok);
  if (!res.ok) assert.equal(res.error.code, "POLICY_HASH_MISMATCH");
  // No topic created, nothing persisted.
  assert.equal(log.calls.length, 0);
  assert.deepEqual(await store.list(), []);
});

test("arm ARM_TX_UNVERIFIED when verifyArmTx flag on and mirror rejects", async () => {
  const store = makeStore();
  const { hedera } = makeHedera({ verifyOk: false });
  const ctx = makeCtx({ store, hedera, flags: { verifyArmTx: true } });

  const res = await arm(ctx, armInput(), ARM_ARTIFACTS);
  assert.ok(!res.ok);
  if (!res.ok) assert.equal(res.error.code, "ARM_TX_UNVERIFIED");
  assert.deepEqual(await store.list(), []);
});

// ── checkin ───────────────────────────────────────────────────────────────────

test("checkin happy → seq 0→1, liveIdx 1→2; CHECKIN_VERIFIED; scheduleRelease BEFORE deleteSchedule", async () => {
  const seed = seededSwitch(1);
  const store = makeStore(seed);
  const { hedera, log } = makeHedera();
  const ctx = makeCtx({ store, hedera });

  const res = await checkin(
    ctx,
    { topicId: TOPIC_ID, seq: 0, signal: expectedCheckinSignal(seed) },
    { proof: WORLD_PROOF, action: "check-in" },
  );
  assert.ok(res.ok, "checkin should succeed");
  if (!res.ok) return;

  assert.equal(res.value.seq, 1);
  assert.equal(res.value.liveIdx, 2);
  assert.equal(res.value.newDeadline, ARM_TIME + 2 * INTERVAL_MS);

  // State advanced and persisted.
  const sw = await store.load(TOPIC_ID);
  assert.ok(sw);
  if (sw) {
    assert.equal(sw.seq, 1);
    assert.equal(sw.liveIdx, 2);
    assert.equal(sw.scheduleId, res.value.scheduleId);
    // Burned rung 1 (ladder[0]) is shredded; rung 2 untouched.
    assert.equal(sw.ladder[0].capsuleB64, "");
    assert.equal(sw.ladder[1].capsuleB64, "CAPSULE_2");
  }

  // CHECKIN_VERIFIED submitted.
  const checkinEvt = log.events.find((e) => e.event.type === "CHECKIN_VERIFIED");
  assert.ok(checkinEvt, "CHECKIN_VERIFIED submitted");

  // CREATE-NEW-SCHEDULE-BEFORE-DELETE-OLD: scheduleRelease precedes deleteSchedule.
  const iSchedule = log.calls.indexOf("scheduleRelease");
  const iDelete = log.calls.indexOf("deleteSchedule");
  assert.ok(iSchedule !== -1 && iDelete !== -1, "both calls happened");
  assert.ok(iSchedule < iDelete, "new schedule created BEFORE old deleted");
  assert.deepEqual(log.deleted, ["0.0.500"]); // deleted the prior schedule
});

test("checkin STALE_SEQ (wrong input.seq) → rejected, store unchanged", async () => {
  const seed = seededSwitch(1);
  const store = makeStore(seed);
  const { hedera, log } = makeHedera();
  const ctx = makeCtx({ store, hedera });

  const res = await checkin(
    ctx,
    { topicId: TOPIC_ID, seq: 5, signal: expectedCheckinSignal(seed) },
    { proof: WORLD_PROOF, action: "check-in" },
  );
  assert.ok(!res.ok);
  if (!res.ok) assert.equal(res.error.code, "STALE_SEQ");

  const sw = await store.load(TOPIC_ID);
  assert.deepEqual(sw, seed); // unchanged
  assert.equal(log.scheduled.length, 0); // no side effects
  assert.equal(log.deleted.length, 0);
});

test("checkin WRONG_SIGNAL (signal ≠ crypto.signalHash) → rejected, unchanged", async () => {
  const seed = seededSwitch(1);
  const store = makeStore(seed);
  const { hedera, log } = makeHedera();
  const ctx = makeCtx({ store, hedera });

  const res = await checkin(
    ctx,
    { topicId: TOPIC_ID, seq: 0, signal: "TAMPERED" },
    { proof: WORLD_PROOF, action: "check-in" },
  );
  assert.ok(!res.ok);
  if (!res.ok) assert.equal(res.error.code, "WRONG_SIGNAL");

  assert.deepEqual(await store.load(TOPIC_ID), seed);
  assert.equal(log.scheduled.length, 0);
});

test("checkin WORLD_VERIFY_FAILED (verifyCheckinProof on, worldVerify ok:false)", async () => {
  const seed = seededSwitch(1);
  const store = makeStore(seed);
  const { hedera, log } = makeHedera();
  const ctx = makeCtx({
    store,
    hedera,
    flags: { verifyCheckinProof: true },
    worldVerify: async () => ({ ok: false, detail: "rejected" }),
  });

  const res = await checkin(
    ctx,
    { topicId: TOPIC_ID, seq: 0, signal: expectedCheckinSignal(seed) },
    { proof: WORLD_PROOF, action: "check-in" },
  );
  assert.ok(!res.ok);
  if (!res.ok) assert.equal(res.error.code, "WORLD_VERIFY_FAILED");
  assert.deepEqual(await store.load(TOPIC_ID), seed);
  assert.equal(log.scheduled.length, 0);
});

test("checkin verifyCheckinProof uses IDKit responses[] when supplied", async () => {
  const seed = seededSwitch(1);
  const store = makeStore(seed);
  const { hedera } = makeHedera();
  let seen: WorldVerifyRequest | null = null;
  const ctx = makeCtx({
    store,
    hedera,
    flags: { verifyCheckinProof: true },
    worldVerify: async (req) => {
      seen = req;
      return { ok: true, nullifier: NULLIFIER };
    },
  });
  const artifacts = { proof: WORLD_PROOF, action: "check-in", idkitResponse: IDKIT_RESPONSE };

  const res = await checkin(
    ctx,
    { topicId: TOPIC_ID, seq: 0, signal: expectedCheckinSignal(seed) },
    artifacts,
  );

  assert.ok(res.ok);
  assert.ok(seen);
  const req = seen as unknown as WorldVerifyRequest;
  assert.equal(req.idkitResponse, IDKIT_RESPONSE);
  assert.equal(req.proof, undefined);
  assert.equal(Array.isArray(req.idkitResponse?.responses), true);
});

test("checkin WRONG_NULLIFIER (proof nullifier ≠ policy.nullifier)", async () => {
  const seed = seededSwitch(1);
  const store = makeStore(seed);
  const { hedera } = makeHedera();
  const ctx = makeCtx({
    store,
    hedera,
    flags: { verifyCheckinProof: true },
    worldVerify: async () => ({ ok: true, nullifier: "999" }),
  });

  const res = await checkin(
    ctx,
    { topicId: TOPIC_ID, seq: 0, signal: expectedCheckinSignal(seed) },
    { proof: { ...WORLD_PROOF, nullifier_hash: "99999999" }, action: "check-in" },
  );
  assert.ok(!res.ok);
  if (!res.ok) assert.equal(res.error.code, "WRONG_NULLIFIER");
  assert.deepEqual(await store.load(TOPIC_ID), seed);
});

test("checkin LADDER_EXHAUSTED when liveIdx === N", async () => {
  const seed = seededSwitch(N); // liveIdx 20, seq 19 — no rung to advance to.
  const store = makeStore(seed);
  const { hedera, log } = makeHedera();
  const ctx = makeCtx({ store, hedera });

  // signal recompute would use ladder[N] which is out of range — but the guard
  // rejects before that. Pass any signal.
  const res = await checkin(
    ctx,
    { topicId: TOPIC_ID, seq: N - 1, signal: "whatever" },
    { proof: WORLD_PROOF, action: "check-in" },
  );
  assert.ok(!res.ok);
  if (!res.ok) assert.equal(res.error.code, "LADDER_EXHAUSTED");
  assert.deepEqual(await store.load(TOPIC_ID), seed);
  assert.equal(log.scheduled.length, 0);
});

test("checkin NOT_FOUND on a missing switch", async () => {
  const store = makeStore();
  const ctx = makeCtx({ store });
  const res = await checkin(
    ctx,
    { topicId: "0.0.404", seq: 0, signal: "x" },
    { proof: WORLD_PROOF, action: "check-in" },
  );
  assert.ok(!res.ok);
  if (!res.ok) assert.equal(res.error.code, "NOT_FOUND");
});

// ── cancel ──────────────────────────────────────────────────────────────────────

test("cancel → status CANCELLED, deleteSchedule called, CANCELLED submitted, ladder shredded", async () => {
  const seed = seededSwitch(3); // mid-ladder, some rungs already live
  const store = makeStore(seed);
  const { hedera, log } = makeHedera();
  const ctx = makeCtx({ store, hedera });

  const res = await cancel(ctx, { topicId: TOPIC_ID }, { cancelTxId: CANCEL_TX, ledgerAccountId: LEDGER });
  assert.ok(res.ok, "cancel should succeed");
  if (!res.ok) return;

  assert.equal(res.value.topicId, TOPIC_ID);
  assert.equal(res.value.cancelTxId, CANCEL_TX);

  const sw = await store.load(TOPIC_ID);
  assert.ok(sw);
  if (sw) {
    assert.equal(sw.status, "CANCELLED");
    assert.equal(sw.scheduleId, null);
    assert.deepEqual(sw.cancelled, { cancelTxId: CANCEL_TX, at: ARM_TIME + INTERVAL_MS });
    // WHOLE ladder shredded.
    assert.ok(sw.ladder.every((r) => r.capsuleB64 === ""), "every capsule shredded");
  }

  assert.deepEqual(log.deleted, ["0.0.500"]); // prior schedule torn down
  assert.ok(log.events.some((e) => e.event.type === "CANCELLED"), "CANCELLED submitted");
});

test("cancel NOT_ACTIVE on an already-cancelled switch", async () => {
  const seed: Switch = { ...seededSwitch(1), status: "CANCELLED", scheduleId: null };
  const store = makeStore(seed);
  const ctx = makeCtx({ store });
  const res = await cancel(ctx, { topicId: TOPIC_ID }, { cancelTxId: CANCEL_TX, ledgerAccountId: LEDGER });
  assert.ok(!res.ok);
  if (!res.ok) assert.equal(res.error.code, "NOT_ACTIVE");
});

test("cancel CANCEL_TX_UNVERIFIED when verifyCancelTx on and mirror rejects", async () => {
  const seed = seededSwitch(1);
  const store = makeStore(seed);
  const { hedera, log } = makeHedera({ verifyOk: false });
  const ctx = makeCtx({ store, hedera, flags: { verifyCancelTx: true } });

  const res = await cancel(ctx, { topicId: TOPIC_ID }, { cancelTxId: CANCEL_TX, ledgerAccountId: LEDGER });
  assert.ok(!res.ok);
  if (!res.ok) assert.equal(res.error.code, "CANCEL_TX_UNVERIFIED");
  assert.deepEqual(await store.load(TOPIC_ID), seed); // unchanged
  assert.equal(log.deleted.length, 0);
});
