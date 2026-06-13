// app/api/world/verify/route.ts — verify a World proof (CONTRACTS §9).
//
// Forwards the proof AS-IS (no re-encoding) plus the top-level `action` (G0: the
// endpoint 400s "action is required" without it) and the bound `signal`, to
// https://developer.world.org/api/v4/verify/{rp_id}. ok ⟺ upstream 200 → returns
// the verified nullifier; else { ok:false, detail }. 503 when World isn't
// configured (verifyWorldProof short-circuits with no network call).

import { NextResponse } from "next/server";

import { verifyWorldProof } from "@/lib/world.ts";
import { hasWorldCreds } from "@/lib/env.ts";
import type { WorldVerifyRequest } from "@/lib/types.ts";

export async function POST(req: Request): Promise<Response> {
  if (!hasWorldCreds()) {
    return NextResponse.json({ ok: false, detail: "world not configured" }, { status: 503 });
  }

  let body: WorldVerifyRequest;
  try {
    body = (await req.json()) as WorldVerifyRequest;
  } catch {
    return NextResponse.json({ ok: false, detail: "invalid JSON body" }, { status: 400 });
  }

  if (!body || !body.proof || !body.action || !body.signal) {
    return NextResponse.json(
      { ok: false, detail: "missing proof, action, or signal" },
      { status: 400 },
    );
  }

  const result = await verifyWorldProof(body);
  return NextResponse.json(result);
}
