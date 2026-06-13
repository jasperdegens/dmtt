// lib/crypto.test.ts — WS-A self-verification (node --test --test-reporter=spec).
//
// Proves the CryptoSurface against the pinned vectors (lib/fixtures.ts) and the
// negative paths that are the point (CLAUDE.md "Definition of done"): a wrong key
// or a flipped byte MUST reject, and a sealed capsule MUST refuse to open before
// its drand round. The LIVE tlock test hits real drand quicknet (it works here)
// and legitimately waits ~10-30s for a round to publish.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  canonicalJSON,
  encrypt,
  decrypt,
  mintLadder,
  policyHash,
  signalHash,
  capsuleHash,
} from "./crypto.ts";

import {
  policyFixture,
  POLICY_HASH_VECTOR,
  SIGNAL_VECTOR,
} from "./fixtures.ts";

import {
  defaultChainInfo,
  defaultChainUrl,
  roundAt,
  timelockEncrypt,
  timelockDecrypt,
  mainnetClient,
  Buffer,
} from "tlock-js";

// ── canonicalJSON — recursive ascending key sort, arrays in order, no whitespace ──
test("canonicalJSON sorts keys ascending, no whitespace", () => {
  assert.equal(canonicalJSON({ b: 1, a: 2 }), '{"a":2,"b":1}');
});

test("canonicalJSON recurses into nested objects and arrays", () => {
  const v = { z: [{ y: 1, x: 2 }, 3], a: { d: 4, c: 5 } };
  // arrays stay in order; every object's keys sort ascending recursively.
  assert.equal(canonicalJSON(v), '{"a":{"c":5,"d":4},"z":[{"x":2,"y":1},3]}');
});

// ── policyHash / signalHash — must reproduce the pinned vectors byte-for-byte ──
test("policyHash(policyFixture) === POLICY_HASH_VECTOR", () => {
  assert.equal(policyHash(policyFixture), POLICY_HASH_VECTOR);
});

test("signalHash reproduces SIGNAL_VECTOR", () => {
  const got = signalHash(
    "8ca209f0857875aa51bd81bfec6afd2a4ab7a4d0f2d3aa1e2b8480f59ca04400",
    1760172800000,
    "0.0.7777777",
    1,
  );
  assert.equal(got, SIGNAL_VECTOR);
});

// ── AES-256-GCM round-trip + negative paths ──
test("AES-256-GCM encrypt → decrypt round-trips", async () => {
  const plaintext = new TextEncoder().encode("If you are reading this, I have gone quiet.");
  const { ciphertext, key } = await encrypt(plaintext);
  assert.equal(key.length, 32);
  assert.ok(ciphertext.length > 12, "ciphertext carries IV + body + tag");
  const out = await decrypt(ciphertext, key);
  assert.deepEqual(out, plaintext);
});

test("AES decrypt with a WRONG key rejects", async () => {
  const { ciphertext } = await encrypt(new Uint8Array([1, 2, 3, 4]));
  const wrongKey = new Uint8Array(32); // all-zero — not the random K used to encrypt.
  await assert.rejects(() => decrypt(ciphertext, wrongKey));
});

test("AES decrypt of a 1-byte-flipped ciphertext rejects (GCM tag)", async () => {
  const { ciphertext, key } = await encrypt(new Uint8Array([5, 6, 7, 8]));
  const tampered = ciphertext.slice();
  tampered[tampered.length - 1] ^= 0x01; // flip a bit in the tag region.
  await assert.rejects(() => decrypt(tampered, key));
});

// ── mintLadder math (fast — no waiting; tlock encrypt is local) ──
test("mintLadder builds a fixed, strictly-increasing grid", async () => {
  const key = new Uint8Array(32);
  crypto.getRandomValues(key);
  const armTime = 1_760_000_000_000;
  const terms = { intervalSec: 60, n: 3, fundingHbar: 1, bulletin: "" };

  const ladder = await mintLadder(key, armTime, terms);

  assert.equal(ladder.length, 3);
  for (let i = 0; i < ladder.length; i++) {
    const rung = ladder[i];
    const idx = i + 1;
    assert.equal(rung.idx, idx);
    const expectedDeadline = armTime + idx * 60 * 1000;
    assert.equal(rung.deadline, expectedDeadline);
    assert.equal(rung.round, roundAt(expectedDeadline, defaultChainInfo));
    assert.equal(rung.hash, capsuleHash(rung.capsuleB64));
    if (i > 0) {
      assert.ok(rung.round > ladder[i - 1].round, "rounds strictly increasing");
      assert.ok(rung.deadline > ladder[i - 1].deadline, "deadlines strictly increasing");
    }
  }
});

// ── LIVE tlock — the seal holds pre-round, opens after (real drand quicknet) ──
test("tlock seals K until its round, then round-trips", { timeout: 120_000 }, async () => {
  const client = mainnetClient(); // === quicknet
  const K = new Uint8Array(32);
  crypto.getRandomValues(K);

  const round = roundAt(Date.now() + 9_000, defaultChainInfo); // ~3 rounds out.
  const capsule = await timelockEncrypt(round, Buffer.from(K), client);

  // The seal: before the round publishes, decryption MUST be rejected.
  await assert.rejects(
    () => timelockDecrypt(capsule, client),
    "capsule decrypted BEFORE its round — timelock not holding",
  );

  // Wait for drand to publish past the target round (budget ~90s).
  await waitForRound(round, 90_000);

  const out = new Uint8Array(await timelockDecrypt(capsule, client));
  assert.deepEqual(out, K, "post-round decrypt is byte-identical to K");
});

async function waitForRound(round: number, budgetMs: number): Promise<void> {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    const latest = await fetch(`${defaultChainUrl}/public/latest`)
      .then((r) => r.json())
      .catch(() => null);
    if (latest && typeof latest.round === "number" && latest.round >= round) return;
    await new Promise((r) => setTimeout(r, 2_000));
  }
  throw new Error(`timed out waiting for drand round ${round}`);
}
