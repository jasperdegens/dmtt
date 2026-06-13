// watcher/release.ts — pure, dependency-injected release reaction (WS-D).
//
// The watcher polls each switch's HCS audit topic via the mirror and reacts to
// RELEASE_AUTHORIZED. Per docs/CONTRACTS.md §4 (RELEASE) + §11 (N10):
//   - The schedule fires unattended and posts RELEASE_AUTHORIZED{seq, nonce}.
//   - This module publishes EXACTLY the one fired rung (idx = seq + 1) as
//     CAPSULE_PUBLISHED{idx, seq, capsuleB64} (decryptable now — round_idx passed),
//     then best-effort pays the bounty, then posts BULLETIN{seq, text}.
//   - It is IDEMPOTENT: a duplicate RELEASE_AUTHORIZED for an already-RELEASED
//     switch (same seq) re-posts nothing (the store IS the dedupe key).
//
// This file is PURE: no SDK / network / fs imports. Everything it touches arrives
// through ReleaseDeps so the executor logic is unit-testable against mocks.

import type {
  Switch,
  SwitchStore,
  HederaSurface,
  ReleaseAuthorizedEvent,
  CapsulePublishedEvent,
  BulletinEvent,
  MirrorTopicMessage,
  SwitchEvent,
} from "../lib/types.ts";

/** The injected world the release reaction runs against (test passes mocks; the
 *  runnable watcher in index.ts wires the real store/hedera). */
export interface ReleaseDeps {
  store: SwitchStore;
  /** Only the two surface methods the watcher needs (post events, read the trail). */
  hedera: Pick<HederaSurface, "submitEvent" | "listTopicMessages">;
  /** Composes the public BULLETIN text from the switch + the released seq. */
  composeBulletin: (sw: Switch, seq: number) => Promise<string> | string;
  /** Best-effort bounty payout (never blocks/fails release if it throws). */
  payBounty?: (sw: Switch) => Promise<void>;
  /** Injectable clock (tests pin it; production passes Date.now). */
  now: () => number;
}

/** Outcome of reacting to one RELEASE_AUTHORIZED. `published` is false when the
 *  fired rung's capsule was missing/shredded (honest residual). `deduped` is true
 *  when nothing was (re-)posted (already released for this seq, or unknown topic). */
export interface ReleaseOutcome {
  published: boolean;
  idx: number;
  deduped: boolean;
}

/**
 * React to one RELEASE_AUTHORIZED event for `topicId`, idempotently.
 *
 * The whole read-modify-write runs inside `store.withLock` so concurrent
 * deliveries of the same (or overlapping) events serialize and can't double-post.
 */
export async function handleReleaseAuthorized(
  deps: ReleaseDeps,
  topicId: string,
  ev: ReleaseAuthorizedEvent,
): Promise<ReleaseOutcome> {
  return deps.store.withLock<ReleaseOutcome>(topicId, async (current) => {
    // Unknown topic — nothing to release. Treat as a no-op dedupe.
    if (!current) {
      return { next: current, result: { published: false, idx: 0, deduped: true } };
    }

    // IDEMPOTENCY: already released for this seq ⇒ re-post nothing, leave state.
    if (
      current.status === "RELEASED" &&
      current.released &&
      current.released.seq === ev.seq
    ) {
      return {
        next: current,
        result: { published: false, idx: current.released.idx, deduped: true },
      };
    }

    // The fired rung is idx = seq + 1 (invariant liveIdx === seq + 1; §4).
    const idx = ev.seq + 1;
    const rung = current.ladder[idx - 1];
    const capsuleB64 = rung?.capsuleB64 ?? "";
    const hasCapsule = capsuleB64.length > 0;

    // Publish exactly the one fired rung (N10) — only if the capsule survived.
    // A missing/shredded capsule is an honest residual: we still mark released.
    if (hasCapsule) {
      const capsuleEvent: CapsulePublishedEvent = {
        type: "CAPSULE_PUBLISHED",
        idx,
        seq: ev.seq,
        capsuleB64,
      };
      await deps.hedera.submitEvent(topicId, capsuleEvent);
    }

    // Best-effort bounty — never throw out of release if the payout fails.
    if (deps.payBounty) {
      try {
        await deps.payBounty(current);
      } catch {
        /* swallowed: bounty is best-effort (shirk is an accepted residual) */
      }
    }

    // Public bulletin.
    const text = await deps.composeBulletin(current, ev.seq);
    const bulletinEvent: BulletinEvent = {
      type: "BULLETIN",
      seq: ev.seq,
      text,
    };
    await deps.hedera.submitEvent(topicId, bulletinEvent);

    const at = deps.now();
    const updated: Switch = {
      ...current,
      status: "RELEASED",
      scheduleId: null,
      released: {
        seq: ev.seq,
        idx,
        at,
        capsulePublished: hasCapsule,
      },
      updatedAt: at,
    };

    return {
      next: updated,
      result: { published: hasCapsule, idx, deduped: false },
    };
  });
}

/** Decode one mirror message's base64 contents into a SwitchEvent, or null if it
 *  isn't parseable JSON (tolerate junk on the topic rather than crash the loop). */
function parseEvent(msg: MirrorTopicMessage): SwitchEvent | null {
  try {
    const json = Buffer.from(msg.contents, "base64").toString("utf8");
    return JSON.parse(json) as SwitchEvent;
  } catch {
    return null;
  }
}

/**
 * One polling pass over every known switch. For each topic, page the mirror
 * forward from the per-topic cursor; for every RELEASE_AUTHORIZED, run the
 * idempotent reaction and advance the cursor by sequence number.
 *
 * Returns the count of releases actually handled (non-deduped) this pass — so a
 * second pass over an already-advanced cursor (no new messages) returns 0, and a
 * duplicate RELEASE_AUTHORIZED that dedupes doesn't inflate the count.
 */
export async function pollOnce(
  deps: ReleaseDeps,
  cursor: Map<string, number>,
): Promise<number> {
  let handled = 0;
  const topicIds = await deps.store.list();

  for (const topicId of topicIds) {
    const afterSeq = cursor.get(topicId) ?? 0;
    const msgs = await deps.hedera.listTopicMessages(topicId, afterSeq);

    for (const msg of msgs) {
      const event = parseEvent(msg);
      if (event && event.type === "RELEASE_AUTHORIZED") {
        const outcome = await handleReleaseAuthorized(deps, topicId, event);
        if (!outcome.deduped) handled += 1;
      }
      // Advance the cursor regardless of event type so we never re-scan a message.
      cursor.set(topicId, msg.sequenceNumber);
    }
  }

  return handled;
}
