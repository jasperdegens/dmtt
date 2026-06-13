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
  | { type: "ARM"; topicId?: string }
  | { type: "LOAD_SWITCH"; topicId: string }
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
      // Armed. `topicId` arrives once the client-side assembly (upload + ladder mint +
      // POST /api/arm) returns it; the chat then stays in-place and watches it (Phase 7
      // SPA continuity). Absent topicId still reaches ARMED (the existing scripted walk).
      return {
        ...ctx,
        state: "ARMED",
        topicId: ev.topicId ?? ctx.topicId,
        suggestion: undefined,
        error: undefined,
      };

    // ── LOAD_SWITCH — restore an EXISTING armed switch into the chat (Phase 7). ──
    // Opening a topic URL (`/?t=<topicId>`) re-enters the SAME chat interface with the
    // switch loaded and live; this is a fresh ARMED context keyed to the topic. It
    // synthesizes NO setup artifacts — the live view is fetched from the public mirror.
    case "LOAD_SWITCH":
      return { state: "ARMED", topicId: ev.topicId };

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

// ── Deterministic narration (pure; works with the LLM offline) ───────────────
// One calm status line per resulting step. /api/chat seeds its (optional) LLM polish
// from this, and the client falls back to it when the route is unreachable — so the
// narration NEVER depends on a model. It only describes the machine's CURRENT state;
// it can never drive a transition (reduce already decided that).

export function narrate(ctx: ChatContext): string {
  if (ctx.error) {
    return `Belay that! ${ctx.error}. Every step wants its proper token, matey — I'll not be skippin' ahead, no matter how sweetly ye ask.`;
  }
  switch (ctx.state) {
    case "IDLE":
    case "MEMO":
      return "Right then — scrawl yer last words below, or pin a file to the mast. I lock 'em in a chest inside yer own browser afore aught leaves yer ship; not even ol' Mordecai can sneak a peek. On me peg leg, I swear it.";
    case "TERMS":
      return "Sealed an' snug. Now — how often will ye send word that ye still draw breath? Tap a tide below. Miss one full turn o' the glass and the whole network spills yer secret to the world. I've already set a sensible ladder an' a wee bounty; poke the fine print only if ye fancy.";
    case "WORLD":
      return "Terms struck! Next, prove yer a livin' soul an' not some bilge-suckin' script — one tap o' World ID binds this pact to ye an' ye alone. Can't be forged, can't be handed off. That's rather the whole point, aye?";
    case "SIGN":
      return "Yer human — good, I had me doubts. Last deed: sign the funding transfer on yer Ledger. That little slab holds the only key worth a doubloon, an' I never lay a finger on it. Squint at the memo on its wee screen, make sure it matches, then seal the bargain.";
    case "ARMED":
      return "It be DONE — yer switch is armed an' I'm perched here keepin' watch with me one good eye. Send word afore each deadline an' I'll shove the tide back. Go quiet… an' the deep claims yer secret for all the world to read.";
    case "CHECKIN":
      return "Checkin' in shoves the reckonin' back one notch. Prove yer still kickin' with World ID an' I'll burn the nearest rung off yer ladder.";
    case "CANCEL":
      return "Standin' the whole pact down, are ye? That wants a transfer signed by yer own Ledger — the only way to call off this old dog. No signature, no mercy.";
    default:
      return "Ready when ye are, captain.";
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
