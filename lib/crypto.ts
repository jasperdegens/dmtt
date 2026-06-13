// lib/crypto.ts — WS-A: the CryptoSurface (lib/types.ts).
//
// Everything one switch needs cryptographically, and NOTHING the server may hold:
//  • AES-256-GCM seal of the plaintext memo (K never leaves the browser, never stored).
//  • the tlock ladder — N capsules, each sealing K to a future drand quicknet round.
//  • the deterministic hashes the rest of the system commits to (policyHash, signal,
//    ciphertextHash, capsuleHash) — pinned byte-for-byte by lib/fixtures.ts vectors.
//
// CLIENT-SAFE by construction: WebCrypto globals (globalThis.crypto.subtle,
// crypto.getRandomValues) for AES + randomness, @noble/hashes for SYNC sha-256,
// tlock-js for the timelock. NO node:crypto anywhere — this module must run in a
// browser (MemoCard encrypts locally; plaintext + K never reach the server).
//
// Hashing is normative in docs/CONTRACTS.md §3; the canonicalJSON reference impl
// below is copied verbatim from there (it computed the pinned vectors).

import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";
import {
  mainnetClient,
  defaultChainInfo,
  roundAt,
  timelockEncrypt,
  timelockDecrypt,
  Buffer,
} from "tlock-js";

import type {
  CryptoSurface,
  Hex64,
  LadderRung,
  Policy,
  Terms,
  TopicId,
  UnixMs,
} from "./types.ts";

// ─────────────────────────────────────────────────────────────────────────────
// Canonical encoding + hashing (docs/CONTRACTS.md §3 — deterministic, vector-pinned).
// ─────────────────────────────────────────────────────────────────────────────

/** Deterministic JSON: object keys sorted ascending RECURSIVELY, arrays in order,
 *  NO whitespace, standard JSON.stringify string/number escaping. This is the exact
 *  reference implementation from docs/CONTRACTS.md §3 that computed the fixtures'
 *  POLICY_HASH_VECTOR / SIGNAL_VECTOR — do not "improve" it. */
export function canonicalJSON(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canonicalJSON).join(",") + "]";
  const obj = v as Record<string, unknown>;
  return (
    "{" +
    Object.keys(obj)
      .sort()
      .map((k) => JSON.stringify(k) + ":" + canonicalJSON(obj[k]))
      .join(",") +
    "}"
  );
}

/** sha-256 of raw bytes → 64 lowercase hex chars (no 0x). The one hashing primitive
 *  everything else routes through (SYNC — @noble/hashes, not WebCrypto's async digest). */
export function sha256hex(bytes: Uint8Array): Hex64 {
  return bytesToHex(sha256(bytes));
}

/** sha-256(ciphertextBytes) → hex. Binds policy ↔ stored ciphertext (Policy.ciphertextHash). */
export function hashCiphertext(ciphertext: Uint8Array): Hex64 {
  return sha256hex(ciphertext);
}

/** policyHash = sha-256(utf8(canonicalJSON(policy))). The device-signed arm memo
 *  commits to this; it binds {terms, nullifier, ciphertextHash, nonce} unguessably. */
export function policyHash(policy: Policy): Hex64 {
  return sha256hex(utf8ToBytes(canonicalJSON(policy)));
}

/** signal = sha-256(utf8(canonicalJSON({nextRungHash, newDeadline, topicId, seq}))).
 *  Bound into the World proof at check-in and re-enforced backend-side (WRONG_SIGNAL).
 *  `seq` is the NEW seq; `nextRungHash` is the now-live rung's hash. */
export function signalHash(
  nextRungHash: Hex64,
  newDeadline: UnixMs,
  topicId: TopicId,
  seq: number,
): Hex64 {
  return sha256hex(
    utf8ToBytes(canonicalJSON({ nextRungHash, newDeadline, topicId, seq })),
  );
}

/** capsuleHash = sha-256(utf8(capsuleB64)). The PUBLIC commitment to a private rung
 *  (ARMED.rungHashes[]); also LadderRung.hash. The capsule itself stays agent-held (N10). */
export function capsuleHash(capsuleB64: string): Hex64 {
  return sha256hex(utf8ToBytes(capsuleB64));
}

/** 32 CSPRNG bytes as hex (64 chars) — Policy.nonce / release nonces. Browser-safe
 *  randomness (crypto.getRandomValues), never node:crypto. */
export function randomNonceHex(): Hex64 {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

// ─────────────────────────────────────────────────────────────────────────────
// AES-256-GCM — the memo seal. Ciphertext layout = 12-byte random IV ‖ AES-GCM(ct+tag).
// K = 32 raw bytes; it lives in the browser at arm ONLY and is discarded after minting.
// ─────────────────────────────────────────────────────────────────────────────

const AES_GCM = "AES-GCM";
const IV_BYTES = 12; // 96-bit nonce — the AES-GCM standard.
const KEY_BYTES = 32; // AES-256.

// WebCrypto's BufferSource (TS 5.7+ lib.dom) rejects Uint8Array<ArrayBufferLike>;
// ours are always ArrayBuffer-backed. Narrow at the WebCrypto call boundary.
function bs(u: Uint8Array): BufferSource {
  return u as unknown as BufferSource;
}

/** Encrypt plaintext under a fresh random K. Returns the ciphertext (IV ‖ body) and K.
 *  CLIENT ONLY — K is the bedrock secret; never persist it, never send it to the server. */
export async function encrypt(
  plaintext: Uint8Array,
): Promise<{ ciphertext: Uint8Array; key: Uint8Array }> {
  const key = new Uint8Array(KEY_BYTES);
  crypto.getRandomValues(key);
  const iv = new Uint8Array(IV_BYTES);
  crypto.getRandomValues(iv);

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: AES_GCM },
    false,
    ["encrypt"],
  );
  const body = new Uint8Array(
    await crypto.subtle.encrypt({ name: AES_GCM, iv }, cryptoKey, bs(plaintext)),
  );

  // Layout: IV ‖ AES-GCM(plaintext+tag). The IV is public; the seal is K.
  const ciphertext = new Uint8Array(iv.length + body.length);
  ciphertext.set(iv, 0);
  ciphertext.set(body, iv.length);
  return { ciphertext, key };
}

/** Decrypt IV ‖ body with K. Wrong key or a flipped byte → the GCM tag check fails and
 *  subtle.decrypt REJECTS (no silent garbage). Used at reveal after openCapsule → K. */
export async function decrypt(
  ciphertext: Uint8Array,
  key: Uint8Array,
): Promise<Uint8Array> {
  const iv = ciphertext.slice(0, IV_BYTES);
  const body = ciphertext.slice(IV_BYTES);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    bs(key),
    { name: AES_GCM },
    false,
    ["decrypt"],
  );
  return new Uint8Array(
    await crypto.subtle.decrypt({ name: AES_GCM, iv: bs(iv) }, cryptoKey, bs(body)),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// tlock ladder — N capsules, each sealing K to a future drand quicknet round.
// mainnetClient() === quicknet in tlock-js 0.9 (period 3s, bls-unchained-g1-rfc9380).
// ─────────────────────────────────────────────────────────────────────────────

/** The drand quicknet client. One per module is fine — it's a thin HTTP wrapper. */
function quicknetClient() {
  return mainnetClient(); // tlock-js 0.9: mainnetClient() targets quicknet (52db9ba…).
}

/** Mint the fixed ladder grid: for i = 1..terms.n, deadline_i = armTime + i·intervalSec·1000,
 *  round_i = roundAt(deadline_i), capsule_i = tlock(K, round_i). The grid is fixed at arm;
 *  check-in advances a pointer along it (it never recomputes now + interval). CLIENT ONLY
 *  (K is in-memory here). Rounds are strictly increasing (deadlines strictly increase). */
export async function mintLadder(
  key: Uint8Array,
  armTime: UnixMs,
  terms: Terms,
): Promise<LadderRung[]> {
  const client = quicknetClient();
  const rungs: LadderRung[] = [];
  for (let i = 1; i <= terms.n; i++) {
    const deadline = armTime + i * terms.intervalSec * 1000;
    const round = roundAt(deadline, defaultChainInfo);
    const capsuleB64 = await timelockEncrypt(round, Buffer.from(key), client);
    rungs.push({
      idx: i,
      round,
      deadline,
      hash: capsuleHash(capsuleB64),
      capsuleB64,
    });
  }
  return rungs;
}

/** Reveal: tlock-decrypt a published capsule back to K. Only succeeds once the capsule's
 *  drand round has passed (before that, timelockDecrypt rejects — that IS the seal). */
export async function openCapsule(capsuleB64: string): Promise<Uint8Array> {
  const client = quicknetClient();
  return new Uint8Array(await timelockDecrypt(capsuleB64, client));
}

// ─────────────────────────────────────────────────────────────────────────────
// The bundled surface — structurally satisfies CryptoSurface (lib/types.ts).
// Executors / other workstreams import THIS (and the free functions above).
// ─────────────────────────────────────────────────────────────────────────────

export const cryptoSurface = {
  encrypt,
  decrypt,
  hashCiphertext,
  mintLadder,
  openCapsule,
  policyHash,
  signalHash,
  capsuleHash,
} satisfies CryptoSurface;
