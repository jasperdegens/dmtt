// lib/checkin-client.ts — PURE client-side derivation of a check-in request.
//
// The check-in page (app/s/[topicId]/page.tsx) has only the PUBLIC SwitchView to work
// from: it never sees the agent-private Switch (N10). But a SwitchView carries enough
// to reconstruct the postponement request the checkin executor expects — armTime,
// terms, liveIdx, seq, rungHashes, topicId — so the client can derive the exact
// CheckinInput (incl. the bound signal) WITHOUT any server round-trip.
//
// The math here MUST match lib/executors.ts `checkin` exactly (verified against it):
//   L          = view.liveIdx               (1..N — the rung currently armed to fire)
//   newSeq     = L                          (= view.seq + 1; invariant liveIdx === seq+1)
//   nextRungHash = view.rungHashes[L]       (0-indexed; the now-live rung is idx L+1)
//   newDeadline  = armTime + (L+1)·intervalSec·1000   (== ladder[L].deadline executor-side)
//   signal       = signalHash(nextRungHash, newDeadline, topicId, newSeq)
//   input        = { topicId, seq: view.seq, signal }
//
// Guard (mirrors the executor's LADDER_EXHAUSTED / NOT_ACTIVE): if the switch isn't
// ACTIVE, or liveIdx is already at N (no rung left to advance to), there is nothing to
// build — return { exhausted: true } and let the UI show "release is imminent".

import { signalHash } from "./crypto.ts";
import type { CheckinInput, SwitchView, Hex64, UnixMs } from "./types.ts";

export interface CheckinRequest {
  /** The body for POST /api/checkin (paired with World artifacts client-side). */
  input: CheckinInput;
  /** The new deadline after advancing one rung (armTime + (liveIdx+1)·interval). */
  newDeadline: UnixMs;
  /** The now-live rung's public hash (=== rungHashes[liveIdx]). */
  nextRungHash: Hex64;
  /** The new seq after a successful check-in (=== liveIdx). For UI display. */
  newSeq: number;
}

/** Either a ready-to-POST request, or a blocked/exhausted marker (no rung to advance). */
export type CheckinBuild = CheckinRequest | { exhausted: true };

/** True when the build result is the blocked/exhausted marker (narrowing helper). */
export function isExhausted(b: CheckinBuild): b is { exhausted: true } {
  return "exhausted" in b;
}

/**
 * Derive the check-in request from a public SwitchView alone. Returns `{ exhausted:
 * true }` when the switch is terminal (RELEASED/CANCELLED) or the ladder is spent
 * (liveIdx >= terms.n) — there is no rung to advance to (the executor's
 * LADDER_EXHAUSTED / NOT_ACTIVE). Otherwise returns the full CheckinRequest.
 */
export function buildCheckinRequest(view: SwitchView): CheckinBuild {
  // Blocked once terminal — matches the executor's NOT_ACTIVE.
  if (view.status !== "ACTIVE") return { exhausted: true };

  const L = view.liveIdx; // 1..N — the rung currently armed to fire.
  // At liveIdx === N (or beyond) no postponement remains — LADDER_EXHAUSTED.
  if (L >= view.terms.n) return { exhausted: true };

  const newSeq = L; // === view.seq + 1 (invariant liveIdx === seq + 1).
  const nextRungHash = view.rungHashes[L]; // 0-indexed; rung idx L+1.
  const newDeadline = view.armTime + (L + 1) * view.terms.intervalSec * 1000;
  const signal = signalHash(nextRungHash, newDeadline, view.topicId, newSeq);

  const input: CheckinInput = {
    topicId: view.topicId,
    seq: view.seq,
    signal,
  };

  return { input, newDeadline, nextRungHash, newSeq };
}
