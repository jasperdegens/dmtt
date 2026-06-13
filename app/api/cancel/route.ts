// POST /api/cancel — the device-authorized teardown (CONTRACTS §9 → §8).
//
// Body = { input: CancelInput, artifacts: CancelArtifacts }. The device signed
// DMTT:CANCEL:<topicId>; the executor (flag-gated) mirror-verifies it, deletes the
// schedule, shreds the whole ladder, and posts CANCELLED.
import { NextResponse } from "next/server";
import { cancel } from "@/lib/executors.ts";
import { makeContext } from "@/lib/context.ts";
import type { CancelInput, CancelArtifacts } from "@/lib/types.ts";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: { input: CancelInput; artifacts: CancelArtifacts };
  try {
    body = (await req.json()) as { input: CancelInput; artifacts: CancelArtifacts };
  } catch {
    return NextResponse.json({ error: "bad JSON body" }, { status: 400 });
  }
  if (!body?.input || !body?.artifacts) {
    return NextResponse.json({ error: "missing input/artifacts" }, { status: 400 });
  }
  try {
    const res = await cancel(makeContext(), body.input, body.artifacts);
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
