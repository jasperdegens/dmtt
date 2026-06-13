// POST /api/arm — the device-and-World-authorized arm mutation (CONTRACTS §9 → §8).
//
// Body = { input: ArmInput, artifacts: ArmArtifacts }. The client assembled the
// ciphertext (already stored), minted the ladder from K (then discarded K), and
// computed policy + policyHash; the device signed DMTT:ARM:<policyHash>. The arm
// executor recomputes policyHash, (flag-gated) mirror-verifies the transfer, creates
// the topic, posts ARMED, schedules the first release, and persists the Switch.
import { NextResponse } from "next/server";
import { arm } from "@/lib/executors.ts";
import { makeContext } from "@/lib/context.ts";
import type { ArmInput, ArmArtifacts } from "@/lib/types.ts";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: { input: ArmInput; artifacts: ArmArtifacts };
  try {
    body = (await req.json()) as { input: ArmInput; artifacts: ArmArtifacts };
  } catch {
    return NextResponse.json({ error: "bad JSON body" }, { status: 400 });
  }
  if (!body?.input || !body?.artifacts) {
    return NextResponse.json({ error: "missing input/artifacts" }, { status: 400 });
  }
  try {
    const res = await arm(makeContext(), body.input, body.artifacts);
    if (!res.ok) {
      return NextResponse.json({ error: res.error }, { status: 400 });
    }
    // N10: never echo the agent-held capsules back to the client.
    return NextResponse.json({
      topicId: res.value.topicId,
      scheduleId: res.value.scheduleId,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
