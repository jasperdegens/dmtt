// POST /api/ledger/account — resolve the Hedera account(s) for a Ledger public key (C1).
//
// The Ledger yields an Ed25519 public key, not an account id (Hedera account ids are
// network-assigned), so the browser sends the key here and we look it up on the mirror.
// No secrets and no signing — this is a public mirror read behind the server's mirror base.
import { NextResponse } from "next/server";
import { lookupAccountIdsByPublicKey } from "@/lib/hedera.ts";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: { publicKey?: unknown };
  try {
    body = (await req.json()) as { publicKey?: unknown };
  } catch {
    return NextResponse.json({ error: "bad JSON body" }, { status: 400 });
  }
  const publicKey = typeof body.publicKey === "string" ? body.publicKey.trim() : "";
  if (!/^(0x)?[0-9a-fA-F]{64,}$/.test(publicKey)) {
    return NextResponse.json({ error: "publicKey must be a hex Ed25519 public key" }, { status: 400 });
  }
  try {
    const { accountId, accounts } = await lookupAccountIdsByPublicKey(publicKey);
    return NextResponse.json({ accountId, accounts });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
