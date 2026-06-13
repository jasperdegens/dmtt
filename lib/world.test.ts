// lib/world.test.ts — WS-E self-verification (node --test --test-reporter=spec).
//
// PURE checks of the World backend:
//   1. buildVerifyPayload produces the G0 shape — top-level `action` + the proof
//      fields AS-IS (the endpoint 400s "action is required" without it).
//   2. signRpContext / verifyWorldProof fail SAFELY when World isn't configured
//      (no creds in the test env → throw / {ok:false,"world not configured"}, with
//      NO network call).
//
// We define worldProof locally (the contract fixture in lib/fixtures.ts is shape-
// identical but that file imports the bare "./types" specifier, which Node's ESM
// resolver can't resolve under `node --test`).

import { test } from "node:test";
import assert from "node:assert/strict";

import { buildVerifyPayload, signRpContext, verifyWorldProof } from "./world.ts";
import { hasWorldCreds } from "./env.ts";
import type { WorldProof, WorldVerifyRequest } from "./types.ts";

const NULLIFIER_VECTOR = "12345678901234567890123456789012345678901234567890";
const SIGNAL =
  "4811168a447626334db554e71bce35e04f2905b5ac6bb17a36098f808d953ced";

const worldProof: WorldProof = {
  proof: "0x" + "ab".repeat(256),
  merkle_root: "0x" + "cd".repeat(32),
  nullifier_hash: NULLIFIER_VECTOR,
  verification_level: "orb",
};

// ── G0 shape: top-level `action` + the proof fields, AS-IS ────────────────────
test("buildVerifyPayload carries top-level action + signal + the proof AS-IS", () => {
  const req: WorldVerifyRequest = { proof: worldProof, action: "check-in", signal: SIGNAL };
  const payload = buildVerifyPayload(req);

  // The G0 requirement: a top-level `action` (without it /verify 400s).
  assert.equal(payload.action, "check-in");
  // The bound signal also rides top-level.
  assert.equal(payload.signal, SIGNAL);
  // The proof fields are forwarded unchanged (no re-encoding).
  assert.equal(payload.nullifier_hash, NULLIFIER_VECTOR);
  assert.equal(payload.proof, worldProof.proof);
  assert.equal(payload.merkle_root, worldProof.merkle_root);
  assert.equal(payload.verification_level, "orb");
});

// ── Safe failure without creds (no network) ──────────────────────────────────
test("signRpContext throws when World is not configured", () => {
  // The verify command runs without WORLD_SIGNING_KEY/WORLD_RP_ID set.
  if (hasWorldCreds()) {
    // If a dev env happens to have creds, signing must at least succeed cleanly.
    const ctx = signRpContext();
    assert.ok(ctx.rp_id);
    assert.ok(ctx.signature);
    return;
  }
  assert.throws(() => signRpContext(), /world not configured/);
});

test("verifyWorldProof returns {ok:false} with no network call when unconfigured", async () => {
  const req: WorldVerifyRequest = { proof: worldProof, action: "check-in", signal: SIGNAL };

  let called = false;
  const fetchSpy: typeof globalThis.fetch = async () => {
    called = true;
    return new Response("should not be called", { status: 200 });
  };

  if (hasWorldCreds()) {
    // With creds we can't assert offline behavior; just ensure it returns a shape.
    const res = await verifyWorldProof(req, fetchSpy);
    assert.equal(typeof res.ok, "boolean");
    return;
  }

  const res = await verifyWorldProof(req, fetchSpy);
  assert.equal(res.ok, false);
  assert.equal(res.detail, "world not configured");
  assert.equal(called, false); // never hit the network
});
