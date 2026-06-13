// test/contract-shapes.test.ts — pinned constants, env invariants, and the
// StorageRef discriminated-union routing rule from lib/types.ts.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  LADDER_N,
  FAST_PATH_MAX_BYTES,
  DRAND_PERIOD_SEC,
  ENV_VARS,
  SERVER_ONLY_SECRETS,
} from "../lib/types.ts";
import {
  hfsStorageFixture,
  hcsStorageFixture,
} from "../lib/fixtures.ts";

// ── env var invariants ───────────────────────────────────────────────────────

test("every SERVER_ONLY_SECRET is a real ENV_VAR name (subset)", () => {
  for (const secret of SERVER_ONLY_SECRETS) {
    assert.ok(
      (ENV_VARS as readonly string[]).includes(secret),
      `${secret} must be declared in ENV_VARS`,
    );
  }
});

test("no SERVER_ONLY_SECRET is a NEXT_PUBLIC_* name (server-only invariant)", () => {
  for (const secret of SERVER_ONLY_SECRETS) {
    assert.equal(
      (secret as string).startsWith("NEXT_PUBLIC_"),
      false,
      `${secret} must never be client-exposed`,
    );
  }
});

test("SERVER_ONLY_SECRETS covers the known agent/world/anthropic keys", () => {
  assert.ok((SERVER_ONLY_SECRETS as readonly string[]).includes("HEDERA_OPERATOR_KEY"));
  assert.ok((SERVER_ONLY_SECRETS as readonly string[]).includes("WORLD_SIGNING_KEY"));
  assert.ok((SERVER_ONLY_SECRETS as readonly string[]).includes("ANTHROPIC_API_KEY"));
});

// ── pinned constants (guard against silent drift) ────────────────────────────

test("LADDER_N === 20", () => {
  assert.equal(LADDER_N, 20);
});

test("FAST_PATH_MAX_BYTES === 4096", () => {
  assert.equal(FAST_PATH_MAX_BYTES, 4096);
});

test("DRAND_PERIOD_SEC === 3 (quicknet)", () => {
  assert.equal(DRAND_PERIOD_SEC, 3);
});

// ── StorageRef discriminated union + routing rule ────────────────────────────

test("hfs fixture is kind 'hfs' and within the fast-path size", () => {
  assert.equal(hfsStorageFixture.kind, "hfs");
  assert.ok(hfsStorageFixture.bytes <= FAST_PATH_MAX_BYTES);
});

test("hcs fixture is kind 'hcs' and exceeds the fast-path size", () => {
  assert.equal(hcsStorageFixture.kind, "hcs");
  assert.ok(hcsStorageFixture.bytes > FAST_PATH_MAX_BYTES);
});

test("the two storage kinds are distinct discriminants", () => {
  assert.notEqual(hfsStorageFixture.kind, hcsStorageFixture.kind);
});
