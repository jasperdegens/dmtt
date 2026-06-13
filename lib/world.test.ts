// lib/world.test.ts — WS-E self-verification (node --test --test-reporter=spec).
//
// PURE checks of the World backend:
//   1. buildVerifyPayload preserves the full IDKit `responses[]` payload and still
//      supports the legacy compact proof fixture shape.
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
import type { WorldIdkitResponse, WorldProof, WorldVerifyRequest } from "./types.ts";

const NULLIFIER_VECTOR = "12345678901234567890123456789012345678901234567890";
const SIGNAL =
  "4811168a447626334db554e71bce35e04f2905b5ac6bb17a36098f808d953ced";

const worldProof: WorldProof = {
  proof: "0x" + "ab".repeat(256),
  merkle_root: "0x" + "cd".repeat(32),
  nullifier_hash: NULLIFIER_VECTOR,
  verification_level: "orb",
};

const idkitResponse = {
  protocol_version: "4.0",
  nonce: "nonce-1",
  action: "check-in",
  environment: "staging",
  responses: [
    {
      identifier: "orb",
      signal_hash: "0x0",
      proof: ["0x1", "0x2", "0x3", "0x4", "0x5"],
      nullifier: NULLIFIER_VECTOR,
      issuer_schema_id: 1,
      expires_at_min: 1_756_166_400,
    },
  ],
} satisfies WorldIdkitResponse;

// ── G0 shape: top-level `action` + the proof fields, AS-IS ────────────────────
test("buildVerifyPayload carries top-level action + signal + the proof AS-IS", () => {
  const req: WorldVerifyRequest = { proof: worldProof, action: "check-in", signal: SIGNAL };
  const payload = buildVerifyPayload(req, "production");

  // The G0 requirement: a top-level `action` (without it /verify 400s).
  assert.equal(payload.action, "check-in");
  // The bound signal also rides top-level.
  assert.equal(payload.signal, SIGNAL);
  // The Developer Portal verify endpoint defaults to production; we make it explicit.
  assert.equal(payload.environment, "production");
  // The proof fields are forwarded unchanged (no re-encoding).
  assert.equal(payload.nullifier_hash, NULLIFIER_VECTOR);
  assert.equal(payload.proof, worldProof.proof);
  assert.equal(payload.merkle_root, worldProof.merkle_root);
  assert.equal(payload.verification_level, "orb");
});

test("buildVerifyPayload can target World staging for simulator proofs", () => {
  const req: WorldVerifyRequest = { proof: worldProof, action: "check-in", signal: SIGNAL };
  const payload = buildVerifyPayload(req, "staging");

  assert.equal(payload.environment, "staging");
  assert.equal(payload.action, "check-in");
  assert.equal(payload.signal, SIGNAL);
});

test("buildVerifyPayload forwards full IDKit response with responses array", () => {
  const req: WorldVerifyRequest = {
    idkitResponse,
    action: "check-in",
    signal: SIGNAL,
    environment: "staging",
  };
  const payload = buildVerifyPayload(req);

  assert.equal(payload.protocol_version, "4.0");
  assert.equal(payload.action, "check-in");
  assert.equal(payload.environment, "staging");
  assert.equal(Array.isArray(payload.responses), true);
  assert.equal((payload.responses as unknown[]).length, 1);
  assert.equal("nullifier_hash" in payload, false);
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
