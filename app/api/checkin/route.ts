// POST /api/checkin — the World-authorized postponement (CONTRACTS §9 → §8).
//
// Body = { input: CheckinInput, artifacts: CheckinArtifacts }. The executor enforces
// stale-seq, (flag-gated) World verify + nullifier + signal re-enforcement, then
// creates the next schedule BEFORE deleting the old (fail-toward-release) and posts
// CHECKIN_VERIFIED.
import { NextResponse } from "next/server";
import { checkin } from "@/lib/executors.ts";
import { makeContext } from "@/lib/context.ts";
import type { CheckinInput, CheckinArtifacts } from "@/lib/types.ts";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: { input: CheckinInput; artifacts: CheckinArtifacts };
  try {
    body = (await req.json()) as { input: CheckinInput; artifacts: CheckinArtifacts };
  } catch {
    return NextResponse.json({ error: "bad JSON body" }, { status: 400 });
  }
  if (!body?.input || !body?.artifacts) {
    return NextResponse.json({ error: "missing input/artifacts" }, { status: 400 });
  }
  try {
    const res = await checkin(makeContext(), body.input, body.artifacts);
    if (!res.ok) {
      return NextResponse.json({ error: res.error }, { status: 400 });
    }
    return NextResponse.json(res.value);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
