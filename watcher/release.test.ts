// watcher/release.test.ts — pure unit tests for the release reaction (WS-D).
//
// Exercises the two contract points (docs/CONTRACTS.md §4 RELEASE, §11 N10):
//   - idempotency: a duplicate RELEASE_AUTHORIZED re-posts NOTHING;
//   - the watcher publishes exactly the ONE fired rung (idx = seq + 1);
//   - pollOnce handles a release once and never re-emits on a re-poll.
//
// Everything is in-memory (a hand-rolled SwitchStore + a call-logging hedera mock);
// no SDK, network, or fs. Run: node --test --test-reporter=spec watcher/release.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";

import { handleReleaseAuthorized, pollOnce, type ReleaseDeps } from "./release.ts";
import type {
  Switch,
  SwitchStore,
  SwitchEvent,
  StoreMutator,
  LadderRung,
  ArmedEvent,
  CheckinVerifiedEvent,
  ReleaseAuthorizedEvent,
  MirrorTopicMessage,
} from "../lib/types.ts";

// NOTE: we deliberately do NOT import lib/fixtures.ts here. That frozen module uses
// EXTENSIONLESS relative imports ("./types"), which Node's native TS resolver can't
// follow under `node --test` — importing it would break this whole file (the same
// reason lib/hedera.test.ts inlines its fixtures). So the switch/ladder/event values
// below mirror lib/fixtures.ts SHAPES and load-bearing values (capsuleB64, idx, seq,
// releaseNonce) byte-for-byte, without the broken dependency.

const ARM_TIME = 1_760_000_000_000;
const INTERVAL_MS = 86_400 * 1000;
const RELEASE_NONCE =
  "1f2e3d4c5b6a7988796a5b4c3d2e1f00112233445566778899aabbccddeeff00";

const RUNG_1_CAPSULE =
  "-----BEGIN AGE ENCRYPTED FILE-----\nFIXTURE_RUNG_1_ARMORED_TLOCK_CAPSULE_PLACEHOLDER\n-----END AGE ENCRYPTED FILE-----\n";
const RUNG_2_CAPSULE =
  "-----BEGIN AGE ENCRYPTED FILE-----\nFIXTURE_RUNG_2_ARMORED_TLOCK_CAPSULE_PLACEHOLDER\n-----END AGE ENCRYPTED FILE-----\n";

// Mirrors lib/fixtures.ts ladderFixture (2 illustrative rungs).
const ladderFixture: LadderRung[] = [
  {
    idx: 1,
    round: 22_427_678,
    deadline: ARM_TIME + 1 * INTERVAL_MS,
    hash: "914b605cd26d27304a9b26fb4b2bd48d5c5d6fe2e2080103e6c819d909179e60",
    capsuleB64: RUNG_1_CAPSULE,
  },
  {
    idx: 2,
    round: 22_456_478,
    deadline: ARM_TIME + 2 * INTERVAL_MS,
    hash: "8ca209f0857875aa51bd81bfec6afd2a4ab7a4d0f2d3aa1e2b8480f59ca04400",
    capsuleB64: RUNG_2_CAPSULE,
  },
];

// Mirrors lib/fixtures.ts activeSwitchFixture (one check-in performed: liveIdx 2, seq 1).
const activeSwitchFixture: Switch = {
  topicId: "0.0.7777777",
  status: "ACTIVE",
  policy: {
    terms: {
      intervalSec: 86_400,
      n: 20,
      fundingHbar: 50,
      bulletin: "If you are reading this, I have gone quiet. — A.",
    },
    nullifier: "12345678901234567890123456789012345678901234567890",
    ciphertextHash:
      "5430f9936b4151ab899ee7af3ae2f723319484953442d861ecea8cb6fdbbc86a",
    nonce: "9f1c7a4b2e8d05f36a91c4be7d20a8f15c3e6b9d042a7f18e5c90b3d6172a4e8b",
  },
  policyHash: "5e69cb3137841c36cc5a6aafcea18e8d81f5dbe654eca0f4e64f652539ba5285",
  storage: { kind: "hfs", fileId: "0.0.8888888", bytes: 1024 },
  armTxId: "0.0.1234567-1760000000-000000000",
  ledgerAccountId: "0.0.1234567",
  armTime: ARM_TIME,
  ladder: ladderFixture,
  liveIdx: 2,
  seq: 1,
  currentDeadline: ARM_TIME + 2 * INTERVAL_MS,
  scheduleId: "0.0.5555555",
  releaseNonce: RELEASE_NONCE,
  createdAt: ARM_TIME,
  updatedAt: ARM_TIME + INTERVAL_MS,
};

// Mirrors lib/fixtures.ts armedEventFixture / checkinVerifiedEventFixture (only the
// fields pollOnce parses + skips matter; full shapes kept for type fidelity).
const armedEventFixture: ArmedEvent = {
  type: "ARMED",
  policy: activeSwitchFixture.policy,
  policyHash: activeSwitchFixture.policyHash,
  rungHashes: ladderFixture.map((r) => r.hash),
  storage: activeSwitchFixture.storage,
  armTxId: activeSwitchFixture.armTxId,
  armTime: ARM_TIME,
};

const checkinVerifiedEventFixture: CheckinVerifiedEvent = {
  type: "CHECKIN_VERIFIED",
  proof: {
    proof: "0x" + "ab".repeat(256),
    merkle_root: "0x" + "cd".repeat(32),
    nullifier_hash: activeSwitchFixture.policy.nullifier,
    verification_level: "orb",
  },
  seq: 1,
  newDeadline: ARM_TIME + 2 * INTERVAL_MS,
  nextRungHash: ladderFixture[1].hash,
  signal: "4811168a447626334db554e71bce35e04f2905b5ac6bb17a36098f808d953ced",
};

const TOPIC = activeSwitchFixture.topicId;
const FIXED_NOW = 1_760_172_800_999;

// ── helpers ──────────────────────────────────────────────────────────────────

/** Deep clone via JSON (the fixtures are plain JSON-safe data). */
function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** An ACTIVE switch whose live rung is rung 2 (liveIdx 2, seq 1) — so a
 *  RELEASE_AUTHORIZED{seq:1} fires idx 2 with a non-empty capsule. */
function freshActiveSwitch(): Switch {
  const sw = clone(activeSwitchFixture) as Switch;
  sw.status = "ACTIVE";
  delete sw.released;
  delete sw.cancelled;
  sw.liveIdx = 2;
  sw.seq = 1;
  return sw;
}

/** Minimal in-memory SwitchStore seeded with one switch. */
function makeStore(seed: Switch): SwitchStore {
  const mem = new Map<string, Switch>([[seed.topicId, seed]]);
  return {
    async load(topicId) {
      return mem.get(topicId) ?? null;
    },
    async save(sw) {
      mem.set(sw.topicId, sw);
    },
    async list() {
      return [...mem.keys()];
    },
    async withLock<T>(topicId: string, mutator: StoreMutator<T>): Promise<T> {
      const current = mem.get(topicId) ?? null;
      const { next, result } = await mutator(current);
      if (next) mem.set(topicId, next);
      else mem.delete(topicId);
      return result;
    },
  };
}

/** A call-logging hedera mock recording every submitEvent. `listImpl` lets a test
 *  drive listTopicMessages; default returns nothing. */
function makeHedera(
  log: SwitchEvent[],
  listImpl?: (topicId: string, afterSeq?: number) => Promise<MirrorTopicMessage[]>,
): ReleaseDeps["hedera"] {
  return {
    async submitEvent(_topicId, event) {
      log.push(event);
      return { seq: log.length, txId: "0.0.1-1760000000-000000000" };
    },
    async listTopicMessages(topicId, afterSeq) {
      return listImpl ? listImpl(topicId, afterSeq) : [];
    },
  };
}

function makeDeps(
  store: SwitchStore,
  log: SwitchEvent[],
  opts?: { listImpl?: (t: string, a?: number) => Promise<MirrorTopicMessage[]> },
): ReleaseDeps {
  return {
    store,
    hedera: makeHedera(log, opts?.listImpl),
    composeBulletin: () => "A. has gone silent. The memo is now public.",
    now: () => FIXED_NOW,
  };
}

function countType(log: SwitchEvent[], type: SwitchEvent["type"]): number {
  return log.filter((e) => e.type === type).length;
}

/** Encode an event as a mirror message at a given sequence number. */
function asMirrorMessage(seq: number, event: SwitchEvent): MirrorTopicMessage {
  return {
    sequenceNumber: seq,
    consensusTimestamp: `1760000000.00000000${seq}`,
    contents: Buffer.from(JSON.stringify(event), "utf8").toString("base64"),
  };
}

const releaseEvent: ReleaseAuthorizedEvent = {
  type: "RELEASE_AUTHORIZED",
  seq: 1,
  nonce: activeSwitchFixture.releaseNonce,
};

// ── tests ────────────────────────────────────────────────────────────────────

test("handleReleaseAuthorized publishes the one fired rung then marks RELEASED", async () => {
  const store = makeStore(freshActiveSwitch());
  const log: SwitchEvent[] = [];
  const deps = makeDeps(store, log);

  const outcome = await handleReleaseAuthorized(deps, TOPIC, releaseEvent);

  assert.equal(outcome.published, true);
  assert.equal(outcome.deduped, false);
  assert.equal(outcome.idx, 2, "fired rung is seq + 1");

  // Exactly one CAPSULE_PUBLISHED and one BULLETIN.
  assert.equal(countType(log, "CAPSULE_PUBLISHED"), 1);
  assert.equal(countType(log, "BULLETIN"), 1);

  // CAPSULE_PUBLISHED carries the fired rung (idx 2) and its exact capsule.
  const capsule = log.find((e) => e.type === "CAPSULE_PUBLISHED");
  assert.ok(capsule && capsule.type === "CAPSULE_PUBLISHED");
  assert.equal(capsule.idx, 2);
  assert.equal(capsule.seq, 1);
  assert.equal(capsule.capsuleB64, ladderFixture[1].capsuleB64);

  // Store transitioned to RELEASED with the matching record.
  const after = await store.load(TOPIC);
  assert.ok(after);
  assert.equal(after.status, "RELEASED");
  assert.equal(after.scheduleId, null);
  assert.ok(after.released);
  assert.equal(after.released.seq, 1);
  assert.equal(after.released.idx, 2);
  assert.equal(after.released.capsulePublished, true);
  assert.equal(after.released.at, FIXED_NOW);
  assert.equal(after.updatedAt, FIXED_NOW);
});

test("a duplicate RELEASE_AUTHORIZED is deduped — re-posts nothing", async () => {
  const store = makeStore(freshActiveSwitch());
  const log: SwitchEvent[] = [];
  const deps = makeDeps(store, log);

  const first = await handleReleaseAuthorized(deps, TOPIC, releaseEvent);
  assert.equal(first.deduped, false);
  const postsAfterFirst = log.length;
  assert.equal(countType(log, "CAPSULE_PUBLISHED"), 1);
  assert.equal(countType(log, "BULLETIN"), 1);

  // Replay the SAME event — must dedupe and not post anything more.
  const second = await handleReleaseAuthorized(deps, TOPIC, releaseEvent);
  assert.equal(second.deduped, true);
  assert.equal(second.published, false);
  assert.equal(second.idx, 2, "dedupe still reports the released idx");

  assert.equal(log.length, postsAfterFirst, "no additional events submitted");
  assert.equal(countType(log, "CAPSULE_PUBLISHED"), 1);
  assert.equal(countType(log, "BULLETIN"), 1);
});

test("unknown topic is a no-op dedupe (nothing to release)", async () => {
  const store = makeStore(freshActiveSwitch());
  const log: SwitchEvent[] = [];
  const deps = makeDeps(store, log);

  const outcome = await handleReleaseAuthorized(deps, "0.0.0000000", releaseEvent);
  assert.equal(outcome.deduped, true);
  assert.equal(outcome.published, false);
  assert.equal(log.length, 0);
});

test("best-effort bounty failure never aborts release", async () => {
  const store = makeStore(freshActiveSwitch());
  const log: SwitchEvent[] = [];
  const deps: ReleaseDeps = {
    ...makeDeps(store, log),
    payBounty: async () => {
      throw new Error("insufficient funds");
    },
  };

  const outcome = await handleReleaseAuthorized(deps, TOPIC, releaseEvent);
  assert.equal(outcome.published, true);
  assert.equal(countType(log, "CAPSULE_PUBLISHED"), 1);
  assert.equal(countType(log, "BULLETIN"), 1);
  const after = await store.load(TOPIC);
  assert.equal(after?.status, "RELEASED");
});

test("pollOnce handles a release once and re-poll emits nothing new", async () => {
  const store = makeStore(freshActiveSwitch());
  const log: SwitchEvent[] = [];
  const cursor = new Map<string, number>();

  // Mirror returns ARMED, CHECKIN_VERIFIED, RELEASE_AUTHORIZED — but only those
  // strictly after the cursor (simulates real mirror paging).
  const messages: MirrorTopicMessage[] = [
    asMirrorMessage(1, armedEventFixture),
    asMirrorMessage(2, checkinVerifiedEventFixture),
    asMirrorMessage(3, releaseEvent),
  ];
  const listImpl = async (_topicId: string, afterSeq?: number) =>
    messages.filter((m) => m.sequenceNumber > (afterSeq ?? 0));

  const deps = makeDeps(store, log, { listImpl });

  const handled1 = await pollOnce(deps, cursor);
  assert.equal(handled1, 1, "exactly one release handled");
  assert.equal(cursor.get(TOPIC), 3, "cursor advanced past all three messages");
  assert.equal(countType(log, "CAPSULE_PUBLISHED"), 1);
  assert.equal(countType(log, "BULLETIN"), 1);

  // Second pass: cursor is at 3, mirror returns no new messages → 0 handled, no
  // duplicate outputs.
  const handled2 = await pollOnce(deps, cursor);
  assert.equal(handled2, 0, "no new releases on re-poll");
  assert.equal(countType(log, "CAPSULE_PUBLISHED"), 1);
  assert.equal(countType(log, "BULLETIN"), 1);
});

test("a shredded (missing) rung capsule still marks released but published:false", async () => {
  const sw = freshActiveSwitch();
  // Simulate a burned/shredded capsule for the fired rung (idx 2 → ladder[1]).
  sw.ladder[1].capsuleB64 = "";
  const store = makeStore(sw);
  const log: SwitchEvent[] = [];
  const deps = makeDeps(store, log);

  const outcome = await handleReleaseAuthorized(deps, TOPIC, releaseEvent);
  assert.equal(outcome.published, false);
  assert.equal(outcome.deduped, false);
  assert.equal(countType(log, "CAPSULE_PUBLISHED"), 0, "no capsule to publish");
  assert.equal(countType(log, "BULLETIN"), 1, "bulletin still posted");

  const after = await store.load(TOPIC);
  assert.equal(after?.status, "RELEASED");
  assert.equal(after?.released?.capsulePublished, false);
});
