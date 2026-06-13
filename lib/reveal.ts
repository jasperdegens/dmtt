// lib/reveal.ts — the §4 REVEAL pipeline (WS-F), PURE & dependency-injected.
//
// Reveal is ENTIRELY client-side (CONTRACTS §4): a published capsule → tlock-decrypt
// → K → fetch ciphertext (HFS proxy or HCS mirror reassembly) → AES-256-GCM decrypt
// → plaintext. Plaintext never re-enters the server. The pipeline itself is pure and
// takes its three steps as injected deps so the wiring is testable without drand
// (the tlock half is covered by WS-A's live crypto test); revealDefaults() wires the
// real implementations from the sibling crypto module + defaultFetchCiphertext.
//
// House rules: lib/** uses RELATIVE imports with explicit extensions, never "@/".

import type { StorageRef, HcsStorageRef } from "./types.ts";
import { openCapsule, decrypt } from "./crypto.ts";

// ─────────────────────────────────────────────────────────────────────────────
// The injected steps of the pipeline.
// ─────────────────────────────────────────────────────────────────────────────

export interface RevealDeps {
  /** tlock-decrypt a published capsule back to K (after its drand round passes). */
  openCapsule: (capsuleB64: string) => Promise<Uint8Array>;
  /** AES-256-GCM decrypt the ciphertext under K. */
  decrypt: (ciphertext: Uint8Array, key: Uint8Array) => Promise<Uint8Array>;
  /** Fetch the stored ciphertext bytes (HFS proxy or HCS mirror reassembly). */
  fetchCiphertext: (storage: StorageRef) => Promise<Uint8Array>;
}

// ─────────────────────────────────────────────────────────────────────────────
// The pipeline — capsule → K → ciphertext → plaintext. PURE: no globals, all I/O
// flows through deps. This is the one function the test exercises end-to-end.
// ─────────────────────────────────────────────────────────────────────────────

export async function revealMemo(
  deps: RevealDeps,
  capsuleB64: string,
  storage: StorageRef,
): Promise<Uint8Array> {
  const key = await deps.openCapsule(capsuleB64);
  const ciphertext = await deps.fetchCiphertext(storage);
  return await deps.decrypt(ciphertext, key);
}

// ─────────────────────────────────────────────────────────────────────────────
// Where the ciphertext lives, as a URL.
//  - HFS: the backend FileContentsQuery proxy (mirror serves no file bytes).
//  - HCS: the mirror topic-messages endpoint (reassembled in sequence order).
// ─────────────────────────────────────────────────────────────────────────────

/** Public mirror REST base for client-side reads. NEXT_PUBLIC_* is safe to expose. */
function publicMirrorBase(): string {
  const explicit =
    typeof process !== "undefined"
      ? process.env?.NEXT_PUBLIC_HEDERA_MIRROR_URL
      : undefined;
  if (explicit) return explicit.replace(/\/$/, "");
  const network =
    (typeof process !== "undefined"
      ? process.env?.NEXT_PUBLIC_HEDERA_NETWORK
      : undefined) ?? "testnet";
  return network.toLowerCase() === "mainnet"
    ? "https://mainnet-public.mirrornode.hedera.com"
    : "https://testnet.mirrornode.hedera.com";
}

export function ciphertextUrl(storage: StorageRef): string {
  if (storage.kind === "hfs") return `/api/file/${storage.fileId}`;
  // HCS: the mirror's ordered topic-messages endpoint (reassembled by fetch).
  return `${publicMirrorBase()}/api/v1/topics/${storage.topicId}/messages?order=asc&limit=100`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Default fetchCiphertext — the production wiring (best-effort; the HFS path is
// the one exercised in tests, HCS reassembly is integration-verified).
// ─────────────────────────────────────────────────────────────────────────────

function base64ToBytes(b64: string): Uint8Array {
  if (typeof atob === "function") {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  // Node fallback (tests / SSR).
  return new Uint8Array(Buffer.from(b64, "base64"));
}

async function fetchHfsCiphertext(storage: StorageRef): Promise<Uint8Array> {
  const res = await fetch(ciphertextUrl(storage));
  if (!res.ok) throw new Error(`ciphertext fetch failed: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

async function fetchHcsCiphertext(storage: HcsStorageRef): Promise<Uint8Array> {
  // The mirror returns ciphertext chunks as base64 topic messages; sort by
  // sequence_number, decode, and concat in order. Pages until we have `chunks`.
  type MirrorMsg = { sequence_number: number; message: string };
  const messages: MirrorMsg[] = [];
  let next: string | null = ciphertextUrl(storage);
  while (next) {
    const res: Response = await fetch(next);
    if (!res.ok) throw new Error(`HCS chunk fetch failed: ${res.status}`);
    const body = (await res.json()) as {
      messages?: MirrorMsg[];
      links?: { next?: string | null };
    };
    if (body.messages) messages.push(...body.messages);
    const link = body.links?.next ?? null;
    next = link ? `${publicMirrorBase()}${link}` : null;
    if (messages.length >= storage.chunks) break;
  }
  messages.sort((a, b) => a.sequence_number - b.sequence_number);
  const parts = messages.map((m) => base64ToBytes(m.message));
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

export async function defaultFetchCiphertext(
  storage: StorageRef,
): Promise<Uint8Array> {
  return storage.kind === "hfs"
    ? fetchHfsCiphertext(storage)
    : fetchHcsCiphertext(storage);
}

// ─────────────────────────────────────────────────────────────────────────────
// The production deps — real tlock/AES from the sibling crypto module + the
// default fetcher. The pure test injects its own deps and never calls this.
// ─────────────────────────────────────────────────────────────────────────────

export function revealDefaults(): RevealDeps {
  return {
    openCapsule,
    decrypt,
    fetchCiphertext: defaultFetchCiphertext,
  };
}
