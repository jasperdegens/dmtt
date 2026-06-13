// app/api/world/rp-context/route.ts — backend-signed rp_context (CONTRACTS §9).
//
// The World signing_key is a SERVER-ONLY secret (never NEXT_PUBLIC_*): the backend
// signs rp_context with it (signRequest) so the client never sees the key. Returns
// RpContextResponse{rp_id, nonce, created_at, expires_at, signature}; when World
// isn't configured, 503 (no key ⇒ no signing).

import { NextResponse } from "next/server";

import { signRpContext } from "@/lib/world.ts";

export async function POST(): Promise<Response> {
  try {
    const ctx = signRpContext();
    return NextResponse.json(ctx);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("world not configured")) {
      return NextResponse.json({ error: "world not configured" }, { status: 503 });
    }
    return NextResponse.json({ error: "INTERNAL", detail: msg }, { status: 500 });
  }
}
