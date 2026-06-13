// POST /api/storage — upload already-encrypted ciphertext to the agent's storage.
//
// The client encrypts locally (MemoCard) and uploads ONLY the ciphertext bytes
// (never plaintext, never K). The agent picks the medium by size (HFS fast path
// ≤4 KB, else HCS chunked) and returns the StorageRef the arm flow commits to.
import { NextResponse } from "next/server";
import { hedera } from "@/lib/hedera.ts";
import { hasHederaCreds } from "@/lib/env.ts";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!hasHederaCreds()) {
    return NextResponse.json(
      { error: "Hedera not configured (agent storage unavailable)" },
      { status: 503 },
    );
  }
  try {
    const bytes = new Uint8Array(await req.arrayBuffer());
    if (bytes.length === 0) {
      return NextResponse.json({ error: "empty ciphertext" }, { status: 400 });
    }
    const ref = await hedera.storeCiphertext(bytes);
    return NextResponse.json(ref);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
