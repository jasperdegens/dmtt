// lib/chat-machine.ts — WS-E: the FIXED chat state machine (pure).
//
// The chat is a fixed state machine; the LLM only narrates + parses free text into
// chips (CLAUDE.md "AI SDK v5 / chat"). This module is the SINGLE mutating surface
// and it advances ONLY on captured ARTIFACTS — never on free text, never on the
// model. PARSE_TEXT can PROPOSE a chip but it can NEVER move the machine or
// synthesize a missing artifact; ARM succeeds only when memo && terms && nullifier
// && armTxId are ALL present (the security invariant). The whole ladder runs with
// the LLM offline: feed it artifacts via reduce() and it reaches ARMED.
//
// Pure module: no SDK / network / env imports. Relative imports, explicit .ts ext.

import type { Terms } from "./types.ts";

// ── The fixed step ladder ────────────────────────────────────────────────────
// IDLE → MEMO → TERMS → WORLD → SIGN → ARMED, plus the post-arm CHECKIN / CANCEL
// branches. Order is fixed; reduce() never reorders it.
export type ChatState =
  | "IDLE"
  | "MEMO"
  | "TERMS"
  | "WORLD"
  | "SIGN"
  | "ARMED"
  | "CHECKIN"
  | "CANCEL";

/** A free-text proposal surfaced to the UI as a chip. Transient — it is NEVER an
 *  artifact and NEVER advances the machine (parseFreeText is best-effort only). */
export interface ChipSuggestion {
  kind: "interval" | "funding" | "bulletin" | "unknown";
  terms?: Partial<Terms>;
  note?: string;
}

/** The machine's accumulated context. The artifacts (memo/terms/nullifier/armTxId)
 *  are the only things that gate ARM; `suggestion`/`error` are transient UI hints. */
export interface ChatContext {
  state: ChatState;
  terms?: Terms;
  memo?: { ciphertextHash: string; storageKind: "hfs" | "hcs" };
  nullifier?: string;
  armTxId?: string;
  ledgerAccountId?: string;
  topicId?: string;
  /** Transient: the last free-text chip proposal (never mutates the ladder). */
  suggestion?: ChipSuggestion;
  /** Transient: set when an event was rejected (e.g. ARM without all artifacts). */
  error?: string;
}

export type ChatEvent =
  | { type: "MEMO_CAPTURED"; ciphertextHash: string; storageKind: "hfs" | "hcs" }
  | { type: "TERMS_SET"; terms: Terms }
  | { type: "WORLD_VERIFIED"; nullifier: string }
  | { type: "SIGNED"; armTxId: string; ledgerAccountId: string }
  | { type: "ARM" }
  | { type: "PARSE_TEXT"; text: string }
  | { type: "RESET" };

/** All four arm artifacts present? This is the ARM gate (the security invariant). */
export function canArm(ctx: ChatContext): boolean {
  return Boolean(ctx.memo && ctx.terms && ctx.nullifier && ctx.armTxId);
}

/** PURE transition. Advances ONLY on captured artifacts; PARSE_TEXT may attach a
 *  transient `suggestion` but never moves the state or fills a missing artifact. */
export function reduce(ctx: ChatContext, ev: ChatEvent): ChatContext {
  switch (ev.type) {
    // ── Artifact captures — the only things that advance the ladder. ──────────
    case "MEMO_CAPTURED":
      // Ciphertext is already stored client-side; plaintext never reaches here.
      // IDLE/MEMO → records the memo artifact and advances to the TERMS step.
      return {
        ...ctx,
        state: "TERMS",
        memo: { ciphertextHash: ev.ciphertextHash, storageKind: ev.storageKind },
        suggestion: undefined,
        error: undefined,
      };

    case "TERMS_SET":
      return {
        ...ctx,
        state: "WORLD",
        terms: ev.terms,
        suggestion: undefined,
        error: undefined,
      };

    case "WORLD_VERIFIED":
      return {
        ...ctx,
        state: "SIGN",
        nullifier: ev.nullifier,
        suggestion: undefined,
        error: undefined,
      };

    case "SIGNED":
      // Records the device-signed arm transfer. The machine is now READY to ARM,
      // but ARM itself is a separate, gated event — capturing the signature alone
      // does not arm the switch.
      return {
        ...ctx,
        armTxId: ev.armTxId,
        ledgerAccountId: ev.ledgerAccountId,
        suggestion: undefined,
        error: undefined,
      };

    // ── ARM — the mutation. Gated on ALL four artifacts (security invariant). ──
    case "ARM":
      if (!canArm(ctx)) {
        // Missing an artifact (e.g. a prompt-injected "arm now" with no Ledger
        // signature): reject, set error, leave the state UNCHANGED.
        return {
          ...ctx,
          error: "cannot arm: missing memo, terms, nullifier, or signature",
        };
      }
      return { ...ctx, state: "ARMED", suggestion: undefined, error: undefined };

    // ── PARSE_TEXT — proposal ONLY. Never advances, never synthesizes. ────────
    case "PARSE_TEXT": {
      const suggestion = parseFreeText(ev.text);
      // State is intentionally left unchanged: the LLM/free text cannot move the
      // machine. We only surface a chip the user may explicitly accept later.
      return { ...ctx, suggestion, error: undefined };
    }

    case "RESET":
      return { state: "IDLE" };

    default:
      return ctx;
  }
}

// ── Free-text → chip proposal (best-effort; NEVER mutates the machine) ────────

const INTERVAL_PATTERNS: Array<{ re: RegExp; sec: number }> = [
  { re: /\b(minutely|every\s*minute|each\s*minute|1\s*minute|one\s*minute)\b/i, sec: 60 },
  { re: /\b(daily|every\s*day|each\s*day|1\s*day|one\s*day|24\s*h(ou)?rs?)\b/i, sec: 86_400 },
  { re: /\b(weekly|every\s*week|each\s*week|1\s*week|one\s*week|7\s*days?)\b/i, sec: 604_800 },
];

/** Best-effort parse of one free-text line into a chip PROPOSAL. Returns a
 *  suggestion only — it does NOT mutate the machine (reduce attaches it as a
 *  transient hint). Examples: "2 minutes" → intervalSec 120, "weekly" →
 *  604800, "0.1 hbar" → fundingHbar 0.1. Unrecognized → { kind:"unknown" }. */
export function parseFreeText(
  text: string,
): { kind: "interval" | "funding" | "bulletin" | "unknown"; terms?: Partial<Terms>; note?: string } {
  const t = text.trim();

  // Named cadences first (daily / weekly / …).
  for (const { re, sec } of INTERVAL_PATTERNS) {
    if (re.test(t)) {
      return { kind: "interval", terms: { intervalSec: sec }, note: `every ${sec}s` };
    }
  }

  // "<n> minute(s)/day(s)/week(s)" → intervalSec.
  const dur = t.match(/\b(\d+(?:\.\d+)?)\s*(minute|min|day|week)s?\b/i);
  if (dur) {
    const n = parseFloat(dur[1]);
    const unit = dur[2].toLowerCase();
    const perUnit: Record<string, number> = {
      minute: 60, min: 60,
      day: 86_400,
      week: 604_800,
    };
    const sec = Math.round(n * (perUnit[unit] ?? 0));
    if (sec > 0) return { kind: "interval", terms: { intervalSec: sec }, note: `${n} ${unit}` };
  }

  // "<n> hbar/ℏ" → fundingHbar.
  const fund = t.match(/\b(\d+(?:\.\d+)?)\s*(?:hbar|ℏ)\b/i);
  if (fund) {
    const hbar = parseFloat(fund[1]);
    if (hbar > 0) return { kind: "funding", terms: { fundingHbar: hbar }, note: `${hbar} ℏ` };
  }

  // A quoted phrase or a "bulletin: …" prefix → a bulletin proposal.
  const quoted = t.match(/^"(.*)"$/) ?? t.match(/^bulletin\s*[:\-]\s*(.+)$/i);
  if (quoted) {
    return { kind: "bulletin", terms: { bulletin: quoted[1].trim() }, note: "bulletin text" };
  }

  return { kind: "unknown", note: "no actionable term recognized" };
}
