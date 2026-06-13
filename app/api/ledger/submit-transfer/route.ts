// POST /api/ledger/submit-transfer — relay the device-signed transfer to the network (C1).
//
// Body = { frozenTxBase64, publicKey, signature } from /api/ledger/build-transfer + the
// Ledger. We reattach the Ed25519 signature and submit through a NO-OPERATOR client (the
// agent never co-signs — only the device's signature authorizes). Returns the network
// transaction id, which is the §7 mirror-verifiable armTxId / cancelTxId.
import { NextResponse } from "next/server";
import { submitSignedLedgerTransfer, hasHederaCreds } from "@/lib/hedera.ts";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!hasHederaCreds()) {
    return NextResponse.json({ error: "agent Hedera credentials are not configured" }, { status: 503 });
  }
  let body: { frozenTxBase64?: unknown; publicKey?: unknown; signature?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "bad JSON body" }, { status: 400 });
  }
  const frozenTxBase64 = typeof body.frozenTxBase64 === "string" ? body.frozenTxBase64 : "";
  const publicKey = typeof body.publicKey === "string" ? body.publicKey.trim() : "";
  const signature = typeof body.signature === "string" ? body.signature.trim() : "";
  if (!frozenTxBase64) {
    return NextResponse.json({ error: "frozenTxBase64 is required" }, { status: 400 });
  }
  if (!/^(0x)?[0-9a-fA-F]{64}$/.test(publicKey)) {
    return NextResponse.json({ error: "publicKey must be a 32-byte hex Ed25519 key" }, { status: 400 });
  }
  if (!/^(0x)?[0-9a-fA-F]{128}$/.test(signature)) {
    return NextResponse.json({ error: "signature must be a 64-byte hex Ed25519 signature" }, { status: 400 });
  }
  try {
    const res = await submitSignedLedgerTransfer({ frozenTxBase64, publicKeyHex: publicKey, signatureHex: signature });
    return NextResponse.json(res);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
