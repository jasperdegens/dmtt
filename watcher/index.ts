// watcher/index.ts — the runnable watcher process (WS-D).
//
// A long-lived Node process that polls every known switch's HCS audit topic via
// the mirror and reacts to RELEASE_AUTHORIZED idempotently (docs/CONTRACTS.md §4
// RELEASE + §11 N10): publish the one fired rung's capsule → best-effort bounty →
// BULLETIN. All the release logic is the PURE module release.ts; this file only
// wires the REAL store/hedera deps and runs the loop.
//
// Run: node watcher/index.ts
//
// Import-safe & crash-resistant by design: it never throws at import, and a poll
// failure (e.g. missing creds, mirror hiccup) is logged and the loop keeps idling.

import { store } from "../lib/store.ts";
import { hedera, hasHederaCreds, payHbar } from "../lib/hedera.ts";
import { env } from "../lib/env.ts";
import { pollOnce, type ReleaseDeps } from "./release.ts";
import type { Switch } from "../lib/types.ts";

/** Poll cadence — schedule firing lag is ~34 ms (S2); 3 s is comfortably tight. */
const POLL_INTERVAL_MS = 3_000;

/** A safe default bulletin when terms.bulletin is empty and no LLM is configured. */
const DEFAULT_BULLETIN =
  "This dead man's switch has fired. The enclosed memo is now public per the " +
  "author's standing instructions.";

// ─────────────────────────────────────────────────────────────────────────────
// composeBulletin — LLM-composed when ANTHROPIC_API_KEY is set, else templated.
// ─────────────────────────────────────────────────────────────────────────────

/** The templated fallback: the author's own seeded bulletin, or a safe default. */
function templatedBulletin(sw: Switch): string {
  const seed = sw.policy.terms.bulletin?.trim();
  return seed && seed.length > 0 ? seed : DEFAULT_BULLETIN;
}

/**
 * Compose the public BULLETIN text. If ANTHROPIC_API_KEY is present, ask the model
 * to polish the author's seed into a short public notice; otherwise (and on ANY
 * failure) fall back to the templated bulletin. Best-effort — release never blocks
 * on the LLM.
 */
async function composeBulletin(sw: Switch, _seq: number): Promise<string> {
  const apiKey = env("ANTHROPIC_API_KEY");
  const seed = templatedBulletin(sw);
  if (apiKey == null) return seed;

  try {
    // Lazily imported so the watcher runs (and tests of release.ts compile)
    // without the AI SDK installed or the key set.
    const { anthropic } = await import("@ai-sdk/anthropic");
    const { generateText } = await import("ai");
    const { text } = await generateText({
      model: anthropic("claude-sonnet-4-5"),
      prompt:
        "You are composing a short, sober PUBLIC bulletin for a dead man's " +
        "switch that has just fired (the author has gone silent and an encrypted " +
        "memo is now public). Write 1-2 calm sentences. Do NOT invent facts, " +
        "names, or details beyond the author's seed. Output ONLY the bulletin " +
        "text.\n\nAuthor's seed: " +
        JSON.stringify(seed),
    });
    const out = text.trim();
    return out.length > 0 ? out : seed;
  } catch (err) {
    console.warn("[watcher] bulletin LLM failed, using templated seed:", err);
    return seed;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// payBounty — best-effort agent CryptoTransfer (Phase 5).
// ─────────────────────────────────────────────────────────────────────────────

async function payBounty(sw: Switch): Promise<void> {
  const recipient = env("DMTT_BOUNTY_ACCOUNT_ID") ?? sw.ledgerAccountId;
  const configured = Number(env("DMTT_BOUNTY_HBAR") ?? "0");
  const amount = Number.isFinite(configured) && configured > 0
    ? configured
    : Math.max(0.01, Math.min(1, sw.policy.terms.fundingHbar * 0.05));
  const txId = await payHbar(recipient, amount, `DMTT:BOUNTY:${sw.topicId}`);
  console.log(`[watcher] bounty paid ${amount} ℏ to ${recipient}: ${txId}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// The real deps + the loop.
// ─────────────────────────────────────────────────────────────────────────────

const deps: ReleaseDeps = {
  store,
  hedera,
  composeBulletin,
  payBounty,
  now: () => Date.now(),
};

/** Per-process cursor: topicId → last-seen mirror sequenceNumber. The STORE is the
 *  release dedupe (status RELEASED), so the cursor needs no persistence — a restart
 *  re-scans and handleReleaseAuthorized idempotently no-ops already-released switches. */
const cursor = new Map<string, number>();

let running = false;

/** One guarded poll pass — never throws; logs and returns on any failure. */
async function tick(): Promise<void> {
  if (running) return; // don't overlap if a pass runs long
  running = true;
  try {
    if (!hasHederaCreds()) {
      // No operator creds → nothing to poll (and listTopicMessages would fail).
      // Idle quietly; this keeps `node watcher/index.ts` runnable in dev.
      return;
    }
    const handled = await pollOnce(deps, cursor);
    if (handled > 0) {
      console.log(`[watcher] handled ${handled} release(s) this pass.`);
    }
  } catch (err) {
    console.error("[watcher] poll pass failed (continuing):", err);
  } finally {
    running = false;
  }
}

/** Start the polling loop. Returns the interval handle (so a host could stop it). */
export function startWatcher(intervalMs: number = POLL_INTERVAL_MS): NodeJS.Timeout {
  console.log(
    `[watcher] starting; polling every ${intervalMs} ms` +
      (hasHederaCreds() ? "" : " (no Hedera creds yet — idling until configured)"),
  );
  // Kick one pass immediately, then on the interval.
  void tick();
  const handle = setInterval(() => void tick(), intervalMs);
  // Don't keep the event loop alive solely for the timer in embedded use; the
  // entrypoint guard below re-refs by running as a process.
  return handle;
}

// Run when invoked directly as the entrypoint (node watcher/index.ts), not when
// imported. Wrapped so a wiring error logs instead of crashing at import.
const isMain = (() => {
  try {
    return import.meta.url === `file://${process.argv[1]}`;
  } catch {
    return false;
  }
})();

if (isMain) {
  try {
    startWatcher();
  } catch (err) {
    console.error("[watcher] failed to start (idling):", err);
  }
}
