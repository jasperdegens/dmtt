// test/fixtures-invariants.test.ts — invariants the fixtures must encode
// (the real contract rules from CLAUDE.md / docs/CONTRACTS.md).

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  activeSwitchFixture,
  releasedSwitchFixture,
  cancelledSwitchFixture,
  armedEventFixture,
  ladderFixture,
  termsFixture,
  switchViewFixture,
  eventTrailFixture,
} from "../lib/fixtures.ts";

// ── core switch invariant ────────────────────────────────────────────────────

test("activeSwitch upholds liveIdx === seq + 1", () => {
  assert.equal(activeSwitchFixture.liveIdx, activeSwitchFixture.seq + 1);
});

test("activeSwitch.currentDeadline === ladder[liveIdx-1].deadline", () => {
  const live = ladderFixture[activeSwitchFixture.liveIdx - 1];
  assert.equal(activeSwitchFixture.currentDeadline, live.deadline);
});

// ── ARMED commits exactly the ladder hash list ───────────────────────────────

test("armedEvent.rungHashes deep-equals ladder.map(r => r.hash)", () => {
  assert.deepEqual(
    armedEventFixture.rungHashes,
    ladderFixture.map((r) => r.hash),
  );
});

// ── ladder ordering / structure ──────────────────────────────────────────────

test("ladder idx runs 1..length in order", () => {
  ladderFixture.forEach((rung, i) => {
    assert.equal(rung.idx, i + 1);
  });
});

test("ladder round values are strictly increasing with idx", () => {
  for (let i = 1; i < ladderFixture.length; i++) {
    assert.ok(
      ladderFixture[i].round > ladderFixture[i - 1].round,
      `round[${i}] (${ladderFixture[i].round}) must exceed round[${i - 1}] (${ladderFixture[i - 1].round})`,
    );
  }
});

test("ladder deadlines are strictly increasing with idx", () => {
  for (let i = 1; i < ladderFixture.length; i++) {
    assert.ok(ladderFixture[i].deadline > ladderFixture[i - 1].deadline);
  }
});

test("each rung deadline === armTime + idx*intervalSec*1000", () => {
  const armTime = activeSwitchFixture.armTime;
  const intervalMs = termsFixture.intervalSec * 1000;
  ladderFixture.forEach((rung) => {
    assert.equal(rung.deadline, armTime + rung.idx * intervalMs);
  });
});

// ── terminal states drop the schedule but keep status ────────────────────────

test("releasedSwitch: scheduleId null, status RELEASED, release record set", () => {
  assert.equal(releasedSwitchFixture.scheduleId, null);
  assert.equal(releasedSwitchFixture.status, "RELEASED");
  assert.ok(releasedSwitchFixture.released);
});

test("cancelledSwitch: scheduleId null, status CANCELLED, cancel record set", () => {
  assert.equal(cancelledSwitchFixture.scheduleId, null);
  assert.equal(cancelledSwitchFixture.status, "CANCELLED");
  assert.ok(cancelledSwitchFixture.cancelled);
});

test("active switch (non-terminal) keeps a live scheduleId", () => {
  assert.equal(activeSwitchFixture.status, "ACTIVE");
  assert.notEqual(activeSwitchFixture.scheduleId, null);
});

// ── N10 privacy invariant: SwitchView never leaks a capsule ──────────────────

test("switchView never exposes any ladder capsuleB64 (N10)", () => {
  const serialized = JSON.stringify(switchViewFixture);
  for (const rung of ladderFixture) {
    assert.equal(
      serialized.includes(rung.capsuleB64),
      false,
      `switchView leaked capsule for rung ${rung.idx}`,
    );
  }
  // It DOES carry the public commitments (rung hashes).
  for (const rung of ladderFixture) {
    assert.ok(switchViewFixture.rungHashes.includes(rung.hash));
  }
});

// ── audit trail lifecycle order ──────────────────────────────────────────────

test("eventTrail starts with ARMED", () => {
  assert.equal(eventTrailFixture[0].type, "ARMED");
});

test("eventTrail: RELEASE_AUTHORIZED precedes its CAPSULE_PUBLISHED", () => {
  const releaseIdx = eventTrailFixture.findIndex((e) => e.type === "RELEASE_AUTHORIZED");
  const publishIdx = eventTrailFixture.findIndex((e) => e.type === "CAPSULE_PUBLISHED");
  assert.ok(releaseIdx >= 0, "RELEASE_AUTHORIZED present");
  assert.ok(publishIdx >= 0, "CAPSULE_PUBLISHED present");
  assert.ok(releaseIdx < publishIdx, "release must come before publish");
});
