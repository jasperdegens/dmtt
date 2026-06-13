// lib/reveal.test.ts — PURE reveal-pipeline wiring proof (node --test).
//
// Proves the §4 REVEAL pipeline end-to-end WITHOUT waiting on drand: we generate K,
// AES-GCM-encrypt a known plaintext inline (WebCrypto), then drive revealMemo with
// INJECTED deps { openCapsule → K, fetchCiphertext → ciphertext, decrypt → real AES }
// and assert the round-trip. This locks the wiring openCapsule→K→fetch→decrypt→
// plaintext. The tlock half (real openCapsule) is covered by WS-A's live crypto test.
//
// Run: cd /home/user/dmtt && node --test --test-reporter=spec lib/reveal.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";

import { revealMemo, ciphertextUrl, type RevealDeps } from "./reveal.ts";
import type { HfsStorageRef, HcsStorageRef } from "./types.ts";

const subtle = webcrypto.subtle;
const IV_BYTES = 12;

// Self-contained AES-256-GCM (IV ‖ body), mirroring lib/crypto.ts's layout.
async function aesEncrypt(
  plaintext: Uint8Array,
  key: Uint8Array,
): Promise<Uint8Array> {
  const iv = new Uint8Array(IV_BYTES);
  webcrypto.getRandomValues(iv);
  const ck = await subtle.importKey("raw", key, { name: "AES-GCM" }, false, [
    "encrypt",
  ]);
  const body = new Uint8Array(
    await subtle.encrypt({ name: "AES-GCM", iv }, ck, plaintext),
  );
  const out = new Uint8Array(iv.length + body.length);
  out.set(iv, 0);
  out.set(body, iv.length);
  return out;
}

async function aesDecrypt(
  ciphertext: Uint8Array,
  key: Uint8Array,
): Promise<Uint8Array> {
  const iv = ciphertext.slice(0, IV_BYTES);
  const body = ciphertext.slice(IV_BYTES);
  const ck = await subtle.importKey("raw", key, { name: "AES-GCM" }, false, [
    "decrypt",
  ]);
  return new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv }, ck, body));
}

const hfs: HfsStorageRef = { kind: "hfs", fileId: "0.0.123", bytes: 10 };

test("revealMemo wires openCapsule → K → fetchCiphertext → decrypt → plaintext", async () => {
  const plaintext = new TextEncoder().encode("if you are reading this…");
  const key = new Uint8Array(32);
  webcrypto.getRandomValues(key);
  const ciphertext = await aesEncrypt(plaintext, key);

  let openedWith: string | null = null;
  let fetchedFor: string | null = null;

  const deps: RevealDeps = {
    openCapsule: async (capsuleB64) => {
      openedWith = capsuleB64;
      return key; // the capsule yields K
    },
    fetchCiphertext: async (storage) => {
      fetchedFor = storage.kind;
      return ciphertext;
    },
    decrypt: aesDecrypt,
  };

  const out = await revealMemo(deps, "CAPSULE_B64_PLACEHOLDER", hfs);

  assert.deepEqual(out, plaintext, "decrypted plaintext must match the original");
  assert.equal(openedWith, "CAPSULE_B64_PLACEHOLDER", "capsule passed to openCapsule");
  assert.equal(fetchedFor, "hfs", "storage passed to fetchCiphertext");
  assert.equal(
    new TextDecoder().decode(out),
    "if you are reading this…",
    "round-trips back to the readable memo",
  );
});

test("revealMemo rejects when the wrong K is recovered (GCM tag fails)", async () => {
  const plaintext = new TextEncoder().encode("secret");
  const key = new Uint8Array(32);
  webcrypto.getRandomValues(key);
  const ciphertext = await aesEncrypt(plaintext, key);

  const wrongKey = new Uint8Array(32); // all zeros ≠ key
  const deps: RevealDeps = {
    openCapsule: async () => wrongKey,
    fetchCiphertext: async () => ciphertext,
    decrypt: aesDecrypt,
  };

  await assert.rejects(
    revealMemo(deps, "cap", hfs),
    "a wrong K must fail the AES-GCM tag check, not yield garbage",
  );
});

test("ciphertextUrl maps HFS to the file proxy", () => {
  assert.equal(ciphertextUrl(hfs), "/api/file/0.0.123");
});

test("ciphertextUrl maps HCS to the mirror topic-messages endpoint", () => {
  const hcs: HcsStorageRef = {
    kind: "hcs",
    topicId: "0.0.9999999",
    chunks: 40,
    bytes: 786_432,
  };
  const url = ciphertextUrl(hcs);
  assert.match(url, /\/api\/v1\/topics\/0\.0\.9999999\/messages/);
  assert.match(url, /order=asc/);
});
