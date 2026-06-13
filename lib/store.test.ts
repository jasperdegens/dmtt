// lib/store.test.ts — WS-C: SwitchStore over data/switches/{topicId}.json.
//
// Covers the three CONTRACTS §6 guarantees against a real temp dir:
//  • save → load round-trips byte-identical; list enumerates the topicId.
//  • withLock serializes read-modify-write: 20 CONCURRENT increments land at
//    exactly 20 (no lost update / no corruption) — the headline concurrency test.
//  • next:null deletes the record; no .tmp turds are ever left behind.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStore, toSwitchView } from "./store.ts";
import type { Switch, SwitchEvent } from "./types.ts";

// A minimal but complete ACTIVE Switch (own fixture — fixtures.ts is reference only).
function makeSwitch(topicId: string, counter = 0): Switch {
  return {
    topicId,
    status: "ACTIVE",
    policy: {
      terms: { intervalSec: 86_400, n: 20, fundingHbar: 50, bulletin: "bye" },
      nullifier: "12345678901234567890",
      ciphertextHash: "a".repeat(64),
      nonce: "b".repeat(64),
    },
    policyHash: "c".repeat(64),
    storage: { kind: "hfs", fileId: "0.0.999", bytes: 1024 },
    armTxId: "0.0.1-1700000000-000000000",
    ledgerAccountId: "0.0.1",
    armTime: 1_760_000_000_000,
    ladder: [
      {
        idx: 1,
        round: 1,
        deadline: 1_760_086_400_000,
        hash: "d".repeat(64),
        capsuleB64: "CAP1",
      },
      {
        idx: 2,
        round: 2,
        deadline: 1_760_172_800_000,
        hash: "e".repeat(64),
        capsuleB64: "CAP2",
      },
    ],
    liveIdx: 1,
    seq: 0,
    currentDeadline: 1_760_086_400_000,
    scheduleId: "0.0.555",
    releaseNonce: "f".repeat(64),
    // Stash a mutable counter inside an otherwise-unused numeric field for the
    // concurrency test. We reuse `seq` is risky (invariant); instead reuse a fresh
    // record per test and track the counter via the round of rung 1.
    createdAt: 1_760_000_000_000,
    updatedAt: 1_760_000_000_000 + counter,
  };
}

test("save → load round-trips and list enumerates the topicId", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dmtt-store-"));
  try {
    const store = createStore(dir);
    const topicId = "0.0.1111111";
    const sw = makeSwitch(topicId);

    assert.equal(await store.load(topicId), null); // absent → null
    assert.deepEqual(await store.list(), []); // empty dir → []

    await store.save(sw);

    const loaded = await store.load(topicId);
    assert.deepEqual(loaded, sw); // byte-identical round trip
    assert.deepEqual(await store.list(), [topicId]); // strips .json

    // No .tmp files left behind after an atomic save.
    const names = await readdir(dir);
    assert.deepEqual(
      names.filter((n) => n.includes(".tmp")),
      [],
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("20 concurrent withLock increments land at exactly 20 (no lost update)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dmtt-store-"));
  try {
    const store = createStore(dir);
    const topicId = "0.0.2222222";
    // Seed with updatedAt as the counter base (0).
    await store.save(makeSwitch(topicId, 0));

    // Fire 20 concurrent read-modify-write increments on the SAME topic. Without
    // serialization, interleaved reads would lose updates and the final count < 20.
    const ops = Array.from({ length: 20 }, () =>
      store.withLock<number>(topicId, (current) => {
        assert.ok(current !== null, "counter record must exist mid-flow");
        const base = 1_760_000_000_000;
        const value = current.updatedAt - base + 1;
        const next: Switch = { ...current, updatedAt: base + value };
        return { next, result: value };
      }),
    );
    const results = await Promise.all(ops);

    const final = await store.load(topicId);
    assert.ok(final !== null);
    assert.equal(final.updatedAt - 1_760_000_000_000, 20, "final counter must be 20");
    // Each op observed a distinct, strictly-serial value 1..20.
    assert.deepEqual([...results].sort((a, b) => a - b), Array.from({ length: 20 }, (_, i) => i + 1));

    // Still no .tmp turds after 20 atomic renames.
    const names = await readdir(dir);
    assert.deepEqual(
      names.filter((n) => n.includes(".tmp")),
      [],
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("withLock next:null deletes the file (and is ENOENT-safe)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dmtt-store-"));
  try {
    const store = createStore(dir);
    const topicId = "0.0.3333333";
    await store.save(makeSwitch(topicId));
    assert.deepEqual(await store.list(), [topicId]);

    const deleted = await store.withLock<string>(topicId, () => ({
      next: null,
      result: "gone",
    }));
    assert.equal(deleted, "gone");
    assert.equal(await store.load(topicId), null);
    assert.deepEqual(await store.list(), []);

    // Deleting an already-absent record is a no-op (ENOENT ignored), not a throw.
    const again = await store.withLock<string>(topicId, () => ({
      next: null,
      result: "noop",
    }));
    assert.equal(again, "noop");

    const names = await readdir(dir);
    assert.deepEqual(
      names.filter((n) => n.includes(".tmp")),
      [],
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("toSwitchView never leaks capsuleB64 and nulls currentDeadline when terminal", () => {
  const sw = makeSwitch("0.0.4444444");
  const events: SwitchEvent[] = [
    { type: "RELEASE_AUTHORIZED", seq: 0, nonce: "0".repeat(64) },
  ];

  const view = toSwitchView(sw, events);
  // N10: only rung hashes, never any capsule bytes.
  assert.deepEqual(view.rungHashes, ["d".repeat(64), "e".repeat(64)]);
  assert.ok(!JSON.stringify(view).includes("CAP1"), "no capsuleB64 in the view");
  assert.ok(!JSON.stringify(view).includes("CAP2"));
  assert.deepEqual(view.events, events);
  // ACTIVE → currentDeadline carried.
  assert.equal(view.currentDeadline, sw.currentDeadline);

  // Terminal → currentDeadline null.
  const cancelled: Switch = { ...sw, status: "CANCELLED" };
  assert.equal(toSwitchView(cancelled, []).currentDeadline, null);
  const released: Switch = { ...sw, status: "RELEASED" };
  assert.equal(toSwitchView(released, []).currentDeadline, null);
});
