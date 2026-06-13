// app/api/switch/[topicId]/route.ts — GET the PUBLIC SwitchView (CONTRACTS §9).
//
// Loads the agent-private Switch from the store, reads the audit trail from the
// mirror, and returns the N10-safe projection (toSwitchView): rung HASHES + the
// mirror events, NEVER an un-fired ladder capsule. Mirror reads are best-effort —
// a transient mirror failure degrades to events:[] rather than 500ing the view.

import { NextResponse } from "next/server";

import { store, toSwitchView } from "@/lib/store.ts";
import { hedera } from "@/lib/hedera.ts";
import type { SwitchEvent } from "@/lib/types.ts";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ topicId: string }> },
): Promise<Response> {
  const { topicId } = await ctx.params; // Next 15: params is async.

  const sw = await store.load(topicId);
  if (sw === null) {
    return NextResponse.json({ error: "NOT_FOUND", topicId }, { status: 404 });
  }

  // Best-effort: rebuild the audit trail from the mirror; fall back to [] on failure.
  let events: SwitchEvent[] = [];
  try {
    const messages = await hedera.listTopicMessages(topicId);
    events = messages
      .map((m): SwitchEvent | null => {
        try {
          const json = Buffer.from(m.contents, "base64").toString("utf8");
          return JSON.parse(json) as SwitchEvent;
        } catch {
          return null; // skip a single unparseable message, keep the rest
        }
      })
      .filter((e): e is SwitchEvent => e !== null);
  } catch {
    events = [];
  }

  return NextResponse.json(toSwitchView(sw, events));
}
