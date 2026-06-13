// app/api/chat/route.ts — the chat mutation surface (CONTRACTS §9, CLAUDE.md chat).
//
// The chat is a FIXED state machine; this route is where the client posts CAPTURED
// ARTIFACT events (from MemoCard / TermsChips / WorldVerifyCard / LedgerSignCard) and
// gets back the resulting ChatContext + a narration string. The machine advances ONLY
// on artifacts (reduce); free text (PARSE_TEXT) can only PROPOSE a chip — it can never
// move a step or arm. HARD INVARIANT: plaintext NEVER arrives here — the client
// encrypts locally and posts only a ciphertextHash / storageKind, never the memo.
//
// LLM-OFFLINE BY DESIGN: when ANTHROPIC_API_KEY is absent the route returns a
// deterministic JSON narration; the LLM only ever POLISHES the narration, it can
// never drive a transition. The route is side-effect-light — it does NOT call the
// arm/checkin/cancel executors (the cards drive those with their own artifacts).

import { NextResponse } from "next/server";

import { reduce, type ChatContext, type ChatEvent } from "@/lib/chat-machine.ts";
import { env } from "@/lib/env.ts";

interface ChatRequest {
  /** The prior machine context (the client is the source of truth between turns). */
  context?: ChatContext;
  /** The artifact event to apply (or PARSE_TEXT for a free-text proposal). */
  event: ChatEvent;
}

/** Deterministic, model-free narration per resulting step (works LLM-offline). */
function narrate(ctx: ChatContext): string {
  if (ctx.error) {
    return `I can't do that: ${ctx.error}. Each step needs its real artifact — I can't skip ahead.`;
  }
  switch (ctx.state) {
    case "IDLE":
      return "Let's set up your switch. First, write the memo — it's encrypted in your browser before anything leaves your device.";
    case "TERMS":
      return "Memo captured (encrypted locally). Now choose your terms: how often you'll check in, the funding, and an optional public bulletin.";
    case "WORLD":
      return "Terms set. Next, verify you're a unique human with World ID — this is the authority that lets you postpone later.";
    case "SIGN":
      return "Verified. Now sign the arm funding transfer on your Ledger — that's the device authority that arms the switch.";
    case "ARMED":
      return "Armed. Your switch is live; check in before each deadline to postpone, or it releases when you go silent.";
    case "CHECKIN":
      return "Checking in postpones the next release. Verify with World ID to advance one rung.";
    case "CANCEL":
      return "Cancelling requires a device-signed transfer; that's the only way to stand the switch down.";
    default:
      return "Ready.";
  }
}

/** Best-effort LLM polish of the deterministic narration. NEVER drives a transition
 *  (the state is already decided by reduce); on any failure we keep the seed text. */
async function polish(seed: string, ctx: ChatContext): Promise<string> {
  const apiKey = env("ANTHROPIC_API_KEY");
  if (apiKey == null) return seed;
  try {
    const { anthropic } = await import("@ai-sdk/anthropic");
    const { generateText } = await import("ai");
    const { text } = await generateText({
      model: anthropic("claude-sonnet-4-5"),
      prompt:
        "You narrate a FIXED setup wizard for an encrypted dead-man's-switch app. " +
        "Rewrite the status line below in 1 short, calm sentence. Do NOT invent new " +
        "steps, do NOT offer to skip or reorder anything, do NOT claim to perform any " +
        "action. Output ONLY the sentence.\n\nCurrent step: " +
        ctx.state +
        "\nStatus: " +
        JSON.stringify(seed),
    });
    const out = text.trim();
    return out.length > 0 ? out : seed;
  } catch {
    return seed; // release the deterministic narration on any LLM failure
  }
}

export async function POST(req: Request): Promise<Response> {
  let body: ChatRequest;
  try {
    body = (await req.json()) as ChatRequest;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  if (!body || !body.event || typeof body.event.type !== "string") {
    return NextResponse.json({ error: "missing event" }, { status: 400 });
  }

  // The client carries the prior context between turns; start fresh if absent.
  const prior: ChatContext = body.context ?? { state: "IDLE" };

  // The single mutating surface: reduce() advances ONLY on artifacts. A PARSE_TEXT
  // event can only attach a transient chip suggestion — it can never move the step.
  const next = reduce(prior, body.event);

  const seed = narrate(next);
  const narration = await polish(seed, next);

  return NextResponse.json({ context: next, narration });
}
