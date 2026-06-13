// lib/checkin-client.test.ts — buildCheckinRequest cross-check + guards.
//
// The whole point of lib/checkin-client.ts is that the client can derive the EXACT
// check-in request (incl. the bound signal) from a public SwitchView, matching what
// lib/executors.ts `checkin` recomputes server-side. We pin that against SIGNAL_VECTOR
// (the same vector WS-A's signalHash reproduces) and exercise the exhausted/blocked
// guards (the executor's LADDER_EXHAUSTED / NOT_ACTIVE).

import { test } from "node:test";
import assert from "node:assert/strict";

import { buildCheckinRequest, isExhausted } from "./checkin-client.ts";
import { switchViewFixture, SIGNAL_VECTOR } from "./fixtures.ts";
import type { SwitchView } from "./types.ts";

const INTERVAL_SEC = switchViewFixture.terms.intervalSec; // 86_400
const ARM_TIME = switchViewFixture.armTime;
const RUNG_2_HASH = switchViewFixture.rungHashes[1];

// A view positioned BEFORE the (single, pinned) check-in: liveIdx 1, seq 0. Advancing
// one rung lands on rung 2 (rungHashes[1]) at armTime + 2·interval with newSeq 1 —
// exactly the inputs SIGNAL_VECTOR was computed from.
const preCheckinView: SwitchView = {
  ...switchViewFixture,
  liveIdx: 1,
  seq: 0,
  currentDeadline: ARM_TIME + 1 * INTERVAL_SEC * 1000,
};

test("buildCheckinRequest reproduces SIGNAL_VECTOR (cross-check with the executor)", () => {
  const built = buildCheckinRequest(preCheckinView);
  assert.equal(isExhausted(built), false, "an ACTIVE non-exhausted switch must build");
  if (isExhausted(built)) return; // narrowing for tsc

  assert.equal(built.input.signal, SIGNAL_VECTOR, "signal must match the pinned vector");
  assert.equal(built.input.seq, 0, "input.seq is the CURRENT seq (stale guard)");
  assert.equal(built.input.topicId, preCheckinView.topicId);
  assert.equal(built.newSeq, 1, "newSeq = liveIdx = seq + 1");
  assert.equal(built.nextRungHash, RUNG_2_HASH, "nextRungHash = rungHashes[liveIdx]");
  assert.equal(
    built.newDeadline,
    ARM_TIME + 2 * INTERVAL_SEC * 1000,
    "newDeadline = armTime + (liveIdx+1)·interval·1000",
  );
});

test("buildCheckinRequest is exhausted when liveIdx >= terms.n", () => {
  const spent: SwitchView = {
    ...switchViewFixture,
    liveIdx: switchViewFixture.terms.n, // at N — no rung to advance to.
    seq: switchViewFixture.terms.n - 1,
  };
  const built = buildCheckinRequest(spent);
  assert.equal(isExhausted(built), true, "liveIdx === N must be exhausted (LADDER_EXHAUSTED)");
});

test("buildCheckinRequest is blocked when the switch is RELEASED", () => {
  const released: SwitchView = { ...preCheckinView, status: "RELEASED" };
  assert.equal(isExhausted(buildCheckinRequest(released)), true, "RELEASED → blocked (NOT_ACTIVE)");
});

test("buildCheckinRequest is blocked when the switch is CANCELLED", () => {
  const cancelled: SwitchView = { ...preCheckinView, status: "CANCELLED" };
  assert.equal(isExhausted(buildCheckinRequest(cancelled)), true, "CANCELLED → blocked (NOT_ACTIVE)");
});
